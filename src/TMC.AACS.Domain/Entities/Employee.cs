namespace TMC.AACS.Domain.Entities;

/// <summary>Nhân viên. Thuộc UC1 (quản lý nhân viên và QR), UC3 chỉ đọc để quyết định cho vào.</summary>
public class Employee
{
    public Guid Id { get; set; }
    public string FullName { get; set; } = string.Empty;
    public bool IsLocked { get; set; } 
}