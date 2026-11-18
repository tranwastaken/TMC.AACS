using System.Collections.Concurrent;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using TMC.AACS.Application.Abstractions;
using TMC.AACS.Domain.Entities;

namespace TMC.AACS.Infrastructure.Persistence;

public sealed class KioskOfflineCachingService : IKioskOfflineCachingService
{
    private readonly string _connectionString;
    private readonly ILogger<KioskOfflineCachingService> _logger;
    private readonly SemaphoreSlim _syncLock = new(1, 1);
    private volatile bool _isNetworkOnline = true;
    private DateTime? _lastSyncAtUtc;

    public bool IsNetworkOnline => _isNetworkOnline;

    public KioskOfflineCachingService(string sqlitePath, ILogger<KioskOfflineCachingService> logger)
    {
        _connectionString = $"Data Source={sqlitePath};Cache=Shared";
        _logger = logger;
        InitializeDatabase();
    }

    public void SetNetworkOnline(bool isOnline)
    {
        _isNetworkOnline = isOnline;
        _logger.LogInformation("Kiosk network state changed to: {State}", isOnline ? "ONLINE" : "OFFLINE");
    }

    private void InitializeDatabase()
    {
        using var conn = new SqliteConnection(_connectionString);
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            CREATE TABLE IF NOT EXISTS offline_queue (
                client_event_id TEXT PRIMARY KEY,
                employee_id TEXT NOT NULL,
                gate_station_id TEXT NOT NULL,
                qr_token TEXT NOT NULL,
                scanned_at_utc TEXT NOT NULL,
                local_decision TEXT NOT NULL,
                deny_reason TEXT NULL,
                sync_status TEXT NOT NULL,
                retry_count INTEGER NOT NULL DEFAULT 0,
                created_at_utc TEXT NOT NULL,
                synced_at_utc TEXT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_offline_queue_status_created
                ON offline_queue (sync_status, created_at_utc);
            """;
        cmd.ExecuteNonQuery();
    }

    public async Task EnqueueAsync(OfflineScanEntry entry, CancellationToken ct = default)
    {
        await using var conn = new SqliteConnection(_connectionString);
        await conn.OpenAsync(ct);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            INSERT OR IGNORE INTO offline_queue (
                client_event_id, employee_id, gate_station_id, qr_token,
                scanned_at_utc, local_decision, deny_reason, sync_status,
                retry_count, created_at_utc, synced_at_utc
            ) VALUES (
                $id, $empId, $gateId, $token,
                $scannedAt, $decision, $reason, $status,
                $retry, $createdAt, NULL
            );
            """;
        cmd.Parameters.AddWithValue("$id", entry.ClientEventId.ToString());
        cmd.Parameters.AddWithValue("$empId", entry.EmployeeId);
        cmd.Parameters.AddWithValue("$gateId", entry.GateStationId);
        cmd.Parameters.AddWithValue("$token", entry.QrToken);
        cmd.Parameters.AddWithValue("$scannedAt", entry.ScannedAtUtc.ToString("O"));
        cmd.Parameters.AddWithValue("$decision", entry.LocalDecision.ToString());
        cmd.Parameters.AddWithValue("$reason", (object?)entry.DenyReason ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$status", OfflineSyncStatus.PendingSync.ToString());
        cmd.Parameters.AddWithValue("$retry", entry.RetryCount);
        cmd.Parameters.AddWithValue("$createdAt", entry.CreatedAtUtc.ToString("O"));

        await cmd.ExecuteNonQueryAsync(ct);
        _logger.LogWarning("Offline scan queued locally: {ClientEventId} for Employee {EmployeeId}", entry.ClientEventId, entry.EmployeeId);
    }

    public async Task<IReadOnlyList<OfflineScanEntry>> GetPendingAsync(int limit = 100, CancellationToken ct = default)
    {
        var items = new List<OfflineScanEntry>();
        await using var conn = new SqliteConnection(_connectionString);
        await conn.OpenAsync(ct);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT client_event_id, employee_id, gate_station_id, qr_token,
                   scanned_at_utc, local_decision, deny_reason, sync_status,
                   retry_count, created_at_utc, synced_at_utc
            FROM offline_queue
            WHERE sync_status IN ('PendingSync', 'Failed')
            ORDER BY created_at_utc ASC
            LIMIT $limit;
            """;
        cmd.Parameters.AddWithValue("$limit", limit);

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            items.Add(new OfflineScanEntry
            {
                ClientEventId = Guid.Parse(reader.GetString(0)),
                EmployeeId = reader.GetString(1),
                GateStationId = reader.GetString(2),
                QrToken = reader.GetString(3),
                ScannedAtUtc = DateTime.Parse(reader.GetString(4)).ToUniversalTime(),
                LocalDecision = Enum.Parse<AccessResult>(reader.GetString(5)),
                DenyReason = reader.IsDBNull(6) ? null : reader.GetString(6),
                SyncStatus = Enum.Parse<OfflineSyncStatus>(reader.GetString(7)),
                RetryCount = reader.GetInt32(8),
                CreatedAtUtc = DateTime.Parse(reader.GetString(9)).ToUniversalTime(),
                SyncedAtUtc = reader.IsDBNull(10) ? null : DateTime.Parse(reader.GetString(10)).ToUniversalTime()
            });
        }

        return items;
    }

    public async Task<OfflineCacheStatus> GetStatusAsync(CancellationToken ct = default)
    {
        var pending = await GetPendingAsync(200, ct);
        await using var conn = new SqliteConnection(_connectionString);
        await conn.OpenAsync(ct);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM offline_queue WHERE sync_status = 'Synced';";
        var syncedCount = Convert.ToInt32(await cmd.ExecuteScalarAsync(ct));

        return new OfflineCacheStatus(_isNetworkOnline, pending.Count, syncedCount, _lastSyncAtUtc, pending);
    }

    public async Task<int> SyncPendingAsync(
        Func<OfflineScanEntry, CancellationToken, Task<bool>> centralSyncHandler,
        CancellationToken ct = default)
    {
        if (!_isNetworkOnline) return 0;

        await _syncLock.WaitAsync(ct);
        try
        {
            var pending = await GetPendingAsync(50, ct);
            if (pending.Count == 0) return 0;

            var synced = 0;
            foreach (var item in pending)
            {
                if (!_isNetworkOnline || ct.IsCancellationRequested) break;

                try
                {
                    var ok = await centralSyncHandler(item, ct);
                    if (ok)
                    {
                        await UpdateSyncStateAsync(item.ClientEventId, OfflineSyncStatus.Synced, item.RetryCount, ct);
                        synced++;
                    }
                    else
                    {
                        await UpdateSyncStateAsync(item.ClientEventId, OfflineSyncStatus.Failed, item.RetryCount + 1, ct);
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to sync offline item {ClientEventId}", item.ClientEventId);
                    await UpdateSyncStateAsync(item.ClientEventId, OfflineSyncStatus.Failed, item.RetryCount + 1, ct);
                }
            }

            if (synced > 0)
            {
                _lastSyncAtUtc = DateTime.UtcNow;
                _logger.LogInformation("Auto-synced {Count} offline scan(s) to central server.", synced);
            }

            return synced;
        }
        finally
        {
            _syncLock.Release();
        }
    }

    private async Task UpdateSyncStateAsync(Guid clientEventId, OfflineSyncStatus status, int retryCount, CancellationToken ct)
    {
        await using var conn = new SqliteConnection(_connectionString);
        await conn.OpenAsync(ct);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            UPDATE offline_queue
            SET sync_status = $status,
                retry_count = $retry,
                synced_at_utc = CASE WHEN $status = 'Synced' THEN $syncedAt ELSE synced_at_utc END
            WHERE client_event_id = $id;
            """;
        cmd.Parameters.AddWithValue("$id", clientEventId.ToString());
        cmd.Parameters.AddWithValue("$status", status.ToString());
        cmd.Parameters.AddWithValue("$retry", retryCount);
        cmd.Parameters.AddWithValue("$syncedAt", DateTime.UtcNow.ToString("O"));
        await cmd.ExecuteNonQueryAsync(ct);
    }
}

public sealed class OfflineSyncBackgroundService : BackgroundService
{
    private readonly IKioskOfflineCachingService _cache;
    private readonly Func<OfflineScanEntry, CancellationToken, Task<bool>> _syncHandler;
    private readonly ILogger<OfflineSyncBackgroundService> _logger;

    public OfflineSyncBackgroundService(
        IKioskOfflineCachingService cache,
        Func<OfflineScanEntry, CancellationToken, Task<bool>> syncHandler,
        ILogger<OfflineSyncBackgroundService> logger)
    {
        _cache = cache;
        _syncHandler = syncHandler;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            if (_cache.IsNetworkOnline)
            {
                try
                {
                    await _cache.SyncPendingAsync(_syncHandler, stoppingToken);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error in OfflineSyncBackgroundService loop.");
                }
            }

            await Task.Delay(TimeSpan.FromSeconds(3), stoppingToken);
        }
    }
}
