// Service Worker: mantém os arquivos do app disponíveis offline.
// Ele NUNCA toca no IndexedDB — atualizar o código não apaga os dados do aparelho.
// Ao publicar uma nova versão no GitHub, aumente VERSION para forçar a atualização do cache.
const VERSION = '1.4.0';
const CACHE = `fincal-${VERSION}`;
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './app.css',
  './app.js', './db.js', './engine.js', './dates.js', './holidays.js', './ops.js', './icons.js', './finance.js', './pages.js',
  './icon-192.png', './icon-512.png', './icon-maskable-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('fincal-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Cache primeiro (abre instantâneo e offline) + atualização em segundo plano.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(req, { ignoreSearch: true }) ||
      (req.mode === 'navigate' ? await cache.match('./index.html') : undefined);
    const network = fetch(req).then(res => {
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    }).catch(() => cached);
    return cached || network;
  }));
});
