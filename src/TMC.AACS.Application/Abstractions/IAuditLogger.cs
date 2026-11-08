namespace TMC.AACS.Application.Abstractions;
public interface IAuditLogger
{
    Task LogAsync(string message);
}