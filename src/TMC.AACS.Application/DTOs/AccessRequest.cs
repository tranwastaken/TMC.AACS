namespace TMC.AACS.Application.DTOs;

public class AccessRequest
{
    public Guid EmployeeId { get; set; }
    public Guid GateId { get; set; }
    public string QrToken { get; set; } = string.Empty;
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
}