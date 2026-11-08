namespace TMC.AACS.Application.Abstractions;
public interface ITurnstileGateway
{
    Task<bool> SendOpenCommandAsync(string gateId, int durationSeconds);
}