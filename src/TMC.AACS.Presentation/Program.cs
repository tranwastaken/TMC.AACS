using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Serialization;
using TMC.AACS.Application.Abstractions;
using TMC.AACS.Application.UseCases;
using TMC.AACS.Domain.Entities;
using TMC.AACS.Infrastructure.Persistence;

var builder = WebApplication.CreateBuilder(args);

builder.Services.ConfigureHttpJsonOptions(o =>
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

var employees = new ConcurrentDictionary<string, Employee>(new[]
{
    KeyValuePair.Create("EMP001", new Employee { Id = "EMP001", Code = "TMC-001", FullName = "Nguyễn Văn An", Factory = "Long An", Team = "Lắp ráp A", IsLocked = false }),
    KeyValuePair.Create("EMP002", new Employee { Id = "EMP002", Code = "TMC-002", FullName = "Võ Quốc Huy", Factory = "Bình Dương", Team = "Kho vận", IsLocked = true }),
    KeyValuePair.Create("EMP003", new Employee { Id = "EMP003", Code = "TMC-003", FullName = "Trần Thị Mai", Factory = "Long An", Team = "QC", IsLocked = false }),
    KeyValuePair.Create("EMP004", new Employee { Id = "EMP004", Code = "TMC-004", FullName = "Lê Hoàng Nam", Factory = "Bình Dương", Team = "Bảo trì", IsLocked = false })
});

var gates = new ConcurrentDictionary<string, GateStation>(new[]
{
    KeyValuePair.Create("GATE-A", new GateStation { Id = "GATE-A", Location = "Cổng A – Long An", IsUnderMaintenance = false }),
    KeyValuePair.Create("GATE-B", new GateStation { Id = "GATE-B", Location = "Cổng B – Bình Dương", IsUnderMaintenance = true }),
    KeyValuePair.Create("GATE-C", new GateStation { Id = "GATE-C", Location = "Cổng C – Long An", IsUnderMaintenance = false })
});

var centralAttendance = new ConcurrentDictionary<Guid, AttendanceTransaction>();

Task<bool> SaveToCentralAsync(AttendanceTransaction tx, CancellationToken _)
{
    centralAttendance.TryAdd(tx.ClientEventId, tx);
    return Task.FromResult(true);
}

Task<bool> SyncOfflineEntryAsync(OfflineScanEntry entry, CancellationToken _)
{
    var tx = new AttendanceTransaction
    {
        ClientEventId = entry.ClientEventId,
        EmployeeId = entry.EmployeeId,
        GateStationId = entry.GateStationId,
        ScannedAtUtc = entry.ScannedAtUtc,
        Result = entry.LocalDecision,
        Status = "SyncedFromOffline",
        DenyReason = entry.DenyReason,
        WasOfflineCached = true
    };
    centralAttendance.TryAdd(tx.ClientEventId, tx);
    return Task.FromResult(true);
}

builder.Services.AddSingleton<IKioskOfflineCachingService>(sp =>
{
    var logger = sp.GetRequiredService<ILogger<KioskOfflineCachingService>>();
    // Azure App Service stores writable files under HOME; fallback to BaseDirectory locally
    var baseDir = Environment.GetEnvironmentVariable("HOME") ?? AppContext.BaseDirectory;
    var dbPath = Path.Combine(baseDir, "kiosk_offline_cache.db");
    return new KioskOfflineCachingService(dbPath, logger);
});

builder.Services.AddSingleton(sp => new RecordAccessUseCase(
    sp.GetRequiredService<IKioskOfflineCachingService>(),
    id => employees.GetValueOrDefault(id),
    id => gates.GetValueOrDefault(id),
    SaveToCentralAsync
));

builder.Services.AddHostedService(sp => new OfflineSyncBackgroundService(
    sp.GetRequiredService<IKioskOfflineCachingService>(),
    SyncOfflineEntryAsync,
    sp.GetRequiredService<ILogger<OfflineSyncBackgroundService>>()
));

var app = builder.Build();
app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));

app.MapGet("/api/employees", () => Results.Ok(employees.Values.OrderBy(e => e.Id)));

app.MapPatch("/api/employees/{id}", (string id, EmployeePatchRequest patch) =>
{
    if (!employees.TryGetValue(id, out var emp)) return Results.NotFound();
    emp.IsLocked = patch.IsLocked;
    return Results.Ok(emp);
});

app.MapPost("/api/qr/token", (QrTokenRequest req) =>
{
    var created = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
    var jti = Guid.NewGuid().ToString("N")[..8];
    var raw = $"{req.EmployeeId}.{created}.{jti}";
    var sig = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(raw)))[..10].ToLowerInvariant();
    return Results.Ok(new
    {
        token = $"{created}.{jti}.{sig}",
        expiresAtUtc = DateTime.UtcNow.AddSeconds(30)
    });
});

app.MapGet("/api/gates", () => Results.Ok(gates.Values.OrderBy(g => g.Id)));

app.MapPatch("/api/gates/{id}", (string id, GatePatchRequest patch) =>
{
    if (!gates.TryGetValue(id, out var gate)) return Results.NotFound();
    gate.IsUnderMaintenance = patch.IsUnderMaintenance;
    return Results.Ok(gate);
});

app.MapPost("/api/access/scan", async (AccessRequest request, RecordAccessUseCase useCase, CancellationToken ct) =>
    Results.Ok(await useCase.ExecuteAsync(request, ct)));

app.MapGet("/api/attendance", (int limit = 200) =>
    Results.Ok(centralAttendance.Values.OrderByDescending(t => t.ScannedAtUtc).Take(limit)));

app.MapGet("/api/offline-cache/status", async (IKioskOfflineCachingService cache, CancellationToken ct) =>
    Results.Ok(await cache.GetStatusAsync(ct)));

app.Run();

public sealed record EmployeePatchRequest(bool IsLocked);
public sealed record GatePatchRequest(bool IsUnderMaintenance);
public sealed record QrTokenRequest(string EmployeeId);
