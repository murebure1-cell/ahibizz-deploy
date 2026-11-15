// Public assets only. Never store API responses, account pages, messages or user media.
const CACHE = "ahibizz-app-static-v1";
const OFFLINE = "/app-offline.html";
const SHELL = [OFFLINE, "/preview-app/icons/icon-192.png", "/preview-app/icons/icon-512.png", "/preview-app/icons/maskable-512.png", "/preview-app/icons/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const path of SHELL) {
      const response = await fetch(path, { cache: "reload", redirect: "error" });
      const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      const privacy = response.headers.get("cache-control") || "";
      if (!response.ok || response.redirected ||
        type !== (path === OFFLINE ? "text/html" : "image/png") ||
        /\b(?:private|no-store)\b/i.test(privacy)) throw new Error("PWA asset unavailable");
      await cache.put(path, response);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE &&
      (key.startsWith("ahibizz-app-static-") || key.startsWith("ahibizz-design-static-")))
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") || url.pathname === "/api" ||
    request.headers.get("RSC") || request.headers.get("Next-Router-State-Tree") ||
    request.headers.get("Next-Router-Prefetch") || url.searchParams.has("_rsc")) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () =>
      (await caches.match(OFFLINE)) || Response.error()));
    return;
  }
  if (!/^\/(?:_next\/static\/|brand\/|preview-app\/icons\/)/.test(url.pathname)) return;
  event.respondWith(fetch(request).then((response) => {
    const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const cacheable = /^(image\/|font\/|text\/css$|(?:text|application)\/(?:javascript|ecmascript|x-javascript|octet-stream)$)/.test(type);
    const privacy = response.headers.get("cache-control") || "";
    if (response.ok && !response.redirected && cacheable && !/\b(?:private|no-store)\b/i.test(privacy)) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
    }
    return response;
  }).catch(async () => (await caches.match(request)) || Response.error()));
});
