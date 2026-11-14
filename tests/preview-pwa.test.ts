import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const origin = "https://preview.example";
const workerSource = readFileSync(new URL("../public/preview-sw.js", import.meta.url), "utf8");

type RequestFixture = { url: string; method: string; mode: string };
type CacheKey = string | RequestFixture;
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
  let networkResponse = async () =>
    new Response("network", {
      headers: { "content-type": "application/javascript" },
    });
  const keyOf = (key: CacheKey) => new URL(typeof key === "string" ? key : key.url, origin).href;
  const bucket = (name: string) => {
    let rows = storage.get(name);
    if (!rows) {
      rows = new Map();
      storage.set(name, rows);
    }
    return rows;
  };
  runInNewContext(
    workerSource,
    {
      URL,
      Response,
      fetch: async (request: CacheKey, options?: RequestInit) => {
        network.push({ url: keyOf(request), options });
        return networkResponse();
      },
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
        open: async (name: string) => ({
          put: async (key: CacheKey, response: Response) => {
            puts.push(keyOf(key));
            bucket(name).set(keyOf(key), response);
          },
        }),
        match: async (key: CacheKey) => {
          for (const rows of storage.values()) {
            const response = rows.get(keyOf(key));
            if (response) return response.clone();
          }
          return undefined;
        },
      },
    },
    { filename: "preview-sw.js" },
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
    respond(next: () => Promise<Response>) {
      networkResponse = next;
    },
    seed(name: string, key: string, response: Response) {
      bucket(name).set(keyOf(key), response);
    },
    async dispatch(name: string, request?: Partial<RequestFixture>) {
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

test("preview worker does not intercept API, private routes, other origins or writes", async () => {
  const app = worker();
  for (const url of ["/api/user", "/api/messages", "/nalog", "/admin", "/prijava"]) {
    assert.equal(await app.dispatch("fetch", { url, mode: "navigate" }), undefined);
  }
  assert.equal(
    await app.dispatch("fetch", { url: "https://elsewhere.example/assets/app.js" }),
    undefined,
  );
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD"]) {
    assert.equal(await app.dispatch("fetch", { url: "/assets/app.js", method }), undefined);
  }
  assert.equal(app.network.length, 0);
  assert.equal(app.puts.length, 0);
});

test("preview navigation always reads the network instead of cached HTML", async () => {
  const app = worker();
  for (const url of ["/", "/pregled?source=pwa", "/pregled/djelatnost?profil=forma"]) {
    app.seed("unrelated-cache", url, new Response("old cached HTML"));
    app.respond(
      async () => new Response("current HTML", { headers: { "content-type": "text/html" } }),
    );
    const response = await app.dispatch("fetch", { url, mode: "navigate" });
    assert.equal(await response?.text(), "current HTML");
  }
  assert.equal(app.network.length, 3);
  assert.equal(app.puts.length, 0);
});

test("failed preview navigation uses the dedicated offline page, never stale page HTML", async () => {
  const app = worker();
  app.seed("preview-fixture", "/preview-offline.html", new Response("offline notice"));
  app.seed("preview-fixture", "/pregled", new Response("stale private HTML"));
  app.respond(async () => {
    throw new Error("fixture offline");
  });
  const response = await app.dispatch("fetch", { url: "/pregled", mode: "navigate" });
  assert.equal(await response?.text(), "offline notice");
  assert.equal(app.puts.length, 0);
  const empty = worker();
  empty.respond(async () => {
    throw new Error("fixture offline");
  });
  const missing = await empty.dispatch("fetch", { url: "/pregled", mode: "navigate" });
  assert.equal(missing?.type, "error");
});

test("public assets are network first and use their cached bytes only after network failure", async () => {
  const app = worker();
  app.respond(
    async () =>
      new Response("first asset", { headers: { "content-type": "application/javascript" } }),
  );
  assert.equal(
    await (await app.dispatch("fetch", { url: "/assets/app.js" }))?.text(),
    "first asset",
  );
  app.respond(
    async () =>
      new Response("updated asset", { headers: { "content-type": "application/javascript" } }),
  );
  assert.equal(
    await (await app.dispatch("fetch", { url: "/assets/app.js" }))?.text(),
    "updated asset",
  );
  app.respond(async () => {
    throw new Error("fixture offline");
  });
  assert.equal(
    await (await app.dispatch("fetch", { url: "/assets/app.js" }))?.text(),
    "updated asset",
  );
  assert.equal(app.network.length, 3);
  assert.equal(app.puts.length, 2);
});

test("HTML, authentication redirects and unsuccessful asset responses never enter cache", async () => {
  for (const contentType of ["text/html", "Text/HTML; charset=utf-8", "application/xhtml+xml"]) {
    const app = worker();
    app.respond(async () => new Response("sign in", { headers: { "content-type": contentType } }));
    await app.dispatch("fetch", { url: "/assets/app.js" });
    assert.equal(app.puts.length, 0, contentType);
  }
  for (const kind of ["redirect", "error"]) {
    const app = worker();
    app.respond(async () => {
      const response = new Response("not an asset", {
        status: kind === "error" ? 403 : 200,
        headers: { "content-type": "image/webp" },
      });
      if (kind === "redirect") Object.defineProperty(response, "redirected", { value: true });
      return response;
    });
    await app.dispatch("fetch", { url: "/preview/studio.webp" });
    assert.equal(app.puts.length, 0, kind);
  }
});

test("missing and unexpected MIME types cannot populate the public asset cache", async () => {
  for (const contentType of [null, "text/plain", "application/json", "application/xml"]) {
    const app = worker();
    app.respond(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          headers: contentType ? { "content-type": contentType } : undefined,
        }),
    );
    const response = await app.dispatch("fetch", { url: "/assets/app.js" });
    assert.equal(response?.status, 200);
    assert.equal(app.puts.length, 0, contentType ?? "missing Content-Type");
  }
});

test("installation fetches only the offline page and activation cleans only its own old caches", async () => {
  const app = worker();
  app.seed("ahibizz-design-static-old", "/old.js", new Response("old"));
  app.seed("another-app-cache", "/elsewhere", new Response("keep"));
  app.respond(
    async () => new Response("offline HTML", { headers: { "content-type": "text/html" } }),
  );
  await app.dispatch("install");
  assert.equal(app.network.length, 1);
  const request = app.network[0];
  assert.ok(request);
  assert.equal(request.url, `${origin}/preview-offline.html`);
  assert.equal(request.options?.cache, "reload");
  assert.equal(request.options?.redirect, "error");
  assert.equal(app.skipped, 1);
  const current = [...app.storage.keys()].find(
    (name) => name.startsWith("ahibizz-design-static-") && name !== "ahibizz-design-static-old",
  );
  assert.ok(current);
  await app.dispatch("activate");
  assert.deepEqual(app.deleted, ["ahibizz-design-static-old"]);
  assert.ok(app.storage.has(current));
  assert.ok(app.storage.has("another-app-cache"));
  assert.equal(app.claims, 1);
});

test("an unavailable offline page prevents a broken worker from taking over", async () => {
  const app = worker();
  app.respond(async () => new Response("missing", { status: 404 }));
  await assert.rejects(app.dispatch("install"), /Offline page unavailable/);
  assert.equal(app.skipped, 0);
  assert.equal(app.puts.length, 0);
});

test("a blocked .html redirect uses only the clean same-origin offline URL", async () => {
  const app = worker();
  let attempts = 0;
  app.respond(async () => {
    if (++attempts === 1) throw new Error("blocked redirect to https://login.example/session");
    return new Response("clean URL offline notice", { headers: { "content-type": "text/html" } });
  });
  await app.dispatch("install");
  assert.deepEqual(
    app.network.map(({ url }) => url),
    [`${origin}/preview-offline.html`, `${origin}/preview-offline`],
  );
  for (const request of app.network) {
    assert.equal(request.options?.redirect, "error");
    assert.equal(request.options?.cache, "reload");
  }
  assert.deepEqual(app.puts, [`${origin}/preview-offline.html`]);
  assert.equal(app.skipped, 1);
  app.respond(async () => {
    throw new Error("fixture offline");
  });
  const offline = await app.dispatch("fetch", { url: "/pregled", mode: "navigate" });
  assert.equal(await offline?.text(), "clean URL offline notice");
});

test("two rejected offline URLs cannot take over or follow an authentication URL", async () => {
  const app = worker();
  app.respond(async () => {
    throw new Error("blocked redirect to https://login.example/session");
  });
  await assert.rejects(app.dispatch("install"), /blocked redirect/);
  assert.deepEqual(
    app.network.map(({ url }) => url),
    [`${origin}/preview-offline.html`, `${origin}/preview-offline`],
  );
  for (const request of app.network) assert.equal(request.options?.redirect, "error");
  assert.equal(app.puts.length, 0);
  assert.equal(app.storage.size, 0);
  assert.equal(app.skipped, 0);
  assert.equal(app.claims, 0);
});

test("preview manifest names its stable entry and real correctly sized PNG icons", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../public/preview-app.webmanifest", import.meta.url), "utf8"),
  );
  assert.equal(manifest.id, "/pregled");
  assert.equal(manifest.start_url, "/pregled?source=pwa");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  const icons = manifest.icons as { src: string; sizes: string; type: string; purpose: string }[];
  assert.equal(icons.length, 3);
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
    {
      src: "/preview-app/icons/apple-touch-icon.png",
      sizes: "180x180",
      type: "image/png",
      purpose: "apple",
    },
  ]) {
    assert.match(icon.src, /^\/preview-app\/icons\/[a-z0-9-]+\.png$/);
    assert.equal(icon.type, "image/png");
    const bytes = readFileSync(new URL(`../public${icon.src}`, import.meta.url));
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(bytes.toString("ascii", 12, 16), "IHDR");
    assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes);
  }
});
