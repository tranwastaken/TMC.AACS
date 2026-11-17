# Giao diện web TMC AACS

Giao diện nằm trong `src/TMC.AACS.Presentation/wwwroot/` và được server phục vụ cùng địa chỉ với API (đã có sẵn `UseDefaultFiles()` và `UseStaticFiles()` trong `Program.cs`), nên không cần cấu hình CORS.

## Ba màn hình và vai trò

| Màn hình | Mở cho một vai trò | Dùng cho |
|---|---|---|
| Thẻ ra vào | `/?vaitro=nhanvien` | Điện thoại nhân viên: hiển thị mã QR động (đổi mã mỗi 15 giây). |
| Kiosk cổng | `/?vaitro=cong` | Thiết bị tại Gate Station. Đọc mã bằng camera (webcam laptop, camera máy tính bảng) hoặc máy quét USB gõ nội dung mã vào ô nhập rồi nhấn Enter. |
| Quản lý | `/?vaitro=quanly` | HR, bảo vệ, quản trị: xem lượt quét, lọc theo kết quả/cổng, khóa nhân viên, chuyển cổng sang bảo trì. |

- Có `?vaitro=`: thanh tab bị ẩn, thiết bị chỉ thấy màn hình của mình, góc trên ghi tên vai trò.
- Không có `?vaitro=`: hiện đủ ba tab (`/#the`, `/#kiosk`, `/#quanly`), tiện khi trình bày trên một máy.

Việc ẩn tab chỉ là hiển thị cho gọn. Phân quyền thật phải do server kiểm tra: nhân viên đăng nhập và chỉ lấy được mã của chính mình, thiết bị cổng xác thực bằng chứng chỉ, trang Quản lý theo vai trò RBAC (chương 5 của báo cáo).

Chạy trên một máy: `dotnet run --project src/TMC.AACS.Presentation` rồi mở địa chỉ hiện trong terminal (mặc định `http://localhost:5000`).

## Chạy demo trên điện thoại và laptop

Laptop làm cổng (chạy server và mở camera), điện thoại làm máy của nhân viên. Hai máy phải cùng một mạng Wi-Fi.

1. Trên laptop, chạy server cho phép máy khác trong mạng truy cập:

   ```bash
   dotnet run --project src/TMC.AACS.Presentation -- --urls "http://0.0.0.0:5000"
   ```

   Nếu Windows hỏi tường lửa cho `dotnet`, chọn cho phép ở mạng **Private**.

2. Xem địa chỉ IP của laptop: chạy `ipconfig`, lấy dòng `IPv4 Address` của card Wi-Fi (ví dụ `192.168.1.23`).

3. Trên laptop, mở **`http://localhost:5000/?vaitro=cong`** (phải là `localhost`, xem lưu ý camera bên dưới). Chọn Gate Station, bấm **Bật camera**, cho phép trình duyệt dùng camera.

4. Trên điện thoại, mở **`http://192.168.1.23:5000/?vaitro=nhanvien`** (gõ đủ `http://`). Chọn nhân viên, tăng độ sáng màn hình.

5. Đưa mã QR trên điện thoại vào khung vàng trước webcam, cách khoảng 20–30 cm. Biển chuyển xanh **Mời qua cổng** kèm tiếng bíp.

6. Mở thêm tab `http://localhost:5000/?vaitro=quanly` trên laptop để xem lượt quét. Ở chế độ demo, tab này tự cập nhật khi tab Kiosk ghi lượt mới.

Kịch bản thử nên trình bày:

| Thao tác | Kết quả |
|---|---|
| Nguyễn Văn An quét tại Cổng A | Cho phép |
| Chụp màn hình mã, quét xong, đưa điện thoại ra khỏi camera vài giây rồi đưa ảnh chụp vào | Từ chối: mã đã dùng hoặc hết hạn |
| Để quá 30 giây rồi đưa ảnh chụp cũ | Từ chối: mã hết hạn |
| Chọn Võ Quốc Huy (đang bị khóa) | Từ chối: tài khoản bị khóa |
| Laptop chọn Cổng B – Bình Dương (đang bảo trì) | Từ chối: cổng bảo trì |
| Tab Quản lý bấm Khóa một nhân viên, rồi người đó quét | Từ chối ngay ở Kiosk |

Lưu ý:

- **Camera chỉ bật được khi trang mở bằng `localhost` hoặc `https`.** Đây là quy định của trình duyệt. Vì vậy máy làm cổng phải tự mở trang bằng `localhost`. Điện thoại chỉ hiển thị mã, không cần camera, nên mở bằng IP qua `http` vẫn được.
- Mạng Wi-Fi trường hoặc công ty thường chặn các máy nhìn thấy nhau. Khi đó bật **Mobile hotspot** trên laptop (Settings → Network & internet → Mobile hotspot), cho điện thoại kết nối vào, rồi dùng IP `192.168.137.1`.
- Nếu điện thoại không vào được dù cùng Wi-Fi: đổi mạng trên laptop sang Private (Settings → Network & internet → Wi-Fi → tên mạng → Network profile type → Private), hoặc mở cổng 5000 bằng PowerShell chạy quyền Administrator:

  ```powershell
  New-NetFirewallRule -DisplayName "TMC AACS 5000" -Direction Inbound -Protocol TCP -LocalPort 5000 -Action Allow -Profile Private
  ```

- Bật tự đồng bộ giờ trên cả hai máy. Mã hết hạn sau 30 giây tính theo đồng hồ của máy cổng.
- Người vừa quét còn để điện thoại trước camera thì Kiosk không xử lý lại (kể cả khi mã tự đổi sau 15 giây), cho đến khi rời khung hình quá 6 giây.
- Ở chế độ demo, mỗi thiết bị giữ dữ liệu riêng: điện thoại không thấy lượt quét do laptop ghi nhận. Khi có API thật, mọi thiết bị dùng chung dữ liệu trên server.

## Chế độ demo

Khi tải trang, giao diện gọi `GET /api/health` rồi thử `GET /api/gates`:

- Nếu `/api/gates` trả về mảng JSON → dùng **API thật**.
- Nếu chưa có endpoint (như code hiện tại) hoặc server không chạy → dùng **dữ liệu demo** lưu trong trình duyệt và hiện băng vàng báo "Đang dùng dữ liệu demo".

Chế độ demo mô phỏng đúng luồng của `RecordAccessUseCase` và `AccessDecisionEngine` (cùng thứ tự kiểm tra, cùng thông báo tiếng Việt), cộng thêm:

- Token hết hạn sau 30 giây; mỗi token (`jti`) chỉ dùng được một lần.
- Lượt bị từ chối cũng được ghi kèm lý do (theo FR-13 và chú thích của `AttendanceTransaction`).

Token demo có dạng `<thời điểm tạo, base36>.<jti>.<chữ ký>`. Chữ ký phủ cả mã nhân viên, nên sửa mã nhân viên trong QR sẽ bị từ chối. Khóa ký nằm ngay trong `api.js` để điện thoại và laptop cùng kiểm tra được mà không cần server, nên chỉ dùng để demo, không an toàn; token thật do UC1 ký.

## Nội dung mã QR

```
AACS1|<employeeId>|<qrToken>
```

Kiosk tách chuỗi này để điền vào `AccessRequest.EmployeeId` và `AccessRequest.QrToken`.

Nên giữ `qrToken` ngắn (dưới khoảng 100 ký tự). Chuỗi càng dài thì mã QR càng dày, webcam laptop càng khó đọc. Bản demo dài 69 ký tự, cho mã QR 37×37 ô.

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
├── js/app.js         điều khiển ba màn hình, vai trò (?vaitro=) và camera quét mã
├── js/qrcode.js      thư viện tạo mã QR (qrcode-generator, MIT, Kazuhiko Arase)
├── js/jsQR.js        thư viện đọc mã QR từ hình camera (jsQR 1.4.0, Apache 2.0, Cosmo Wolfe)
└── js/jsQR-LICENSE.txt
```
