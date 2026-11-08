using TMC.AACS.Infrastructure;

var builder = WebApplication.CreateBuilder(args);

// Composition root: chỗ DUY NHẤT của Presentation được dùng Infrastructure.
builder.Services.AddInfrastructure();

var app = builder.Build();

// Phục vụ giao diện web (wwwroot/index.html) cùng địa chỉ với API, nên không cần cấu hình CORS.
app.UseDefaultFiles();
app.UseStaticFiles();

// Endpoint kiểm tra server sống. Các endpoint nghiệp vụ (quét QR, tạo QR...) sẽ thêm sau.
app.MapGet("/api/health", () => Results.Ok(new { status = "ok", service = "TMC.AACS" }));

app.Run();
