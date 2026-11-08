using TMC.AACS.Domain.Services;

namespace TMC.AACS.Domain.Strategies;

public class QrCodeVerificationStrategy : IAccessVerificationStrategy
{
    private readonly IDynamicQrTokenService _qrTokenService;

    public QrCodeVerificationStrategy(IDynamicQrTokenService qrTokenService)
    {
        _qrTokenService = qrTokenService;
    }

    public async Task<bool> VerifyAsync(string qrToken)
    {
        if (string.IsNullOrWhiteSpace(qrToken))
        {
            return false;
        }

        return await _qrTokenService.ValidateTokenAsync(qrToken);
    }
}