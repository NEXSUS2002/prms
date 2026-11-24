// PRMS service worker. It makes the app installable and keeps static files (scripts, styles, fonts, icons)
// available offline. Pages and data are always fetched from the network: a health record must never be
// served stale from a cache, and nothing a signed-in user sees is stored on the device by this worker.
const CACHE = "prms-static-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  const isStatic = url.pathname.startsWith("/assets/") || /\.(png|webmanifest|woff2?)$/.test(url.pathname);
  if (isStatic) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(
        () =>
          new Response(
            "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>PRMS is offline</title><body style='font-family:system-ui;padding:32px;background:#F4F6F3;color:#10231F'><h1>You are offline</h1><p>PRMS needs a connection to show a health record. Reconnect and reload.</p>",
            { headers: { "content-type": "text/html; charset=utf-8" } },
          ),
      ),
    );
  }
});
