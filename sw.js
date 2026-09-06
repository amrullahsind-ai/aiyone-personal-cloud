const CACHE = "aiyone-v15";
const ASSETS = [
  "/",
  "/index.html",
  "/styles.css?v=aiyone-v15",
  "/lib/aiyone-icons.js?v=aiyone-v15",
  "/lib/aiyone-core.js?v=aiyone-v15",
  "/app.js?v=aiyone-v15",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // addAll gagal total kalau SATU aset meleset. Cache satu per satu supaya
    // ikon yang hilang tidak membuat seluruh install service worker batal.
    await Promise.all(ASSETS.map(url => cache.add(url).catch(err => console.warn("SW lewati", url, err))));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  if (event.data === "skipWaiting") self.skipWaiting();
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try { url = new URL(request.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Network-first: aplikasi ini berubah sering, jadi versi terbaru lebih
  // penting daripada kecepatan cache. Cache hanya jaring pengaman offline.
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response && response.ok && response.type === "basic") {
        const cache = await caches.open(CACHE);
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    } catch (_) {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === "navigate") {
        const shell = await caches.match("/index.html") || await caches.match("/");
        if (shell) return shell;
      }
      return new Response("Offline dan belum ada salinan cache.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }
  })());
});
