import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const origin = "https://app.example";
const currentCache = "ahibizz-app-static-v2";
const offlinePath = "/app-offline.html";
const workerSource = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

type RequestFixture = {
  url: string;
  method: string;
  mode: string;
  headers: Headers;
};
type CacheKey = string | { url: string };
type WorkerEvent = {
  request?: RequestFixture;
  respondWith(response: Promise<Response>): void;
  waitUntil(work: Promise<unknown>): void;
};

function worker() {
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const storage = new Map<string, Map<string, Response>>();
  const network: { url: string; options?: RequestInit }[] = [];
  const puts: string[] = [];
  const deleted: string[] = [];
  let claims = 0;
  let skipped = 0;
  let networkResponse = async (_request: CacheKey) =>
    new Response("network", { headers: { "content-type": "application/javascript" } });
  const keyOf = (key: CacheKey) => new URL(typeof key === "string" ? key : key.url, origin).href;
  const bucket = (name: string) => {
    let rows = storage.get(name);
    if (!rows) {
      rows = new Map();
      storage.set(name, rows);
    }
    return rows;
  };
  const fetchFixture = async (request: CacheKey, options?: RequestInit) => {
    network.push({ url: keyOf(request), options });
    return networkResponse(request);
  };
  const cache = (name: string) => ({
    put: async (key: CacheKey, response: Response) => {
      puts.push(keyOf(key));
      bucket(name).set(keyOf(key), response);
    },
    match: async (key: CacheKey) => bucket(name).get(keyOf(key))?.clone(),
    addAll: async (keys: CacheKey[]) => {
      const responses = await Promise.all(keys.map((key) => fetchFixture(key)));
      if (responses.some((response) => !response.ok)) throw new Error("Precache failed");
      for (let index = 0; index < keys.length; index++) {
        const key = keys[index];
        const response = responses[index];
        assert.ok(key && response);
        await cache(name).put(key, response);
      }
    },
  });
  runInNewContext(
    workerSource,
    {
      URL,
      Headers,
      Request,
      Response,
      fetch: fetchFixture,
      self: {
        location: { origin },
        addEventListener: (name: string, listener: (event: WorkerEvent) => void) => {
          listeners.set(name, listener);
        },
        skipWaiting: async () => {
          skipped++;
        },
        clients: {
          claim: async () => {
            claims++;
          },
        },
      },
      caches: {
        keys: async () => [...storage.keys()],
        delete: async (name: string) => {
          deleted.push(name);
          return storage.delete(name);
        },
        open: async (name: string) => cache(name),
        match: async (key: CacheKey) => {
          for (const rows of storage.values()) {
            const response = rows.get(keyOf(key));
            if (response) return response.clone();
          }
          return undefined;
        },
      },
    },
    { filename: "sw.js" },
  );
  return {
    network,
    puts,
    storage,
    deleted,
    get claims() {
      return claims;
    },
    get skipped() {
      return skipped;
    },
    respond(next: (request: CacheKey) => Promise<Response>) {
      networkResponse = next;
    },
    seed(name: string, key: string, response: Response) {
      bucket(name).set(keyOf(key), response);
    },
    async dispatch(
      name: string,
      request?: Partial<Omit<RequestFixture, "headers">> & {
        headers?: HeadersInit;
      },
    ) {
      const listener = listeners.get(name);
      assert.ok(listener, `Missing ${name} listener`);
      const pending: Promise<unknown>[] = [];
      let response: Promise<Response> | undefined;
      listener({
        request: request
          ? {
              url: new URL(request.url || "/", origin).href,
              method: request.method || "GET",
              mode: request.mode || "cors",
              headers: new Headers(request.headers),
            }
          : undefined,
        respondWith(value) {
          response = value;
        },
        waitUntil(value) {
          pending.push(value);
        },
      });
      const result = response ? await response : undefined;
      for (let index = 0; index < pending.length; index++) await pending[index];
      return result;
    },
  };
}

test("main worker leaves API, user media, foreign requests and writes to the browser", async () => {
  const app = worker();
  for (const url of [
    "/api/account",
    "/api/auth/get-session",
    "/api/messaging/inbox",
    "/api/booking/appointments",
    "/api/people/mine/photo",
    "/api/business-media/mine/logo",
    "/uploads/private-photo.png",
    "/people/private-cover.webp",
    "https://foreign.example/brand/logo.svg",
  ]) {
    assert.equal(await app.dispatch("fetch", { url }), undefined, url);
    if (url.startsWith("/api/"))
      assert.equal(await app.dispatch("fetch", { url, mode: "navigate" }), undefined, url);
  }
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD"]) {
    assert.equal(await app.dispatch("fetch", { url: "/brand/logo.svg", method }), undefined);
    assert.equal(
      await app.dispatch("fetch", { url: "/nalog", method, mode: "navigate" }),
      undefined,
    );
  }
  assert.equal(app.network.length, 0);
  assert.equal(app.puts.length, 0);
});

test("RSC and Next router state requests cannot receive an HTML offline response", async () => {
  const app = worker();
  app.seed(currentCache, offlinePath, new Response("generic offline page"));
  app.respond(async () => {
    throw new Error("offline");
  });
  const headerVariants: HeadersInit[] = [
    { RSC: "1" },
    { "Next-Router-State-Tree": '["",{}]' },
    { "Next-Router-Prefetch": "1" },
  ];
  for (const headers of headerVariants) {
    assert.equal(await app.dispatch("fetch", { url: "/nalog", headers }), undefined);
  }
  assert.equal(await app.dispatch("fetch", { url: "/nalog?_rsc=fixture" }), undefined);
  assert.equal(app.network.length, 0);
  assert.equal(app.puts.length, 0);
});

test("cookie-bearing public and private navigations always read fresh server HTML", async () => {
  const app = worker();
  for (const url of ["/", "/nalog", "/administracija", "/prijava", "/pregled"]) {
    app.seed(currentCache, url, new Response("stale account HTML"));
    app.respond(
      async () =>
        new Response("fresh server HTML", {
          headers: {
            "content-type": "text/html",
            "cache-control": "private, no-store",
            "set-cookie": "fixture-session=updated; HttpOnly; Secure",
          },
        }),
    );
    const response = await app.dispatch("fetch", {
      url,
      mode: "navigate",
      headers: { Cookie: "fixture-session=approved-member" },
    });
    assert.equal(await response?.text(), "fresh server HTML", url);
    assert.equal(response?.headers.get("set-cookie"), "fixture-session=updated; HttpOnly; Secure");
  }
  assert.equal(app.network.length, 5);
  assert.equal(app.puts.length, 0);
});

test("failed main and private navigation returns only the neutral offline document", async () => {
  const app = worker();
  app.seed(currentCache, offlinePath, new Response("generic offline page"));
  app.seed(currentCache, "/nalog", new Response("previous member private HTML"));
  app.respond(async () => {
    throw new Error("fixture offline");
  });
  for (const url of ["/", "/nalog", "/administracija", "/pregled", "/pretraga?q=fixture"]) {
    const response = await app.dispatch("fetch", { url, mode: "navigate" });
    assert.equal(await response?.text(), "generic offline page", url);
  }
  assert.equal(app.puts.length, 0);
  const empty = worker();
  empty.respond(async () => {
    throw new Error("fixture offline");
  });
  assert.equal((await empty.dispatch("fetch", { url: "/nalog", mode: "navigate" }))?.type, "error");
});

test("HTTP auth and server errors are preserved rather than replaced with cached content", async () => {
  for (const status of [401, 403, 404, 503]) {
    const app = worker();
    app.seed(currentCache, offlinePath, new Response("generic offline page"));
    app.respond(async () => new Response("current server error", { status }));
    const response = await app.dispatch("fetch", { url: "/nalog", mode: "navigate" });
    assert.equal(response?.status, status);
    assert.equal(await response?.text(), "current server error");
    assert.equal(app.puts.length, 0);
  }
});

test("only allowlisted public assets are updated online and reused after a network failure", async () => {
  for (const [url, type] of [
    ["/_next/static/chunks/app.js", "application/javascript"],
    ["/brand/ahi-logo-color.svg", "image/svg+xml"],
    ["/app-icons/icon-192.png", "image/png"],
  ]) {
    assert.ok(url && type);
    const app = worker();
    for (const body of ["first asset", "updated asset"]) {
      app.respond(async () => new Response(body, { headers: { "content-type": type } }));
      assert.equal(await (await app.dispatch("fetch", { url }))?.text(), body);
    }
    app.respond(async () => {
      throw new Error("fixture offline");
    });
    assert.equal(await (await app.dispatch("fetch", { url }))?.text(), "updated asset");
    assert.equal(app.network.length, 3);
    assert.equal(app.puts.length, 2);
  }
});

test("HTML, JSON, missing MIME and unsuccessful or redirected assets never enter cache", async () => {
  for (const type of [
    "text/html",
    "Text/HTML; charset=utf-8",
    "application/xhtml+xml",
    "application/json",
    "text/plain",
    null,
  ]) {
    const app = worker();
    app.respond(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          headers: type ? { "content-type": type } : undefined,
        }),
    );
    await app.dispatch("fetch", { url: "/_next/static/chunks/app.js" });
    assert.equal(app.puts.length, 0, type ?? "missing MIME");
  }
  for (const kind of ["redirect", "unauthorized", "server-error"]) {
    const app = worker();
    app.respond(async () => {
      const response = new Response("not an asset", {
        status: kind === "unauthorized" ? 403 : kind === "server-error" ? 503 : 200,
        headers: { "content-type": "image/webp" },
      });
      if (kind === "redirect") Object.defineProperty(response, "redirected", { value: true });
      return response;
    });
    await app.dispatch("fetch", { url: "/brand/photo.webp" });
    assert.equal(app.puts.length, 0, kind);
  }
});

test("private and no-store directives prohibit caching even an otherwise allowed image", async () => {
  for (const cacheControl of [
    "private",
    "no-store",
    "public, max-age=60, no-store",
    "PRIVATE, max-age=0",
    "max-age=0, No-Store",
  ]) {
    const app = worker();
    app.respond(
      async () =>
        new Response("private fixture pixels", {
          headers: { "content-type": "image/png", "cache-control": cacheControl },
        }),
    );
    const response = await app.dispatch("fetch", { url: "/brand/private-fixture.png" });
    assert.equal(await response?.text(), "private fixture pixels");
    assert.equal(app.puts.length, 0, cacheControl);
  }
});

test("unknown assets never fall back to an HTML page", async () => {
  const app = worker();
  app.seed(currentCache, offlinePath, new Response("generic offline page"));
  app.respond(async () => {
    throw new Error("fixture offline");
  });
  const response = await app.dispatch("fetch", { url: "/_next/static/chunks/missing.js" });
  assert.equal(response?.type, "error");
  assert.equal(app.puts.length, 0);
});

test("installation precaches only the neutral offline document and public application icons", async () => {
  const app = worker();
  app.respond(
    async (request) =>
      new Response("static fixture", {
        headers: {
          "content-type": new URL(
            typeof request === "string" ? request : request.url,
            origin,
          ).pathname.endsWith(".png")
            ? "image/png"
            : "text/html",
        },
      }),
  );
  await app.dispatch("install");
  assert.deepEqual(
    app.puts.map((url) => new URL(url).pathname).sort(),
    [
      offlinePath,
      "/app-icons/icon-192.png",
      "/app-icons/icon-512.png",
      "/app-icons/maskable-512.png",
      "/app-icons/apple-touch-icon.png",
    ].sort(),
  );
  assert.equal(app.network.length, 5);
  for (const request of app.network) {
    assert.equal(request.options?.cache, "reload");
    assert.equal(request.options?.redirect, "error");
  }
  assert.ok(app.storage.has(currentCache));
  assert.equal(app.skipped, 1);
});

test("an unavailable or redirected precache cannot activate a broken replacement worker", async () => {
  for (const kind of ["missing", "redirected", "network-error"]) {
    const app = worker();
    app.respond(async () => {
      if (kind === "network-error") throw new Error("blocked redirect to external login");
      const response = new Response("unavailable", { status: kind === "missing" ? 404 : 200 });
      if (kind === "redirected") Object.defineProperty(response, "redirected", { value: true });
      return response;
    });
    await assert.rejects(app.dispatch("install"));
    assert.equal(app.puts.length, 0, kind);
    assert.equal(app.skipped, 0, kind);
    assert.equal(app.claims, 0, kind);
    assert.equal(app.network[0]?.options?.redirect, "error");
  }
});

test("installation refuses an HTML icon or a private offline document", async () => {
  for (const kind of ["html-icon", "private-offline"]) {
    const app = worker();
    app.respond(async (request) => {
      const path = new URL(typeof request === "string" ? request : request.url, origin).pathname;
      const isOffline = path === offlinePath;
      const headers = new Headers({
        "content-type": isOffline || kind === "html-icon" ? "text/html" : "image/png",
      });
      if (kind === "private-offline" && isOffline)
        headers.set("cache-control", "private, no-store");
      return new Response("unsafe precache fixture", { headers });
    });
    await assert.rejects(app.dispatch("install"));
    assert.deepEqual(app.puts, kind === "html-icon" ? [`${origin}${offlinePath}`] : []);
    assert.equal(app.skipped, 0, kind);
    assert.equal(app.claims, 0, kind);
  }
});

test("activation cleans only current app and legacy preview cache families", async () => {
  const app = worker();
  for (const name of [
    currentCache,
    "ahibizz-app-static-old",
    "ahibizz-design-static-v2",
    "unrelated-private-app",
    "ahibizz-other-static-v1",
  ]) {
    app.seed(name, "/fixture", new Response(name));
  }
  await app.dispatch("activate");
  assert.deepEqual(app.deleted.sort(), ["ahibizz-app-static-old", "ahibizz-design-static-v2"]);
  assert.ok(app.storage.has(currentCache));
  assert.ok(app.storage.has("unrelated-private-app"));
  assert.ok(app.storage.has("ahibizz-other-static-v1"));
  assert.equal(app.claims, 1);
});

test("main manifest installs the real root application with stable identity and usable PNGs", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../public/app.webmanifest", import.meta.url), "utf8"),
  );
  assert.equal(manifest.id, "/");
  assert.equal(manifest.name, "AhiBizz");
  assert.equal(manifest.short_name, "AhiBizz");
  assert.equal(manifest.start_url, "/?source=pwa");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.lang, "bs");
  const icons = manifest.icons as { src: string; sizes: string; type: string; purpose: string }[];
  assert.deepEqual(
    icons.map(({ sizes, purpose }) => [sizes, purpose]),
    [
      ["192x192", "any"],
      ["512x512", "any"],
      ["512x512", "maskable"],
    ],
  );
  for (const icon of [
    ...icons,
    { src: "/app-icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
  ]) {
    assert.match(icon.src, /^\/app-icons\/[a-z0-9-]+\.png$/);
    assert.equal(icon.type, "image/png");
    const bytes = readFileSync(new URL(`../public${icon.src}`, import.meta.url));
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(bytes.toString("ascii", 12, 16), "IHDR");
    assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes);
  }
});
