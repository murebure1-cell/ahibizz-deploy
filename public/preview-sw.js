// This worker belongs only to the isolated design preview. Never cache accounts or API data.
const CACHE = "ahibizz-design-static-v2";
const OFFLINE = "/preview-offline.html";
self.addEventListener("install", (event) => {
  // The static host canonicalizes .html URLs; try its same-origin clean URL without following any redirect.
  event.waitUntil(fetch(OFFLINE, { cache: "reload", redirect: "error" }).catch(() => fetch("/preview-offline", { cache: "reload", redirect: "error" })).then(async (response) => {
    if (!response.ok) throw new Error("Offline page unavailable");
    await (await caches.open(CACHE)).put(OFFLINE, response);
  }).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("ahibizz-design-static-") && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  // Always ask the server for pages so a new publication and the sign-in gate take effect.
  if (request.mode === "navigate" && (url.pathname === "/" || url.pathname.startsWith("/pregled"))) {
    event.respondWith(fetch(request).catch(async () => (await caches.match(OFFLINE)) || Response.error()));
    return;
  }
  const staticAsset = /^\/(assets\/|_next\/static\/|preview\/|brand\/|preview-app\/icons\/)/.test(url.pathname);
  if (!staticAsset) return;
  event.respondWith(fetch(request).then((response) => {
    // Authentication redirects and HTML must never enter the asset cache.
    const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const cacheableType = /^(image\/|font\/|text\/css$|(?:text|application)\/(?:javascript|ecmascript|x-javascript|octet-stream)$)/.test(type);
    if (response.ok && !response.redirected && cacheableType) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
    }
    return response;
  }).catch(async () => (await caches.match(request)) || Response.error()));
});
