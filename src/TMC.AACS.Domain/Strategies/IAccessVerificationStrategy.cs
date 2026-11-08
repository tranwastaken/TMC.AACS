namespace TMC.AACS.Domain.Strategies;

public interface IAccessVerificationStrategy
{
    Task<bool> VerifyAsync(string qrToken);
}