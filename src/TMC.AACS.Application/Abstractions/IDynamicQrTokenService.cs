namespace TMC.AACS.Domain.Services;

public interface IDynamicQrTokenService
{
    Task<bool> ValidateTokenAsync(string token);
}