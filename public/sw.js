// Public assets only. Never store API responses, account pages, messages or user media.
const CACHE = "ahibizz-app-static-v2";
const OFFLINE = "/app-offline.html";
const SHELL = [OFFLINE, "/app-icons/icon-192.png", "/app-icons/icon-512.png", "/app-icons/maskable-512.png", "/app-icons/apple-touch-icon.png"];

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
  if (!/^\/(?:_next\/static\/|brand\/|app-icons\/)/.test(url.pathname)) return;
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

const settings = "/nalog?odjeljak=postavke";
const messages = "/nalog?odjeljak=poruke";
const activityInbox = "/nalog/obavijesti";
const pushId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function reportPush(id, event) {
  if (!pushId.test(id)) return;
  try {
    await fetch("/api/push/receipt", { method:"POST", headers:{"Content-Type":"application/json"},
      credentials:"omit", cache:"no-store", redirect:"error", body:JSON.stringify({id,event}) });
  } catch {}
}
self.addEventListener("push", event => {
  let data;
  try { data = event.data?.json(); } catch {}
  const test = data?.kind === "test" && pushId.test(data?.id);
  const id = pushId.test(data?.id) ? data.id : "";
  const activity = data?.kind === "activity";
  const activityId = !test && pushId.test(data?.activityId) ? data.activityId : "";
  event.waitUntil((async () => {
    await self.registration.showNotification("AhiBizz", {
      body:test ? "Probna obavijest je stigla. Dodirni za povratak u postavke." :
        activity ? "Imaš novu obavijest." : "Imaš novu poruku.",
      icon:"/app-icons/icon-192.png", tag:id ? "ahibizz-"+id : "ahibizz-message",
      data:{kind:test?"test":activity?"activity":"message",id,activityId}
    });
    if(test) await reportPush(id,"shown");
  })());
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const data=event.notification.data, test=data?.kind==="test" && pushId.test(data?.id);
  const activityPath=pushId.test(data?.activityId)
    ? activityInbox+"?stavka="+data.activityId
    : data?.kind==="activity" ? activityInbox : messages;
  const url=new URL(test ? settings : activityPath,self.location.origin).href;
  const open=(async () => {
    const windows=await self.clients.matchAll({type:"window"});
    const current=windows.find(client=>client.url===url);
    if(current) return current.focus();
    return self.clients.openWindow(url);
  })();
  event.waitUntil(Promise.all([open,test ? reportPush(data.id,"opened") : Promise.resolve()]));
});
