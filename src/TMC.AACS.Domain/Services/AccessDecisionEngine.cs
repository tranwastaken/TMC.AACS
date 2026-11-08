using TMC.AACS.Domain.Entities;
using TMC.AACS.Domain.ValueObjects;

namespace TMC.AACS.Domain.Services;

public class AccessDecisionEngine
{
    public AccessDecisionResult Evaluate(Employee? employee, GateStation? gate)
    {
        if (employee == null)
        {
            return AccessDecisionResult.Denied("Nhân viên không tồn tại trong hệ thống.");
        }

        if (employee.IsLocked)
        {
            return AccessDecisionResult.Denied("Tài khoản nhân viên đang bị khóa hoặc ngưng hoạt động.");
        }

        if (gate == null)
        {
            return AccessDecisionResult.Denied("Cổng kiểm soát không tồn tại.");
        }

        if (gate.IsUnderMaintenance)
        {
            return AccessDecisionResult.Denied("Cổng kiểm soát hiện đang trong quá trình bảo trì.");
        }

        return AccessDecisionResult.Allowed("Điều kiện hợp lệ. Cho phép truy cập.");
    }
}