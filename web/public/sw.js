const SHELL = 'gac-sach-shell-v1';
const CONTENT = 'gac-sach-content-v1';
const isContent = (path) => /^\/api\/books(?:\/[^/]+(?:\/chapters\/[^/]+|\/cover)?)?$/.test(path);
const trim = async (cache, limit) => { const keys = await cache.keys(); for (const key of keys.slice(0, Math.max(0, keys.length - limit))) await cache.delete(key); };
const warmShell = async () => {
  const cache = await caches.open(SHELL);
  const response = await fetch('/offline');
  if (!response.ok) throw new Error('Offline shell requires login');
  const saved = response.clone();
  const html = await response.text();
  const assets = [...new Set([...html.matchAll(/(?:src|href)="([^"<>]+)"/g)].map((m) => m[1].replaceAll('&amp;', '&')).filter((url) => url.startsWith('/_next/static/')))];
  await cache.addAll(assets);
  await cache.put('/offline', saved);
};
self.addEventListener('install', (event) => event.waitUntil((async () => { await warmShell(); await self.skipWaiting(); })()));
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith('gac-sach-shell-') && name !== SHELL) await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('message', (event) => event.waitUntil((async () => {
  const data = event.data;
  if (data?.type === 'REFRESH_SHELL') { try { await warmShell(); } catch { /* Keep the previous complete shell while offline. */ } return; }
  if (data?.type === 'CLEAR_OFFLINE') { await caches.delete(CONTENT); return; }
  if (data?.type !== 'REMOVE_BOOK' || typeof data.bookId !== 'string') return;
  const cache = await caches.open(CONTENT);
  for (const request of await cache.keys()) {
    if (new URL(request.url).pathname.startsWith(`/api/books/${encodeURIComponent(data.bookId)}`)) await cache.delete(request);
  }
  await cache.delete('/api/books');
})()));
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await caches.open(SHELL)).match('/offline')));
  } else if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const saved = await cache.match(request);
      if (saved) return saved;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })());
  } else if (isContent(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CONTENT);
      try {
        const response = await fetch(request);
        if (response.ok) { await cache.delete(request); await cache.put(request, response.clone()); await trim(cache, 40); }
        // Never bypass an authentication failure or a deleted-book response.
        if (response.status < 500) return response;
        return (await cache.match(request)) || response;
      } catch { return (await cache.match(request)) || Response.json({ message: 'Chương này chưa được lưu offline.' }, { status: 503 }); }
    })());
  }
});
