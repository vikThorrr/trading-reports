/* Service worker: cache the app shell + encrypted data so reports are
   readable offline (e.g. on the subway). Bump CACHE to force an update. */
const CACHE = "tr-v10";
const SHELL = [
  "./",
  "index.html",
  "style.css?v=10",
  "app.js?v=10",
  "manifest.webmanifest",
  "icon.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Web Push: show a notification even when the app is closed.
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Trading Reports", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(
    self.registration.showNotification(d.title || "Trading Reports", {
      body: d.body || "",
      icon: "icon-192.png",
      badge: "icon-192.png",
      tag: d.tag || "trading-reports",
      data: { url: d.url || "./" },
    })
  );
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ("focus" in c) return c.focus(); }
      if (clients.openWindow) return clients.openWindow(e.notification.data?.url || "./");
    })
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Encrypted data: network-first so new reports show up, fall back to cache offline.
  if (url.pathname.endsWith("reports.enc.json")) {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return r;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  // Everything else: cache-first.
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
