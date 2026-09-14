const BASE = new URL('./', self.location.href).pathname;
const PREFIX = `interpreter-shell-${BASE}-`;
const CACHE = `${PREFIX}v3`;
const SHELL = ['', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'capture-worklet.js'].map(path => BASE + path);
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await cache.addAll(SHELL);
  const html = await (await cache.match(BASE + 'index.html')).text();
  const assets = [...html.matchAll(/(?:src|href)="([^\"]+)"/g)].map(match => new URL(match[1], self.location.href)).filter(url => url.origin === self.location.origin && url.pathname.startsWith(BASE + 'assets/')).map(url => url.pathname);
  await cache.addAll(assets);
})()));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(BASE) || url.pathname.startsWith(BASE + 'api/')) return;
  if (!SHELL.includes(url.pathname) && !url.pathname.startsWith(BASE + 'assets/')) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy))); }
    return response;
  }).catch(async () => (await caches.match(event.request)) || (event.request.mode === 'navigate' ? await caches.match(BASE + 'index.html') : undefined) || new Response('Offline', { status: 503 })));
});
