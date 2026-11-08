using TMC.AACS.Domain.Entities;
using TMC.AACS.Domain.Repositories;
namespace TMC.AACS.Application.Abstractions;
public interface IAttendanceRepository : IRepository<AttendanceTransaction>
{
    Task SaveAsync(AttendanceTransaction transaction);
}
