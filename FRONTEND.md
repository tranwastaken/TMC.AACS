# Giao diện web TMC AACS

Giao diện nằm trong `src/TMC.AACS.Presentation/wwwroot/` và được server phục vụ cùng địa chỉ với API (đã có sẵn `UseDefaultFiles()` và `UseStaticFiles()` trong `Program.cs`), nên không cần cấu hình CORS.

## Ba màn hình

| Màn hình | Địa chỉ | Dùng cho |
|---|---|---|
| Thẻ ra vào | `/#the` | Nhân viên mở trên điện thoại để hiển thị mã QR động (đổi mã mỗi 15 giây). |
| Kiosk cổng | `/#kiosk` | Máy kiosk tại Gate Station. Máy quét QR dạng USB-HID gõ nội dung mã vào ô nhập rồi nhấn Enter. |
| Quản lý | `/#quanly` | HR, bảo vệ, quản trị: xem lượt quét, lọc theo kết quả/cổng, khóa nhân viên, chuyển cổng sang bảo trì. |

Chạy server (`dotnet run --project src/TMC.AACS.Presentation`) rồi mở địa chỉ hiện trong terminal. Có thể mở thẳng màn hình kiosk bằng `http://localhost:5000/#kiosk`.

## Chế độ demo

Khi tải trang, giao diện gọi `GET /api/health` rồi thử `GET /api/gates`:

- Nếu `/api/gates` trả về mảng JSON → dùng **API thật**.
- Nếu chưa có endpoint (như code hiện tại) hoặc server không chạy → dùng **dữ liệu demo** lưu trong trình duyệt và hiện băng vàng báo "Đang dùng dữ liệu demo".

Chế độ demo mô phỏng đúng luồng của `RecordAccessUseCase` và `AccessDecisionEngine` (cùng thứ tự kiểm tra, cùng thông báo tiếng Việt), cộng thêm:

- Token hết hạn sau 30 giây; mỗi token (`jti`) chỉ dùng được một lần.
- Lượt bị từ chối cũng được ghi kèm lý do (theo FR-13 và chú thích của `AttendanceTransaction`).

Chữ ký token trong chế độ demo chỉ là mô phỏng, không an toàn; token thật do UC1 ký.

## Nội dung mã QR

```
AACS1|<employeeId>|<qrToken>
```

Kiosk tách chuỗi này để điền vào `AccessRequest.EmployeeId` và `AccessRequest.QrToken`.

## Các endpoint giao diện cần

JSON dùng camelCase (mặc định của ASP.NET Core), khớp với các DTO và Entity đang có.

| Phương thức | Đường dẫn | Module | Request | Response |
|---|---|---|---|---|
| GET | `/api/health` | – | – | `{ "status": "ok" }` (đã có) |
| GET | `/api/employees` | UC1 | – | `[{ "id", "fullName", "isLocked", "code"?, "factory"?, "team"? }]` |
| POST | `/api/qr/token` | UC1 | `{ "employeeId" }` | `{ "token", "expiresAtUtc" }` |
| GET | `/api/gates` | UC2 | – | `[{ "id", "location", "isUnderMaintenance" }]` |
| POST | `/api/access/scan` | UC3 | `AccessRequest`: `{ "employeeId", "gateId", "qrToken", "timestamp" }` | `AccessResponse`: `{ "isSuccess", "message" }` |
| GET | `/api/attendance?limit=200` | UC4 | – | `[AttendanceTransaction]`: `{ "id", "employeeId", "gateStationId", "scannedAtUtc", "result", "status", "denyReason" }` |
| PATCH | `/api/employees/{id}` | UC1 | `{ "isLocked" }` | nhân viên sau khi cập nhật |
| PATCH | `/api/gates/{id}` | UC2 | `{ "isUnderMaintenance" }` | cổng sau khi cập nhật |

Các trường có dấu `?` là tùy chọn; nếu không có, giao diện chỉ hiển thị họ tên.

`result` nên được trả về dạng chuỗi (`"Allowed"`/`"Denied"`). Thêm dòng sau vào `Program.cs` để enum được trả về dạng chuỗi:

```csharp
builder.Services.ConfigureHttpJsonOptions(o =>
    o.SerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter()));
```

Ví dụ endpoint quét mã, gọi đúng use case đang có (cần đăng ký `RecordAccessUseCase` và các phụ thuộc của nó trong `AddInfrastructure()`):

```csharp
app.MapPost("/api/access/scan", async (AccessRequest request, RecordAccessUseCase useCase) =>
    Results.Ok(await useCase.ExecuteAsync(request)));
```

## Lưu ý khi nối với code hiện tại

- `RecordAccessUseCase` đang tự tạo `Employee` và `GateStation` với `IsLocked = false`, `IsUnderMaintenance = false`. Cần nạp từ repository thì giao diện mới hiển thị đúng các trường hợp nhân viên bị khóa hoặc cổng bảo trì.
- Use case hiện chưa lưu lượt bị từ chối, nên màn hình Quản lý sẽ chỉ thấy lượt được cho phép cho đến khi bổ sung.

## Cấu trúc file

```
wwwroot/
├── index.html        ba màn hình
├── css/app.css       giao diện (màu theo biển báo an toàn: xanh = cho phép, đỏ = từ chối)
├── css/fonts.css     khai báo font
├── fonts/            Barlow, Barlow Condensed (SIL OFL 1.1, có tiếng Việt, chạy được không cần Internet)
├── js/api.js         gọi API thật hoặc mô phỏng ở chế độ demo
├── js/app.js         điều khiển ba màn hình
└── js/qrcode.js      thư viện tạo mã QR (qrcode-generator, MIT, Kazuhiko Arase)
```
