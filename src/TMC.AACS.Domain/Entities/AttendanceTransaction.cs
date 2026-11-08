namespace TMC.AACS.Domain.Entities;

public enum AccessResult
{
    Allowed,
    Denied
}

/// <summary>
/// Một lượt quét tại cổng, kể cả khi bị từ chối (kèm lý do).
/// Chỉ ghi thêm, không sửa hay xóa (append-only).
/// </summary>
public class AttendanceTransaction
{
    public Guid Id { get; set; }
    public Guid EmployeeId { get; set; }
    public Guid GateStationId { get; set; }
    public DateTime ScannedAtUtc { get; set; }
    public AccessResult Result { get; set; }
    public string Status { get; set; } = "GRANTED";
    public string? DenyReason { get; set; }
}