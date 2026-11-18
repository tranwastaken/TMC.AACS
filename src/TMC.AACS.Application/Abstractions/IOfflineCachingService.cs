using TMC.AACS.Domain.Entities;

namespace TMC.AACS.Application.Abstractions;

public sealed record AccessRequest(
    string EmployeeId,
    string GateId,
    string QrToken,
    DateTime Timestamp,
    Guid? ClientEventId = null
);

public sealed record AccessResponse(
    bool IsSuccess,
    string Message,
    bool IsOfflineCached,
    Guid ClientEventId
);

public sealed record OfflineCacheStatus(
    bool IsNetworkOnline,
    int PendingCount,
    int SyncedCount,
    DateTime? LastSyncAtUtc,
    IReadOnlyList<OfflineScanEntry> PendingItems
);

public interface IKioskOfflineCachingService
{
    bool IsNetworkOnline { get; }
    void SetNetworkOnline(bool isOnline);
    Task EnqueueAsync(OfflineScanEntry entry, CancellationToken ct = default);
    Task<IReadOnlyList<OfflineScanEntry>> GetPendingAsync(int limit = 100, CancellationToken ct = default);
    Task<OfflineCacheStatus> GetStatusAsync(CancellationToken ct = default);
    Task<int> SyncPendingAsync(Func<OfflineScanEntry, CancellationToken, Task<bool>> centralSyncHandler, CancellationToken ct = default);
}
