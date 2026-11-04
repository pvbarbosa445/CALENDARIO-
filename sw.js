// Service Worker: mantém os arquivos do app disponíveis offline.
// Ele NUNCA toca no IndexedDB — atualizar o código não apaga os dados do aparelho.
// Ao publicar uma nova versão no GitHub, aumente VERSION para forçar a atualização do cache.
const VERSION = '1.9.7';
const CACHE = `fincal-${VERSION}`;
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './app.css',
  './app.js', './db.js', './engine.js', './dates.js', './holidays.js', './ops.js', './icons.js', './finance.js', './pages.js',
  './icon-192.png', './icon-512.png', './icon-maskable-512.png',
];

// Instala a versão inteira de uma vez, buscando cada arquivo direto do servidor (cache: 'reload'),
// para nunca misturar arquivos novos com cópias antigas guardadas pelo navegador ou pelo GitHub.
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('fincal-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Cache primeiro (abre instantâneo e offline). Os arquivos de uma versão nunca são trocados um a um:
// a versão nova chega inteira quando o VERSION muda (novo Service Worker).
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(req, { ignoreSearch: true }) ||
      (req.mode === 'navigate' ? await cache.match('./index.html') : undefined);
    return cached || fetch(req);
  }));
});
