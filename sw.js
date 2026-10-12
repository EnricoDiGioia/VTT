// Service worker da Mesa: permite instalar como app (Android/PC) e abrir a tela inicial sem internet.
// Estratégia "rede primeiro": sempre busca a versão mais nova; o cache só é usado se estiver offline.
// Não mexe em nada de outros domínios (Firebase, gstatic) — a sincronização continua direto.
const CACHE = 'mesa-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
      if (hit) return hit;
      if (req.mode === 'navigate') { const idx = await caches.match('./'); if (idx) return idx; }
      throw err;
    }
  })());
});
