// Đăng ký Service Worker & tự động đồng bộ hàng đợi offline khi trình duyệt có mạng trở lại
(function () {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      if (navigator.onLine && reg.active) {
        reg.active.postMessage({ type: 'FLUSH_OFFLINE_QUEUE' });
      }
    }).catch(() => {});
  });

  window.addEventListener('online', () => {
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'FLUSH_OFFLINE_QUEUE' });
    }
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      navigator.serviceWorker.ready
        .then((reg) => reg.sync.register('sync-aacs-offline'))
        .catch(() => {});
    }
  });
})();
