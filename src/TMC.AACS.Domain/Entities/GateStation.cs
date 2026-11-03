namespace TMC.AACS.Domain.Entities;

/// <summary>Trạm cổng, gắn với một cổng Turnstile. Thuộc UC2.</summary>
public class GateStation
{
    public Guid Id { get; set; }
    public string Location { get; set; } = string.Empty;
    public bool IsUnderMaintenance { get; set; } 
}