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

function route() {
  const view = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'the';
  VIEWS.forEach(v => { $(`view-${v}`).hidden = v !== view; });
  document.querySelectorAll('.tabs a').forEach(a => {
    if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
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
    state.currentEmployeeId = state.employees.length ? state.employees[0].id : null;
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
    state.signTimer = setTimeout(() => setSign('idle', 'Mời quét mã', 'Đưa mã QR trên điện thoại vào máy quét'), 6000);
  }
}

async function handleScan(content) {
  const gateId = $('kiosk-gate').value;
  const gate = gateById(gateId);
  const parsed = parseQrContent(content);
  const now = new Date();

  if (!parsed) {
    setSign('stop', 'Không đọc được mã', '', 'Mã này không phải mã ra vào của TMC. Mở lại ứng dụng và quét mã đang hiển thị.',
      `${gate ? gate.location : ''}, lúc ${fmtTime(now.toISOString(), true)}`);
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
  } catch (err) {
    setSign('stop', 'Chưa kiểm tra được mã', '', 'Không liên lạc được máy chủ. Báo bảo vệ để được hỗ trợ qua cổng.', err.message);
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
  const info = await Api.detectMode();
  renderServerStatus(info);
  await reloadAll();
  await refreshQr();
  setInterval(tickQr, 250);

  $('the-employee').addEventListener('change', async (ev) => {
    state.currentEmployeeId = ev.target.value;
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
}

init();
