# TMC AACS — Hệ thống chấm công và kiểm soát ra vào bằng mã QR

**TMC Attendance & Access Control System (AACS)**: nhân viên lấy mã QR động trên ứng dụng/web, quét tại cổng (Gate Station); hệ thống xác minh, quyết định cho vào hoặc từ chối, mở cổng Turnstile và ghi lại giao dịch chấm công để báo cáo và đồng bộ HR/Payroll.

Đồ án môn Kiến trúc phần mềm (CO3015). Công nghệ: C#, .NET 10, ASP.NET Core (Minimal API) và một web responsive chạy cùng server.

## Tổng quan hệ thống

### Kiến trúc

- **Service-based, chia 5 Business Module theo Domain Boundary.** Trước các module là một API Gateway chỉ xác thực và định tuyến; mỗi module tự kiểm tra quyền (RBAC) ở tầng Application.
- **Bên trong mỗi module: Clean Architecture 4 tầng** Presentation → Application → Domain ← Infrastructure.
- **Hạ tầng dùng chung:** API Gateway, Internal Event Bus (kèm Transactional Outbox), Database dùng chung (mỗi module sở hữu bảng riêng).
- **Hệ thống bên ngoài:** Turnstile Control System, HR/Payroll System.
- **Mã QR:** token ký số, ngắn hạn (30–60 giây), có `jti` chống dùng lại.

### Các module

| Module | Trách nhiệm | Yêu cầu |
|---|---|---|
| **UC1 – User & QR Code Management** | Hồ sơ và trạng thái nhân viên; cấp, thu hồi mã QR | FR-01..05 |
| **UC2 – Gate Station Management** | Đăng ký, cấu hình Gate Station; liên kết QR Scanner và cổng Turnstile | FR-06..09 |
| **UC3 – Attendance Event Recording** (lõi) | Nhận lượt quét, quyết định cho phép/từ chối, mở cổng, ghi Attendance Transaction | FR-10..15 |
| **UC4 – Reporting & Auditing** | Tra cứu, báo cáo chấm công, xuất dữ liệu HR/Payroll, Audit Log | FR-16..20 |
| **UC5 – System Administration** | Tài khoản, vai trò RBAC, tham số vận hành | FR-21..23 |

### Luồng chính

1. Nhân viên mở ứng dụng/web, UC1 cấp mã QR động.
2. Tại cổng, QR Scanner gửi mã QR và mã Gate Station tới hệ thống (qua API Gateway).
3. UC3 xác minh token, nạp nhân viên và cổng, quyết định cho phép hay từ chối, lưu giao dịch **trước khi** mở cổng.
4. Nếu được phép, gửi lệnh mở cổng tới Turnstile; trả kết quả cho kiosk trong ≤ 2 giây.
5. Sau phản hồi, sự kiện `AttendanceRecorded` được phát lên Event Bus; UC4 ghi Audit Log và tổng hợp báo cáo, xuất dữ liệu cho HR/Payroll.

Chi tiết sơ đồ và mô tả từng tầng xem `docs/` (Module View).

## Bốn tầng trong mỗi module

| Tầng | Vai trò |
|---|---|
| **Presentation** | Nhận request từ Client (Kiosk, App, Web Portal), chuyển cho use case, trả kết quả. Không chứa nghiệp vụ. |
| **Application** | Điều phối một use case, kiểm tra quyền, gọi Domain và các port (interface ra thế giới ngoài). |
| **Domain** | Thực thể và quy tắc nghiệp vụ cốt lõi. Không phụ thuộc tầng nào. |
| **Infrastructure** | Hiện thực các interface bằng công nghệ thật: database, API Turnstile, token QR, Audit Log, Event Bus. |

### Quy tắc phụ thuộc

`Presentation → Application → Domain ← Infrastructure` (mũi tên = "phụ thuộc vào").

- Domain không tham chiếu tầng nào và không dùng thư viện hạ tầng.
- Application chỉ biết Domain; lưu dữ liệu, gọi cổng... đi qua interface (port).
- Infrastructure hiện thực các port nên tham chiếu cả Application và Domain.
- Presentation chỉ tham chiếu Infrastructure trong `Program.cs` để đăng ký DI (`AddInfrastructure()`); không dùng kiểu của Infrastructure trong endpoint.
- Module không đọc trực tiếp bảng của module khác; trao đổi qua interface hoặc Event Bus.

Các quy tắc này được cưỡng chế bằng `ProjectReference` trong các file `.csproj`.

## Cấu trúc solution

Solution hiện là bộ khung 4 project, lấy **Module 3 (Attendance Event Recording)** làm module đại diện. Các module còn lại sẽ được thêm theo cùng khung này (cách tách theo thư mục/namespace hay project riêng sẽ do nhóm thống nhất).

```
TMC.AACS/
├── TMC.AACS.sln
├── README.md
├── .gitignore
└── src/
    ├── TMC.AACS.Domain/                  ← tầng lõi, không tham chiếu project nào
    │   ├── Entities/                     Employee, GateStation, AttendanceTransaction  (đã khai báo)
    │   ├── Repositories/                 IRepository<T>                                (đã khai báo)
    │   └── Services/                     AccessDecisionEngine
    │
    ├── TMC.AACS.Application/             ← tham chiếu: Domain
    │   ├── Abstractions/                 IUseCase<,> (đã khai báo) và các port
    │   └── UseCases/                     RecordAccessUseCase
    │
    ├── TMC.AACS.Infrastructure/          ← tham chiếu: Application, Domain
    │   ├── DependencyInjection.cs        đăng ký DI (AddInfrastructure)
    │   ├── Persistence/                  repository, cache offline (SQLite)
    │   ├── External/                     adapter cổng Turnstile
    │   └── Security/                     DynamicQrTokenService, Audit Log
    │
    └── TMC.AACS.Presentation/            ← tham chiếu: Application, Infrastructure (chỉ Program.cs)
        ├── Program.cs                    khởi động server, /api/health
        └── wwwroot/
            └── index.html                web responsive (App Nhân viên, Kiosk, Web Portal)
```

Đã có sẵn: `Employee`, `GateStation`, `AttendanceTransaction`, `IRepository<T>`, `IUseCase<,>` (chỉ khai báo, chưa có logic). Các thư mục còn lại chỉ có file giữ chỗ `.gitkeep`; tên lớp ghi bên phải là nội dung dự kiến.

## Build và chạy

Cần [.NET 10 SDK](https://dotnet.microsoft.com/download). Kiểm tra bằng `dotnet --list-sdks`; chưa có thì tự tải về cài.

```
dotnet build TMC.AACS.sln
dotnet run --project src/TMC.AACS.Presentation
```

Mở địa chỉ hiện trong terminal (ví dụ `http://localhost:5000`), hoặc kiểm tra API tại `/api/health`.
Để thử trên điện thoại, cho điện thoại cùng mạng Wi-Fi và mở `http://<IP máy>:<cổng>`.

## Làm việc với Git

- Không commit thẳng vào `main`. Mỗi người làm trên nhánh riêng, ví dụ `feature/uc1-qr`.
- Trước khi bắt đầu: `git pull origin main`.
- Xong thì push nhánh của mình và gộp vào `main` (Pull Request nếu nhóm dùng).
- Chỉ sửa trong phần việc của mình để tránh xung đột.