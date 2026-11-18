using TMC.AACS.Application.Abstractions;
using TMC.AACS.Domain.Entities;

namespace TMC.AACS.Application.UseCases;

public sealed class RecordAccessUseCase
{
    private readonly IKioskOfflineCachingService _offlineCache;
    private readonly Func<string, Employee?> _employeeLookup;
    private readonly Func<string, GateStation?> _gateLookup;
    private readonly Func<AttendanceTransaction, CancellationToken, Task<bool>> _centralRecordHandler;

    public RecordAccessUseCase(
        IKioskOfflineCachingService offlineCache,
        Func<string, Employee?> employeeLookup,
        Func<string, GateStation?> gateLookup,
        Func<AttendanceTransaction, CancellationToken, Task<bool>> centralRecordHandler)
    {
        _offlineCache = offlineCache;
        _employeeLookup = employeeLookup;
        _gateLookup = gateLookup;
        _centralRecordHandler = centralRecordHandler;
    }

    public async Task<AccessResponse> ExecuteAsync(AccessRequest request, CancellationToken ct = default)
    {
        var clientEventId = request.ClientEventId ?? Guid.NewGuid();
        var employee = _employeeLookup(request.EmployeeId);
        var gate = _gateLookup(request.GateId);

        var (allowed, message) = EvaluateDecision(employee, gate, request.QrToken);
        var result = allowed ? AccessResult.Allowed : AccessResult.Denied;

        if (_offlineCache.IsNetworkOnline)
        {
            try
            {
                var tx = new AttendanceTransaction
                {
                    ClientEventId = clientEventId,
                    EmployeeId = request.EmployeeId,
                    GateStationId = request.GateId,
                    ScannedAtUtc = request.Timestamp.ToUniversalTime(),
                    Result = result,
                    Status = "Recorded",
                    DenyReason = allowed ? null : message,
                    WasOfflineCached = false
                };

                var saved = await _centralRecordHandler(tx, ct);
                if (saved)
                {
                    return new AccessResponse(allowed, message, false, clientEventId);
                }
            }
            catch
            {
                // Network failure during central call -> fallback to local offline cache
            }
        }

        var offlineEntry = new OfflineScanEntry
        {
            ClientEventId = clientEventId,
            EmployeeId = request.EmployeeId,
            GateStationId = request.GateId,
            QrToken = request.QrToken,
            ScannedAtUtc = request.Timestamp.ToUniversalTime(),
            LocalDecision = result,
            DenyReason = allowed ? null : message,
            SyncStatus = OfflineSyncStatus.PendingSync
        };

        await _offlineCache.EnqueueAsync(offlineEntry, ct);

        var offlineMsg = allowed
            ? $"{message} (Đã lưu bộ nhớ đệm cục bộ)"
            : $"{message} (Đã ghi nhận offline)";

        return new AccessResponse(allowed, offlineMsg, true, clientEventId);
    }

    private static (bool Allowed, string Message) EvaluateDecision(Employee? employee, GateStation? gate, string qrToken)
    {
        if (string.IsNullOrWhiteSpace(qrToken) || qrToken.Length < 10)
            return (false, "Từ chối: Mã QR không hợp lệ hoặc đã hết hạn.");

        if (gate is null)
            return (false, "Từ chối: Không tìm thấy trạm cổng.");

        if (gate.IsUnderMaintenance)
            return (false, "Từ chối: Cổng đang bảo trì.");

        if (employee is null)
            return (false, "Từ chối: Không tìm thấy nhân viên.");

        if (employee.IsLocked)
            return (false, "Từ chối: Tài khoản nhân viên đang bị khóa.");

        return (true, $"Mời qua cổng ({employee.FullName})");
    }
}
