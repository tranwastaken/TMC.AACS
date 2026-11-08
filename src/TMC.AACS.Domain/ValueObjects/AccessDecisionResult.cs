namespace TMC.AACS.Domain.ValueObjects;

public class AccessDecisionResult
{
    public bool IsAllowed { get; }
    public string Reason { get; }

    private AccessDecisionResult(bool isAllowed, string reason)
    {
        IsAllowed = isAllowed;
        Reason = reason;
    }

    public static AccessDecisionResult Allowed(string reason = "Cho phép truy cập.")
        => new(true, reason);

    public static AccessDecisionResult Denied(string reason)
        => new(false, reason);
}