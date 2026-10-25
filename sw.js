const VERSION = "__BUILD__";
const CACHE = "apuracao-" + VERSION;
const PRECACHE = [
  "/static.js",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/favicon.svg"
];
const NAV_TIMEOUT_MS = 3000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: "reload" }))))
      .catch(() => {}) // never block install on a missing asset
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function networkFirst(request) {
  return new Promise((resolve) => {
    let settled = false;
    const fallback = () =>
      caches.match(request).then((r) => r || caches.match("/")).then((r) => r || Response.error());
    const timer = setTimeout(() => {
      fallback().then((r) => {
        if (!settled && r.type !== "error") { settled = true; resolve(r); }
      });
    }, NAV_TIMEOUT_MS);
    fetch(request).then((res) => {
      clearTimeout(timer);
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
      }
      if (!settled) { settled = true; resolve(res); }
    }).catch(() => {
      clearTimeout(timer);
      fallback().then((r) => { if (!settled) { settled = true; resolve(r); } });
    });
  });
}

function staleWhileRevalidate(event) {
  const request = event.request;
  return caches.open(CACHE).then((cache) =>
    cache.match(request).then((cached) => {
      const network = fetch(request).then((res) => {
        if (res && res.ok && res.type === "basic") cache.put(request, res.clone());
        return res;
      }).catch(() => cached || Response.error());
      if (cached) { event.waitUntil(network.catch(() => {})); return cached; }
      return network;
    })
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Never touch cross-origin (TSE, votos-api, etc.) — straight to network.
  if (url.origin !== self.location.origin) return;
  // Always network, never cached.
  if (url.pathname === "/version.json" || url.pathname === "/sw.js") return;
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    event.respondWith(networkFirst(req));
    return;
  }
  event.respondWith(staleWhileRevalidate(event));
});

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; }
  catch (e) { d = { body: event.data ? event.data.text() : "" }; }
  const title = d.title || "Apuração 2026";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: d.body || "",
      tag: d.tag || "apuracao",
      renotify: true,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: d.url || "/" },
      vibrate: [100, 50, 100]
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (new URL(c.url).origin === self.location.origin) {
          const p = c.url !== target && "navigate" in c ? c.navigate(target).catch(() => c) : Promise.resolve(c);
          return p.then((cl) => (cl || c).focus());
        }
      }
      return self.clients.openWindow(target);
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") self.skipWaiting();
});
