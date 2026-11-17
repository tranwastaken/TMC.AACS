/* =====================================================================
   api.js – Lớp gọi API cho giao diện TMC AACS.

   Hai chế độ:
   - "api"  : server đã có endpoint nghiệp vụ → gọi API thật.
   - "demo" : server chưa có endpoint (hiện tại mới có /api/health) hoặc không chạy
              → dùng dữ liệu mẫu lưu trong trình duyệt, mô phỏng đúng quy tắc của
              AccessDecisionEngine và RecordAccessUseCase trong code C#.

   Chế độ được chọn tự động khi tải trang: nếu GET /api/gates trả về mảng JSON thì dùng "api".
   Hợp đồng API dự kiến (JSON camelCase, khớp DTO/Entity hiện có) xem FRONTEND.md.
   ===================================================================== */

const AACS = {
  QR_PREFIX: 'AACS1',          // tiền tố nội dung mã QR: AACS1|<employeeId>|<token>
  TOKEN_LIFETIME_SECONDS: 30,  // token hết hạn sau 30 giây
  QR_REFRESH_SECONDS: 15,      // ứng dụng đổi mã mới mỗi 15 giây
  CLOCK_SKEW_SECONDS: 30,      // cho phép đồng hồ điện thoại chạy nhanh hơn máy cổng tối đa 30 giây
  TURNSTILE_OPEN_SECONDS: 5,
};

/* ---------- Tiện ích ---------- */

// Băm FNV-1a 32 bit. CHỈ dùng cho chữ ký mô phỏng ở chế độ demo, KHÔNG an toàn.
// Token thật do UC1 ký số (xem IDynamicQrTokenService).
function demoHash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// Chuỗi ngẫu nhiên ngắn (chữ thường + số). crypto.getRandomValues dùng được cả khi trang
// mở bằng http://<IP>:5000 trên điện thoại (khác crypto.randomUUID chỉ có trên https/localhost).
function shortRandom(length = 10) {
  const bytes = new Uint8Array(length);
  if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else bytes.forEach((_, i) => { bytes[i] = Math.random() * 256 | 0; });
  return Array.from(bytes, b => (b % 36).toString(36)).join('');
}

function newId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/** Ghép nội dung mã QR từ mã nhân viên và token. */
function buildQrContent(employeeId, token) {
  return `${AACS.QR_PREFIX}|${employeeId}|${token}`;
}

/** Tách nội dung mã QR do máy quét đọc được. Trả về null nếu sai định dạng. */
function parseQrContent(content) {
  const parts = (content || '').trim().split('|');
  if (parts.length !== 3 || parts[0] !== AACS.QR_PREFIX || !parts[1] || !parts[2]) return null;
  return { employeeId: parts[1], qrToken: parts[2] };
}

/* ---------- Dữ liệu demo (chỉ dùng khi chưa có API) ---------- */

const DemoStore = (() => {
  const KEY = 'aacs-demo-v1';

  function seed() {
    const employees = [
      { id: '6b1f0c2e-3a41-4d8e-9a10-1c2b3d4e5f01', fullName: 'Nguyễn Văn An', code: 'NV-BD-0142', factory: 'Bình Dương', team: 'Tổ đóng gói', isLocked: false },
      { id: '6b1f0c2e-3a41-4d8e-9a10-1c2b3d4e5f02', fullName: 'Trần Thị Bích Ngọc', code: 'NV-BD-0318', factory: 'Bình Dương', team: 'Kiểm tra chất lượng', isLocked: false },
      { id: '6b1f0c2e-3a41-4d8e-9a10-1c2b3d4e5f03', fullName: 'Lê Minh Khoa', code: 'NV-LA-0057', factory: 'Long An', team: 'Bảo trì thiết bị', isLocked: false },
      { id: '6b1f0c2e-3a41-4d8e-9a10-1c2b3d4e5f04', fullName: 'Phạm Thu Hà', code: 'NV-LA-0210', factory: 'Long An', team: 'Kho vận', isLocked: false },
      { id: '6b1f0c2e-3a41-4d8e-9a10-1c2b3d4e5f05', fullName: 'Võ Quốc Huy', code: 'NV-BD-0533', factory: 'Bình Dương', team: 'Lắp ráp', isLocked: true },
    ];
    const gates = [
      { id: 'a7c3e1d0-5b2f-4c6a-8e9d-0f1a2b3c4d01', location: 'Cổng A – Bình Dương, làn vào', isUnderMaintenance: false },
      { id: 'a7c3e1d0-5b2f-4c6a-8e9d-0f1a2b3c4d02', location: 'Cổng A – Bình Dương, làn ra', isUnderMaintenance: false },
      { id: 'a7c3e1d0-5b2f-4c6a-8e9d-0f1a2b3c4d03', location: 'Cổng B – Bình Dương', isUnderMaintenance: true },
      { id: 'a7c3e1d0-5b2f-4c6a-8e9d-0f1a2b3c4d04', location: 'Cổng chính – Long An, làn vào', isUnderMaintenance: false },
    ];
    // Vài lượt quét mẫu trong sáng nay để màn hình Quản lý không trống.
    const today = new Date();
    const at = (h, m) => new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, m, 0).toISOString();
    const tx = (emp, gate, time, ok, reason) => ({
      id: newId(), employeeId: employees[emp].id, gateStationId: gates[gate].id, scannedAtUtc: time,
      result: ok ? 'Allowed' : 'Denied', status: ok ? 'GRANTED' : 'DENIED', denyReason: reason || null,
    });
    const transactions = [
      tx(0, 0, at(6, 52), true),
      tx(1, 0, at(6, 55), true),
      tx(4, 0, at(6, 57), false, 'Tài khoản nhân viên đang bị khóa hoặc ngưng hoạt động.'),
      tx(2, 3, at(6, 58), true),
      tx(3, 3, at(7, 1), true),
      tx(1, 2, at(7, 3), false, 'Cổng kiểm soát hiện đang trong quá trình bảo trì.'),
    ].reverse();
    return { employees, gates, transactions, usedJti: {} };
  }

  let state = null;

  // Tab khác (ví dụ tab Quản lý và tab Kiosk trên cùng laptop) vừa ghi dữ liệu
  // → bỏ bản đang giữ trong bộ nhớ để lần đọc sau lấy bản mới.
  window.addEventListener('storage', (ev) => { if (ev.key === KEY) state = null; });

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      state = raw ? JSON.parse(raw) : seed();
    } catch (e) {
      state = seed();
    }
    return state;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* bộ nhớ trình duyệt không khả dụng */ }
  }

  function reset() {
    state = seed();
    save();
    return state;
  }

  return { KEY, load, save, reset, get state() { return state || load(); } };
})();

// Khóa ký giả lập dùng chung cho mọi thiết bị chạy bản demo (điện thoại tạo mã, laptop kiểm tra mã).
// Ai đọc được file này cũng tạo được mã hợp lệ, nên CHỈ dùng để demo.
const DEMO_SIGNING_KEY = 'tmc-aacs-demo';

/* ---------- Mô phỏng các thành phần phía server (chỉ dùng ở chế độ demo) ---------- */

const DemoServer = {
  /**
   * Mô phỏng UC1 – cấp token QR động.
   * Token gọn: <iat base36>.<jti>.<chữ ký>, khoảng 26 ký tự, để mã QR thưa và webcam laptop đọc được.
   * Chữ ký phủ cả employeeId nên sửa mã nhân viên trong QR sẽ bị phát hiện.
   */
  issueToken(employeeId) {
    const iat = Math.floor(Date.now() / 1000).toString(36);
    const jti = shortRandom(10);
    const sig = demoHash(`${DEMO_SIGNING_KEY}|${employeeId}|${iat}|${jti}`);
    return { token: `${iat}.${jti}.${sig}`, expiresAtUtc: new Date(Date.now() + AACS.TOKEN_LIFETIME_SECONDS * 1000).toISOString() };
  },

  /** Mô phỏng IDynamicQrTokenService.ValidateTokenAsync: chữ ký, thời hạn, chống dùng lại (jti). */
  validateToken(employeeId, token, s) {
    if (!token || typeof token !== 'string') return null;
    const [iat36, jti, sig] = token.split('.');
    if (!iat36 || !jti || !sig) return null;
    if (demoHash(`${DEMO_SIGNING_KEY}|${employeeId}|${iat36}|${jti}`) !== sig) return null;
    const iat = parseInt(iat36, 36);
    const age = Math.floor(Date.now() / 1000) - iat;
    if (!Number.isFinite(age)) return null;
    if (age < -AACS.CLOCK_SKEW_SECONDS || age > AACS.TOKEN_LIFETIME_SECONDS) return null;
    if (s.usedJti[jti]) return null;
    return { e: employeeId, iat, jti };
  },

  /** Mô phỏng AccessDecisionEngine.Evaluate – cùng thứ tự kiểm tra và cùng thông báo. */
  evaluate(employee, gate) {
    if (!employee) return { isAllowed: false, reason: 'Nhân viên không tồn tại trong hệ thống.' };
    if (employee.isLocked) return { isAllowed: false, reason: 'Tài khoản nhân viên đang bị khóa hoặc ngưng hoạt động.' };
    if (!gate) return { isAllowed: false, reason: 'Cổng kiểm soát không tồn tại.' };
    if (gate.isUnderMaintenance) return { isAllowed: false, reason: 'Cổng kiểm soát hiện đang trong quá trình bảo trì.' };
    return { isAllowed: true, reason: 'Điều kiện hợp lệ. Cho phép truy cập.' };
  },

  /** Mô phỏng RecordAccessUseCase.ExecuteAsync: xác minh → quyết định → lưu → mở cổng. */
  recordAccess(request) {
    const s = DemoStore.state;
    const employee = s.employees.find(e => e.id === request.employeeId) || null;
    const gate = s.gates.find(g => g.id === request.gateId) || null;
    const record = (ok, reason) => {
      // Theo thiết kế (FR-13), lượt bị từ chối cũng được ghi kèm lý do.
      s.transactions.unshift({
        id: newId(), employeeId: request.employeeId, gateStationId: request.gateId, scannedAtUtc: request.timestamp,
        result: ok ? 'Allowed' : 'Denied', status: ok ? 'GRANTED' : 'DENIED', denyReason: ok ? null : reason,
      });
      s.transactions = s.transactions.slice(0, 300);
      DemoStore.save();
    };

    const claims = this.validateToken(request.employeeId, request.qrToken, s);
    if (!claims) {
      const msg = 'Mã QR không hợp lệ hoặc đã hết hạn.';
      record(false, msg);
      return { isSuccess: false, message: msg };
    }

    const decision = this.evaluate(employee, gate);
    if (!decision.isAllowed) {
      record(false, decision.reason);
      return { isSuccess: false, message: decision.reason };
    }

    // Đánh dấu token đã dùng; bỏ các dấu cũ hơn 5 phút (token đó đã hết hạn từ lâu).
    const cutoff = Date.now() - 5 * 60 * 1000;
    for (const k of Object.keys(s.usedJti)) if (s.usedJti[k] < cutoff) delete s.usedJti[k];
    s.usedJti[claims.jti] = Date.now();
    record(true);                          // lưu giao dịch TRƯỚC khi mở cổng
    return { isSuccess: true, message: 'Mở cổng và ghi nhận điểm danh thành công!' };
  },
};

/* ---------- Api: điểm truy cập duy nhất cho giao diện ---------- */

const Api = (() => {
  let mode = 'demo';
  let serverUp = false;

  async function request(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    if (!res.ok) {
      const err = new Error(`Máy chủ trả về lỗi ${res.status} cho ${method} ${url}.`);
      err.status = res.status;
      throw err;
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  async function detectMode() {
    try {
      const h = await fetch('/api/health', { cache: 'no-store' });
      serverUp = h.ok;
    } catch (e) {
      serverUp = false;
    }
    if (serverUp) {
      try {
        const gates = await request('GET', '/api/gates');
        if (Array.isArray(gates)) mode = 'api';
      } catch (e) { /* chưa có endpoint → giữ chế độ demo */ }
    }
    if (mode === 'demo') DemoStore.load();
    return { mode, serverUp };
  }

  return {
    detectMode,
    get mode() { return mode; },
    get serverUp() { return serverUp; },

    // UC1 – danh sách nhân viên
    async listEmployees() {
      if (mode === 'api') return request('GET', '/api/employees');
      return DemoStore.state.employees.map(e => ({ ...e }));
    },

    // UC1 – cấp token QR động cho nhân viên
    async issueQrToken(employeeId) {
      if (mode === 'api') return request('POST', '/api/qr/token', { employeeId });
      return DemoServer.issueToken(employeeId);
    },

    // UC2 – danh sách Gate Station
    async listGates() {
      if (mode === 'api') return request('GET', '/api/gates');
      return DemoStore.state.gates.map(g => ({ ...g }));
    },

    // UC3 – gửi lượt quét (body khớp AccessRequest, kết quả khớp AccessResponse)
    async scan(accessRequest) {
      if (mode === 'api') return request('POST', '/api/access/scan', accessRequest);
      await new Promise(r => setTimeout(r, 40 + Math.random() * 60)); // mô phỏng độ trễ mạng nội bộ
      return DemoServer.recordAccess(accessRequest);
    },

    // UC4 – danh sách Attendance Transaction mới nhất
    async listAttendance(limit = 100) {
      if (mode === 'api') return request('GET', `/api/attendance?limit=${limit}`);
      return DemoStore.state.transactions.slice(0, limit).map(t => ({ ...t }));
    },

    // UC1 – khóa / mở khóa nhân viên
    async setEmployeeLocked(id, isLocked) {
      if (mode === 'api') return request('PATCH', `/api/employees/${id}`, { isLocked });
      const e = DemoStore.state.employees.find(x => x.id === id);
      if (e) { e.isLocked = isLocked; DemoStore.save(); }
      return e;
    },

    // UC2 – bật / tắt trạng thái bảo trì của cổng
    async setGateMaintenance(id, isUnderMaintenance) {
      if (mode === 'api') return request('PATCH', `/api/gates/${id}`, { isUnderMaintenance });
      const g = DemoStore.state.gates.find(x => x.id === id);
      if (g) { g.isUnderMaintenance = isUnderMaintenance; DemoStore.save(); }
      return g;
    },

    resetDemo() { return DemoStore.reset(); },
  };
})();
