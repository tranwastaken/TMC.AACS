namespace TMC.AACS.Application.DTOs;

public class AccessResponse
{
    public bool IsSuccess { get; set; }
    public string Message { get; set; } = string.Empty;

    public AccessResponse() { }

    public AccessResponse(bool isSuccess, string message)
    {
        IsSuccess = isSuccess;
        Message = message;
    }

    public static AccessResponse Success(string message = "Mở cổng thành công.")
        => new(true, message);

    public static AccessResponse Failure(string message)
        => new(false, message);
}