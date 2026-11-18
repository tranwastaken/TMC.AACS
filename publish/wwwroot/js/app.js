/* =====================================================================
   app.js – Điều khiển giao diện ba màn hình: Thẻ ra vào, Kiosk cổng, Quản lý.
   Mọi lời gọi dữ liệu đi qua đối tượng Api (js/api.js).
   ===================================================================== */

const $ = (id) => document.getElementById(id);

const state = {
  employees: [],
  gates: [],
  attendance: [],
  currentEmployeeId: null,
  currentQrContent: null,
  qrIssuedAt: 0,
  signTimer: null,
};

/* ---------- Vai trò thiết bị (?vaitro=) ----------
   Mỗi thiết bị chỉ hiện màn hình của mình:
     /?vaitro=nhanvien → điện thoại nhân viên, chỉ có Thẻ ra vào
     /?vaitro=cong     → máy tại cổng, chỉ có Kiosk cổng (quét bằng camera hoặc máy quét)
     /?vaitro=quanly   → HR, bảo vệ, quản trị, chỉ có Quản lý
   Không có tham số → hiện đủ ba tab để trình bày.
   Đây chỉ là ẩn/hiện giao diện. Phân quyền thật phải do server kiểm tra (đăng nhập + RBAC, chương 5). */
const ROLES = {
  nhanvien: { view: 'the', label: 'Nhân viên' },
  cong: { view: 'kiosk', label: 'Thiết bị cổng' },
  quanly: { view: 'quanly', label: 'Quản lý' },
};
const roleParam = new URLSearchParams(location.search).get('vaitro');
const role = Object.prototype.hasOwnProperty.call(ROLES, roleParam) ? roleParam : null;

/* Trạng thái camera ở Kiosk */
const camera = {
  stream: null,
  timer: null,
  canvas: null,
  ctx: null,
  busy: false,
  pausedUntil: 0,
  lastKey: '',
  lastSeenAt: 0,
  audio: null,
};
const CAMERA_PREF = 'aacs-camera';
const EMPLOYEE_PREF = 'aacs-nhanvien';
const SAME_PERSON_IGNORE_MS = 6000; // người vừa quét còn để mã trước camera thì không xử lý lại
const AFTER_RESULT_PAUSE_MS = 1200; // nghỉ ngắn sau mỗi lượt để biển kết quả kịp hiện
const SCAN_INTERVAL_MS = 120;

function readPref(key) { try { return localStorage.getItem(key) || ''; } catch (e) { return ''; } }
function writePref(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* bỏ qua */ } }

/* ---------- Tiện ích hiển thị ---------- */

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}

const fmtTime = (iso, withSeconds = false) =>
  new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: withSeconds ? '2-digit' : undefined });

const fmtDate = (iso) => new Date(iso).toLocaleDateString('vi-VN');

const isToday = (iso) => new Date(iso).toDateString() === new Date().toDateString();

const employeeById = (id) => state.employees.find(e => e.id === id);
const gateById = (id) => state.gates.find(g => g.id === id);

function employeeLabel(id) {
  const e = employeeById(id);
  return e ? e.fullName : `Mã ${String(id).slice(0, 8)}`;
}

function gateLabel(id) {
  const g = gateById(id);
  return g ? g.location : `Cổng ${String(id).slice(0, 8)}`;
}

function resultBadge(result) {
  const ok = result === 'Allowed' || result === 0;
  return el('span', { class: `result ${ok ? 'result-ok' : 'result-no'}`, text: ok ? 'Cho phép' : 'Từ chối' });
}

let toastTimer = null;
function toast(message) {
  const t = $('toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

/* ---------- Điều hướng giữa các màn hình ---------- */

const VIEWS = ['the', 'kiosk', 'quanly'];

function currentView() {
  if (role) return ROLES[role].view;
  const hash = location.hash.slice(1);
  return VIEWS.includes(hash) ? hash : 'the';
}

function applyRole() {
  if (!role) return;
  document.body.dataset.role = role;
  document.querySelector('.tabs').hidden = true;
  const chip = $('role-chip');
  chip.textContent = ROLES[role].label;
  chip.hidden = false;
  document.title = `TMC AACS – ${ROLES[role].label}`;
  if (role === 'cong') {
    // Máy cổng không có Thẻ ra vào, nên bỏ nút lấy mã từ màn hình đó.
    $('use-current-qr').hidden = true;
    $('use-current-hint').hidden = true;
  }
}

function route() {
  const view = currentView();
  VIEWS.forEach(v => { $(`view-${v}`).hidden = v !== view; });
  document.querySelectorAll('.tabs a').forEach(a => {
    if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (view !== 'kiosk' && camera.stream) stopCamera();   // rời Kiosk thì trả camera
  if (view === 'kiosk') { renderKioskHistory(); $('scan-input').focus(); }
  if (view === 'quanly') renderAdmin();
  if (view === 'the') renderEmployeeHistory();
}

/* ---------- Trạng thái máy chủ ---------- */

function renderServerStatus(info) {
  const box = $('server-status');
  const text = box.querySelector('.server-text');
  if (info.mode === 'api') {
    box.dataset.state = 'api';
    text.textContent = 'Máy chủ đang hoạt động';
  } else if (info.serverUp) {
    box.dataset.state = 'demo';
    text.textContent = 'Máy chủ chưa có API nghiệp vụ';
  } else {
    box.dataset.state = 'down';
    text.textContent = 'Không kết nối được máy chủ';
  }
  $('demo-band').hidden = info.mode === 'api';
  $('demo-reason').textContent = info.serverUp
    ? 'Máy chủ mới có /api/health. Khi nhóm thêm các endpoint trong FRONTEND.md, giao diện sẽ tự chuyển sang dữ liệu thật.'
    : 'Giao diện đang mở mà không có máy chủ. Chạy dotnet run để dùng cùng server.';
}

/* ---------- Thẻ ra vào ---------- */

function fillEmployeeSelect() {
  const sel = $('the-employee');
  sel.replaceChildren(...state.employees.map(e => el('option', { value: e.id, text: e.fullName })));
  if (!state.currentEmployeeId || !employeeById(state.currentEmployeeId)) {
    // Điện thoại nhớ người đã chọn lần trước (thay cho đăng nhập trong bản demo).
    const saved = readPref(EMPLOYEE_PREF);
    state.currentEmployeeId = employeeById(saved) ? saved : (state.employees.length ? state.employees[0].id : null);
  }
  sel.value = state.currentEmployeeId || '';
}

function renderEmployeeCard() {
  const e = employeeById(state.currentEmployeeId);
  $('the-name').textContent = e ? e.fullName : 'Chưa có nhân viên';
  const meta = e ? [e.code, e.factory, e.team].filter(Boolean).join(', ') : '';
  $('the-meta').textContent = meta || (e ? `Mã nhân viên ${e.id.slice(0, 8)}` : '');
  $('the-warning').hidden = !(e && e.isLocked);
}

async function refreshQr() {
  const id = state.currentEmployeeId;
  if (!id) return;
  try {
    const res = await Api.issueQrToken(id);
    state.currentQrContent = buildQrContent(id, res.token);
    state.qrIssuedAt = Date.now();
    const qr = qrcode(0, 'M');
    qr.addData(state.currentQrContent);
    qr.make();
    $('the-qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  } catch (err) {
    $('the-qr').replaceChildren(el('p', { class: 'field-hint', text: `Không tạo được mã: ${err.message}` }));
  }
}

function tickQr() {
  if (!state.qrIssuedAt) return;
  const elapsed = (Date.now() - state.qrIssuedAt) / 1000;
  const left = Math.max(0, AACS.QR_REFRESH_SECONDS - elapsed);
  $('the-bar').style.transform = `scaleX(${left / AACS.QR_REFRESH_SECONDS})`;
  $('the-bar').parentElement.classList.toggle('low', left <= 4);
  $('the-countdown').textContent = `Mã mới sau ${Math.ceil(left)} giây`;
  if (left <= 0) { state.qrIssuedAt = 0; refreshQr(); }
}

function historyItem(t, label) {
  return el('li', {},
    el('time', { datetime: t.scannedAtUtc, text: fmtTime(t.scannedAtUtc) }),
    el('span', { text: label }),
    resultBadge(t.result));
}

function renderEmployeeHistory() {
  const list = $('the-history');
  const rows = state.attendance.filter(t => t.employeeId === state.currentEmployeeId).slice(0, 5);
  list.replaceChildren(...(rows.length
    ? rows.map(t => historyItem(t, gateLabel(t.gateStationId)))
    : [el('li', {}, el('span', { class: 'empty', text: 'Chưa có lượt ra vào nào hôm nay.' }))]));
}

/* ---------- Kiosk cổng ---------- */

function fillGateSelects() {
  const kiosk = $('kiosk-gate');
  const prev = kiosk.value;
  kiosk.replaceChildren(...state.gates.map(g =>
    el('option', { value: g.id, text: g.isUnderMaintenance ? `${g.location} (đang bảo trì)` : g.location })));
  if (prev && gateById(prev)) kiosk.value = prev;

  const filter = $('ql-gate');
  const prevFilter = filter.value;
  filter.replaceChildren(el('option', { value: 'all', text: 'Tất cả cổng' }),
    ...state.gates.map(g => el('option', { value: g.id, text: g.location })));
  filter.value = prevFilter && (prevFilter === 'all' || gateById(prevFilter)) ? prevFilter : 'all';
}

function setSign(kind, title, name, detail, foot) {
  const sign = $('sign');
  sign.className = `sign sign-${kind}`;
  $('sign-title').textContent = title;
  $('sign-name').textContent = name || '';
  $('sign-detail').textContent = detail || '';
  $('sign-foot').textContent = foot || '';
  clearTimeout(state.signTimer);
  if (kind === 'go' || kind === 'stop') {
    state.signTimer = setTimeout(setIdleSign, 6000);
  }
}

function setIdleSign() {
  setSign('idle', 'Mời quét mã', camera.stream
    ? 'Đưa mã QR trên điện thoại vào trước camera'
    : 'Đưa mã QR trên điện thoại vào máy quét');
}

function refreshIdleSign() {
  if ($('sign').classList.contains('sign-idle')) setIdleSign();
}

async function handleScan(content) {
  const gateId = $('kiosk-gate').value;
  const gate = gateById(gateId);
  const parsed = parseQrContent(content);
  const now = new Date();

  if (!parsed) {
    setSign('stop', 'Không đọc được mã', '', 'Mã này không phải mã ra vào của TMC. Mở lại ứng dụng và quét mã đang hiển thị.',
      `${gate ? gate.location : ''}, lúc ${fmtTime(now.toISOString(), true)}`);
    beep(false);
    return;
  }

  // Thân request khớp lớp AccessRequest trong TMC.AACS.Application/DTOs
  const accessRequest = {
    employeeId: parsed.employeeId,
    gateId,
    qrToken: parsed.qrToken,
    timestamp: now.toISOString(),
  };

  setSign('busy', 'Đang kiểm tra…');
  const t0 = performance.now();
  try {
    const res = await Api.scan(accessRequest);          // kết quả khớp AccessResponse
    const ms = Math.round(performance.now() - t0);
    const foot = `${gate ? gate.location : ''}, lúc ${fmtTime(now.toISOString(), true)}. Phản hồi trong ${ms} ms.`;
    if (res.isSuccess) setSign('go', 'Mời qua cổng', employeeLabel(parsed.employeeId), res.message, foot);
    else setSign('stop', 'Không được vào', employeeLabel(parsed.employeeId), res.message, foot);
    beep(res.isSuccess);
  } catch (err) {
    setSign('stop', 'Chưa kiểm tra được mã', '', 'Không liên lạc được máy chủ. Báo bảo vệ để được hỗ trợ qua cổng.', err.message);
    beep(false);
  }
  await reloadAttendance();
  renderKioskHistory();
}

function renderKioskHistory() {
  const gateId = $('kiosk-gate').value;
  const rows = state.attendance.filter(t => t.gateStationId === gateId).slice(0, 6);
  $('kiosk-history').replaceChildren(...(rows.length
    ? rows.map(t => historyItem(t, employeeLabel(t.employeeId)))
    : [el('li', {}, el('span', { class: 'empty', text: 'Chưa có lượt quét nào tại cổng này.' }))]));
}

/* ---------- Camera quét mã (Kiosk) ----------
   Lấy hình từ webcam, cứ ~120 ms đọc một khung bằng jsQR. Đọc được mã thì gọi handleScan,
   giống hệt khi máy quét USB gõ nội dung mã vào ô nhập. */

function cameraHint(text, isError = false) {
  const hint = $('camera-hint');
  hint.textContent = text;
  hint.classList.toggle('hint-error', isError);
}

function cameraErrorMessage(err) {
  switch (err && err.name) {
    case 'NotAllowedError':
      return 'Trình duyệt đang chặn camera. Bấm biểu tượng bên trái thanh địa chỉ, chọn cho phép Camera, rồi bấm Bật camera lại.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Không tìm thấy camera trên máy này.';
    case 'NotReadableError':
      return 'Camera đang được ứng dụng khác dùng (Zoom, Teams, ứng dụng Camera…). Tắt ứng dụng đó rồi bấm Bật camera lại.';
    default:
      return `Không mở được camera: ${err && err.message ? err.message : err}`;
  }
}

async function fillCameraDevices(currentId) {
  const select = $('camera-device');
  let cams = [];
  try { cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'); } catch (e) { /* bỏ qua */ }
  select.replaceChildren(...cams.map((d, i) => el('option', { value: d.deviceId, text: d.label || `Camera ${i + 1}` })));
  if (currentId) select.value = currentId;
  select.hidden = cams.length < 2;   // chỉ hiện khi máy có từ 2 camera trở lên
}

async function startCamera() {
  // Trình duyệt chỉ cấp camera cho trang "an toàn": https, hoặc http://localhost.
  if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const port = location.port ? `:${location.port}` : '';
    cameraHint(`Trình duyệt chỉ cho dùng camera khi trang mở bằng localhost hoặc https. Trên máy làm cổng, mở http://localhost${port}/?vaitro=cong thay vì địa chỉ IP.`, true);
    return;
  }
  if (typeof jsQR !== 'function') {
    cameraHint('Thiếu file js/jsQR.js nên chưa đọc được mã từ camera.', true);
    return;
  }

  stopCamera();
  const deviceId = $('camera-device').value || readPref(CAMERA_PREF);
  const video = { width: { ideal: 1280 }, height: { ideal: 720 } };
  if (deviceId) video.deviceId = { exact: deviceId };
  else video.facingMode = { ideal: 'environment' };   // máy tính bảng: ưu tiên camera sau

  try {
    camera.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
  } catch (err) {
    if (deviceId && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
      // Camera đã chọn lần trước không còn cắm → quay về camera mặc định.
      writePref(CAMERA_PREF, '');
      $('camera-device').replaceChildren();
      return startCamera();
    }
    cameraHint(cameraErrorMessage(err), true);
    return;
  }

  const v = $('camera-video');
  const track = camera.stream.getVideoTracks()[0];
  const settings = track && track.getSettings ? track.getSettings() : {};
  // Webcam hướng về người dùng thì lật ngang hình xem trước cho dễ canh, như soi gương.
  // Chỉ lật phần hiển thị; khung hình đưa vào jsQR vẫn giữ nguyên.
  v.classList.toggle('mirror', settings.facingMode !== 'environment');
  v.srcObject = camera.stream;
  try { await v.play(); } catch (e) { /* video sẽ tự phát khi có hình */ }

  $('camera-frame').hidden = false;
  $('camera-toggle').textContent = 'Tắt camera';
  cameraHint('Đưa mã QR trên điện thoại vào khung vàng, cách camera khoảng 20–30 cm. Nếu đọc chậm, tăng độ sáng màn hình điện thoại.');
  if (settings.deviceId) writePref(CAMERA_PREF, settings.deviceId);
  await fillCameraDevices(settings.deviceId);

  if (!camera.canvas) {
    camera.canvas = document.createElement('canvas');
    camera.ctx = camera.canvas.getContext('2d', { willReadFrequently: true });
  }
  camera.lastKey = '';
  refreshIdleSign();
  scheduleCameraScan();
}

function stopCamera() {
  clearTimeout(camera.timer);
  camera.timer = null;
  if (camera.stream) camera.stream.getTracks().forEach(t => t.stop());
  camera.stream = null;
  $('camera-video').srcObject = null;
  $('camera-frame').hidden = true;
  $('camera-toggle').textContent = 'Bật camera';
  refreshIdleSign();
}

function scheduleCameraScan() {
  if (camera.stream) camera.timer = setTimeout(scanCameraFrame, SCAN_INTERVAL_MS);
}

function scanCameraFrame() {
  try {
    const v = $('camera-video');
    if (!camera.stream || camera.busy || Date.now() < camera.pausedUntil) return;
    if (v.readyState < 2 || !v.videoWidth) return;

    // Thu nhỏ khung hình về tối đa 960 px chiều ngang cho nhẹ máy.
    const scale = Math.min(1, 960 / v.videoWidth);
    const w = Math.round(v.videoWidth * scale);
    const h = Math.round(v.videoHeight * scale);
    if (camera.canvas.width !== w || camera.canvas.height !== h) { camera.canvas.width = w; camera.canvas.height = h; }
    camera.ctx.drawImage(v, 0, 0, w, h);
    const code = jsQR(camera.ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
    if (!code || !code.data) return;

    // Người vừa quét vẫn để điện thoại trước camera (kể cả khi mã tự đổi sau 15 giây) thì bỏ qua,
    // cho đến khi rời khung hình quá 6 giây. Đưa lại mã cũ sau đó sẽ bị từ chối vì mã đã dùng.
    const parsed = parseQrContent(code.data);
    const key = parsed ? parsed.employeeId : code.data;
    const now = Date.now();
    const seenRecently = key === camera.lastKey && now - camera.lastSeenAt < SAME_PERSON_IGNORE_MS;
    camera.lastKey = key;
    camera.lastSeenAt = now;
    if (seenRecently) return;

    camera.busy = true;
    handleScan(code.data).finally(() => {
      camera.busy = false;
      camera.pausedUntil = Date.now() + AFTER_RESULT_PAUSE_MS;
    });
  } finally {
    scheduleCameraScan();
  }
}

/* Tiếng bíp như máy quét thật: cao và ngắn khi cho phép, trầm và dài hơn khi từ chối. */
function beep(ok) {
  const ctx = camera.audio;
  if (!ctx) return;   // chỉ kêu sau khi người dùng đã bấm Bật camera (trình duyệt yêu cầu)
  try {
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const length = ok ? 0.15 : 0.35;
    osc.type = ok ? 'sine' : 'square';
    osc.frequency.value = ok ? 1046 : 220;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + length);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + length + 0.01);
  } catch (e) { /* bỏ qua nếu máy không phát được âm thanh */ }
}

async function maybeAutoStartCamera() {
  // Máy cổng đã từng cho phép camera thì tự bật khi mở trang, không cần bấm.
  if (role !== 'cong' || !navigator.permissions) return;
  try {
    const p = await navigator.permissions.query({ name: 'camera' });
    if (p.state === 'granted') startCamera();
  } catch (e) { /* trình duyệt không hỗ trợ hỏi trạng thái quyền camera */ }
}

/* ---------- Quản lý ---------- */

function renderAdmin() {
  const resultFilter = $('ql-result').value;
  const gateFilter = $('ql-gate').value;

  const today = state.attendance.filter(t => isToday(t.scannedAtUtc));
  const denied = today.filter(t => t.result !== 'Allowed' && t.result !== 0).length;
  $('ql-summary').textContent = `${today.length} lượt quét, ${denied} lượt bị từ chối.`;

  const rows = state.attendance.filter(t =>
    (resultFilter === 'all' || t.result === resultFilter) &&
    (gateFilter === 'all' || t.gateStationId === gateFilter));

  $('ql-rows').replaceChildren(...(rows.length ? rows.map(t => {
    const emp = employeeById(t.employeeId);
    return el('tr', {},
      el('td', {}, fmtTime(t.scannedAtUtc, true), isToday(t.scannedAtUtc) ? null : el('span', { class: 'sub', text: fmtDate(t.scannedAtUtc) })),
      el('td', {}, employeeLabel(t.employeeId), emp && emp.code ? el('span', { class: 'sub', text: emp.code }) : null),
      el('td', { text: gateLabel(t.gateStationId) }),
      el('td', {}, resultBadge(t.result)),
      el('td', { class: 'reason', text: t.denyReason || '' }));
  }) : [el('tr', { class: 'empty-row' }, el('td', { colspan: '5', text: 'Không có lượt quét nào khớp bộ lọc.' }))]));

  $('ql-employees').replaceChildren(...state.employees.map(e => {
    const btn = el('button', { type: 'button', class: 'btn btn-small', text: e.isLocked ? 'Mở khóa' : 'Khóa' });
    btn.addEventListener('click', async () => {
      try {
        await Api.setEmployeeLocked(e.id, !e.isLocked);
        toast(e.isLocked ? `Đã mở khóa ${e.fullName}.` : `Đã khóa ${e.fullName}.`);
        await reloadAll();
      } catch (err) { toast(`Chưa đổi được trạng thái: ${err.message}`); }
    });
    return el('li', {},
      el('span', { class: 'who' }, e.fullName,
        el('span', { class: `sub ${e.isLocked ? 'state-off' : ''}`, text: e.isLocked ? 'Đang bị khóa' : (e.code || 'Đang hoạt động') })),
      btn);
  }));

  $('ql-gates').replaceChildren(...state.gates.map(g => {
    const btn = el('button', { type: 'button', class: 'btn btn-small', text: g.isUnderMaintenance ? 'Mở lại' : 'Bảo trì' });
    btn.addEventListener('click', async () => {
      try {
        await Api.setGateMaintenance(g.id, !g.isUnderMaintenance);
        toast(g.isUnderMaintenance ? `Đã mở lại ${g.location}.` : `Đã chuyển ${g.location} sang bảo trì.`);
        await reloadAll();
      } catch (err) { toast(`Chưa đổi được trạng thái: ${err.message}`); }
    });
    return el('li', {},
      el('span', { class: 'who' }, g.location,
        el('span', { class: `sub ${g.isUnderMaintenance ? 'state-off' : ''}`, text: g.isUnderMaintenance ? 'Đang bảo trì' : 'Đang hoạt động' })),
      btn);
  }));
}

/* ---------- Tải dữ liệu ---------- */

async function reloadAttendance() {
  try { state.attendance = await Api.listAttendance(200); }
  catch (err) { toast(`Không tải được lượt quét: ${err.message}`); }
}

async function reloadAll() {
  try {
    [state.employees, state.gates] = await Promise.all([Api.listEmployees(), Api.listGates()]);
  } catch (err) { toast(`Không tải được dữ liệu: ${err.message}`); }
  await reloadAttendance();
  fillEmployeeSelect();
  fillGateSelects();
  renderEmployeeCard();
  renderEmployeeHistory();
  renderKioskHistory();
  renderAdmin();
}

/* ---------- Khởi động ---------- */

async function init() {
  applyRole();
  const info = await Api.detectMode();
  renderServerStatus(info);
  await reloadAll();
  if (!role || role === 'nhanvien') {   // chỉ thiết bị có Thẻ ra vào mới cần tạo mã
    await refreshQr();
    setInterval(tickQr, 250);
  }

  $('the-employee').addEventListener('change', async (ev) => {
    state.currentEmployeeId = ev.target.value;
    writePref(EMPLOYEE_PREF, state.currentEmployeeId);
    renderEmployeeCard();
    renderEmployeeHistory();
    await refreshQr();
  });

  $('scan-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const input = $('scan-input');
    const content = input.value;
    input.value = '';
    if (content.trim()) handleScan(content);
    input.focus();
  });

  $('use-current-qr').addEventListener('click', () => {
    if (state.currentQrContent) handleScan(state.currentQrContent);
    $('scan-input').focus();
  });

  // Trình duyệt chỉ cho phát tiếng sau một thao tác của người dùng, nên tạo bộ phát âm thanh
  // ở lần chạm/bấm đầu tiên (kể cả khi camera đã tự bật).
  const ensureAudio = () => {
    if (camera.audio) return;
    try { camera.audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* bỏ qua */ }
  };
  document.addEventListener('pointerdown', ensureAudio, { once: true });
  document.addEventListener('keydown', ensureAudio, { once: true });

  $('camera-toggle').addEventListener('click', () => {
    ensureAudio();
    if (camera.stream) stopCamera();
    else startCamera();
  });

  $('camera-device').addEventListener('change', () => {
    writePref(CAMERA_PREF, $('camera-device').value);
    startCamera();
  });

  // Chế độ demo: tab khác trên cùng máy vừa ghi dữ liệu (Kiosk ghi lượt quét, Quản lý khóa nhân viên…)
  // → tải lại để hai tab luôn khớp nhau.
  let syncTimer = null;
  window.addEventListener('storage', (ev) => {
    if (Api.mode !== 'demo' || ev.key !== DemoStore.KEY) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(reloadAll, 150);
  });

  // Chế độ API thật: màn hình Quản lý tự tải lại mỗi 5 giây để thấy lượt quét từ các cổng.
  setInterval(() => {
    if (Api.mode === 'api' && currentView() === 'quanly' && !document.hidden) reloadAll();
  }, 5000);

  $('kiosk-gate').addEventListener('change', renderKioskHistory);
  $('ql-result').addEventListener('change', renderAdmin);
  $('ql-gate').addEventListener('change', renderAdmin);
  $('ql-refresh').addEventListener('click', reloadAll);

  $('demo-reset').addEventListener('click', async () => {
    Api.resetDemo();
    await reloadAll();
    toast('Đã khôi phục dữ liệu demo.');
  });

  window.addEventListener('hashchange', route);
  route();
  maybeAutoStartCamera();
}

init();
