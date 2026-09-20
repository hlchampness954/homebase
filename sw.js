// HomeBase v2 service worker — cache the app shell, never cache data.
const VERSION = 'hb-v2-p1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './shared/dates.js', './shared/recurrence.js', './shared/planner.js', './icons/icon-192.png', './icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const isShell = url.origin === location.origin && (SHELL.some(p => url.pathname.endsWith(p.replace('./', '/'))) || url.pathname.endsWith('/'));
  if (isShell) {
    // network first, fall back to cache (so updates land, but offline still opens)
    e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
    return;
  }
  if (url.hostname.includes('fonts.g') || url.hostname.includes('jsdelivr')) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r; })));
  }
});