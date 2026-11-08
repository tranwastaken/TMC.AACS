using Microsoft.Extensions.DependencyInjection;

namespace TMC.AACS.Infrastructure;

/// <summary>
/// Composition root cho các phụ thuộc: nơi gắn interface (Domain/Application) với bản triển khai (Infrastructure).
/// Hiện còn trống. Khi có repository, adapter Turnstile, QR verifier... thì đăng ký ở đây,
/// Presentation chỉ cần gọi một dòng AddInfrastructure() trong Program.cs.
/// </summary>
public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services)
    {
        // TODO: services.AddSingleton<IRepository<Employee>, ...>();
        return services;
    }
}
