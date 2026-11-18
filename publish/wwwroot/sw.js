const CACHE_NAME = 'tmc-aacs-static-v1';
const DB_NAME = 'tmc_aacs_offline_db';
const STORE_NAME = 'offline_queue';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/offline-sync.js',
  '/api/employees',
  '/api/gates'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'clientEventId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function enqueueOfflineScan(payload) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({
      ...payload,
      clientEventId: payload.clientEventId || crypto.randomUUID(),
      queuedAtUtc: new Date().toISOString()
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function flushOfflineQueue() {
  const db = await openDb();
  const items = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });

  if (items.length === 0) return 0;

  let synced = 0;
  for (const item of items) {
    try {
      const res = await fetch('/api/access/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item)
      });
      if (res.ok) {
        await new Promise((resolve, reject) => {
          const delTx = db.transaction(STORE_NAME, 'readwrite');
          delTx.objectStore(STORE_NAME).delete(item.clientEventId);
          delTx.oncomplete = () => resolve();
          delTx.onerror = () => reject(delTx.error);
        });
        synced++;
      }
    } catch {
      break; // Still offline
    }
  }
  return synced;
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Intercept POST /api/access/scan: if offline, queue in IndexedDB transparently
  if (event.request.method === 'POST' && url.pathname === '/api/access/scan') {
    event.respondWith((async () => {
      const cloned = event.request.clone();
      try {
        const res = await fetch(event.request);
        return res;
      } catch {
        const body = await cloned.json();
        const clientEventId = body.clientEventId || crypto.randomUUID();
        await enqueueOfflineScan({ ...body, clientEventId });

        return new Response(JSON.stringify({
          isSuccess: true,
          message: 'Mời qua cổng (Đã lưu tạm vào bộ nhớ đệm cục bộ — tự đồng bộ khi có mạng)',
          isOfflineCached: true,
          clientEventId
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    })());
    return;
  }

  // Network-first with cache fallback for GET requests (pages & reference data)
  if (event.request.method === 'GET' && url.origin === self.location.origin) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(event.request))
    );
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-aacs-offline') {
    event.waitUntil(flushOfflineQueue());
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'FLUSH_OFFLINE_QUEUE') {
    event.waitUntil(flushOfflineQueue());
  }
});
