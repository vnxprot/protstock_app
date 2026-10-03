const CACHE = 'prot-stock-shell-v4-1-3'
const APP_SHELL = ['/', '/manifest.webmanifest', '/prot-quant-p.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key.startsWith('prot-stock-shell-') && key !== CACHE).map((key) => caches.delete(key))),
    ).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return
  // Never substitute HTML for a failed API request, or cache personal data.
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(async () => (await caches.match('/')) || Response.error()))
  } else if (APP_SHELL.includes(url.pathname) && url.pathname !== '/') {
    event.respondWith(fetch(event.request).catch(async () => (await caches.match(url.pathname)) || Response.error()))
  }
})
