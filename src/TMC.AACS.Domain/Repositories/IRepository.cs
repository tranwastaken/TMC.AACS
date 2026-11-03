namespace TMC.AACS.Domain.Repositories;

/// <summary>
/// Hợp đồng lưu và đọc dữ liệu. Domain chỉ khai báo, Infrastructure hiện thực
/// (database, bộ nhớ, SQLite...), nên Domain không biết công nghệ lưu trữ.
/// </summary>
public interface IRepository<T>
{
    Task<T?> GetByIdAsync(Guid id);
    Task<IReadOnlyList<T>> ListAsync();
    Task AddAsync(T item);
}