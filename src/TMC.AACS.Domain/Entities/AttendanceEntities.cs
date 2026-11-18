namespace TMC.AACS.Domain.Entities;

public enum AccessResult
{
    Allowed,
    Denied
}

public enum OfflineSyncStatus
{
    PendingSync,
    Syncing,
    Synced,
    Failed
}

public sealed class Employee
{
    public string Id { get; init; } = string.Empty;
    public string Code { get; init; } = string.Empty;
    public string FullName { get; init; } = string.Empty;
    public string Factory { get; init; } = string.Empty;
    public string Team { get; init; } = string.Empty;
    public bool IsLocked { get; set; }
}

public sealed class GateStation
{
    public string Id { get; init; } = string.Empty;
    public string Location { get; init; } = string.Empty;
    public bool IsUnderMaintenance { get; set; }
}

public sealed class AttendanceTransaction
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public Guid ClientEventId { get; init; }
    public string EmployeeId { get; init; } = string.Empty;
    public string GateStationId { get; init; } = string.Empty;
    public DateTime ScannedAtUtc { get; init; }
    public AccessResult Result { get; init; }
    public string Status { get; init; } = "Recorded";
    public string? DenyReason { get; init; }
    public bool WasOfflineCached { get; init; }
}

public sealed class OfflineScanEntry
{
    public Guid ClientEventId { get; init; } = Guid.NewGuid();
    public string EmployeeId { get; init; } = string.Empty;
    public string GateStationId { get; init; } = string.Empty;
    public string QrToken { get; init; } = string.Empty;
    public DateTime ScannedAtUtc { get; init; }
    public AccessResult LocalDecision { get; init; }
    public string? DenyReason { get; init; }
    public OfflineSyncStatus SyncStatus { get; set; } = OfflineSyncStatus.PendingSync;
    public int RetryCount { get; set; }
    public DateTime CreatedAtUtc { get; init; } = DateTime.UtcNow;
    public DateTime? SyncedAtUtc { get; set; }
}
