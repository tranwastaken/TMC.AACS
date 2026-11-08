using TMC.AACS.Application.Abstractions;
using TMC.AACS.Application.DTOs;
using TMC.AACS.Domain.Entities;
using TMC.AACS.Domain.Services;
using TMC.AACS.Domain.Strategies;

namespace TMC.AACS.Application.UseCases;

public class RecordAccessUseCase
{
    private readonly IAccessVerificationStrategy _verificationStrategy;
    private readonly AccessDecisionEngine _decisionEngine;
    private readonly IAttendanceRepository _attendanceRepository;
    private readonly ITurnstileGateway _turnstileGateway;
    private readonly IAuditLogger _auditLogger;

    public RecordAccessUseCase(
        IAccessVerificationStrategy verificationStrategy,
        AccessDecisionEngine decisionEngine,
        IAttendanceRepository attendanceRepository,
        ITurnstileGateway turnstileGateway,
        IAuditLogger auditLogger)
    {
        _verificationStrategy = verificationStrategy;
        _decisionEngine = decisionEngine;
        _attendanceRepository = attendanceRepository;
        _turnstileGateway = turnstileGateway;
        _auditLogger = auditLogger;
    }

    public async Task<AccessResponse> ExecuteAsync(AccessRequest request)
    {
        await _auditLogger.LogAsync($"[START] Xử lý điểm danh | Employee: {request.EmployeeId} | Gate: {request.GateId}");

        bool isQrValid = await _verificationStrategy.VerifyAsync(request.QrToken);
        if (!isQrValid)
        {
            await _auditLogger.LogAsync($"[DENIED] Mã QR không hợp lệ hoặc đã hết hạn | Employee: {request.EmployeeId}");
            return AccessResponse.Failure("Mã QR không hợp lệ hoặc đã hết hạn.");
        }

        var employee = new Employee { Id = request.EmployeeId, IsLocked = false };
        var gate = new GateStation { Id = request.GateId, IsUnderMaintenance = false };

        var decision = _decisionEngine.Evaluate(employee, gate);
        if (!decision.IsAllowed)
        {
            await _auditLogger.LogAsync($"[DENIED] Lý do: {decision.Reason} | Employee: {request.EmployeeId}");
            return AccessResponse.Failure(decision.Reason);
        }

        var transaction = new AttendanceTransaction
        {
            Id = Guid.NewGuid(),
            EmployeeId = request.EmployeeId,
            GateStationId = request.GateId,
            ScannedAtUtc = request.Timestamp,
            Status = "GRANTED"
        };
        await _attendanceRepository.SaveAsync(transaction);

        bool isGateOpened = await _turnstileGateway.SendOpenCommandAsync(request.GateId.ToString(), 5);
        if (!isGateOpened)
        {
            await _auditLogger.LogAsync($"[WARNING] Đã lưu bản ghi điểm danh nhưng thiết bị cổng không mở | Gate: {request.GateId}");
        }

        await _auditLogger.LogAsync($"[SUCCESS] Điểm danh thành công | Employee: {request.EmployeeId}");

        return AccessResponse.Success("Mở cổng và ghi nhận điểm danh thành công!");
    }
}