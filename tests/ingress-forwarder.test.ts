import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { createServer, type RequestListener, request, type Server } from "node:http";
import { createRequire } from "node:module";
import { createConnection } from "node:net";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { pathToFileURL } from "node:url";
import { enforcementEnv, trustedEnforcementEnv } from "./ingress-enforcement-fixtures";

const policyLib = await import(new URL("../scripts/ingress-policy.mjs", import.meta.url).href);
const forwarder = await import(new URL("../scripts/ingress-forwarder.mjs", import.meta.url).href);
type Fixture = {
  publicPort: number;
  upstream: Server;
  gateway: { server: Server; close(graceMs?: number): Promise<void> };
  policy: object;
};
async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
}
async function close(server: Server) {
  if (!server.listening) return;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
async function fixture(
  t: TestContext,
  handler: RequestListener,
  options: { trustClientIp?: boolean; maxBodyBytes?: number; upstreamTimeoutMs?: number } = {},
) {
  const upstream = createServer(handler);
  const internalPort = await listen(upstream);
  const { trustClientIp = false, ...transport } = options;
  const policy = policyLib.readIngressEnforcementPolicy(
    trustClientIp ? trustedEnforcementEnv(internalPort) : enforcementEnv(internalPort),
  );
  const gateway = forwarder.createIngressForwarder({ policy, ...transport });
  assert.equal(
    gateway.server.listening,
    false,
    "The candidate never opens a listener by import or construction.",
  );
  const publicPort = await listen(gateway.server);
  t.after(async () => {
    if (gateway.server.listening) await gateway.close(100);
    await close(upstream);
  });
  return { publicPort, upstream, gateway, policy } as Fixture;
}
function send(
  port: number,
  options: {
    path?: string;
    method?: string;
    localAddress?: string;
    headers?: string[];
    body?: Buffer | string;
    chunks?: string[];
    onFirstChunk?: () => void;
  } = {},
) {
  return new Promise<{
    status: number;
    body: Buffer;
    cookies: string[] | undefined;
    location: string | undefined;
  }>((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        localAddress: options.localAddress ?? "127.0.0.1",
        agent: false,
        path: options.path ?? "/",
        method: options.method ?? "GET",
        headers: options.headers ?? ["Host", "fixture.example.invalid", "X-Real-IP", "203.0.113.9"],
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.once("data", () => options.onFirstChunk?.());
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("error", reject);
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks),
            cookies: res.headers["set-cookie"],
            location: res.headers.location,
          }),
        );
      },
    );
    req.on("error", reject);
    if (options.chunks) for (const chunk of options.chunks) req.write(chunk);
    req.end(options.body);
  });
}

test("real socket peers gate every normal route and spoofed caller forwarding headers cannot cross", async (t) => {
  let hits = 0;
  const app = await fixture(
    t,
    (req, res) => {
      hits++;
      assert.equal(req.headers["x-ahibizz-ingress-client-ip"], "203.0.113.9");
      assert.equal(req.headers["x-ahibizz-ingress-other"], undefined);
      assert.equal(req.headers["x-forwarded-for"], undefined);
      assert.equal(req.headers["x-real-ip"], undefined);
      assert.equal(req.headers["x-forwarded-proto"], "https");
      assert.equal(req.headers["x-ahibizz-account-id"], "fixture-actor");
      res.end("allowed");
    },
    { trustClientIp: true },
  );
  const headers = [
    "Host",
    "fixture.example.invalid",
    "X-Real-IP",
    "203.0.113.9",
    "X-Forwarded-For",
    "198.51.100.5",
    "X-AhiBizz-Ingress-Client-IP",
    "198.51.100.6",
    "X-AhiBizz-Ingress-Other",
    "forged",
    "Connection",
    "keep-alive, x-ahibizz-ingress-client-ip",
    "X-AhiBizz-Account-ID",
    "fixture-actor",
  ];
  assert.equal((await send(app.publicPort, { headers })).status, 200);
  assert.equal((await send(app.publicPort, { headers, localAddress: "127.0.0.2" })).status, 403);
  assert.equal(hits, 1);
});

test("guard-only mode strips every private or forwarded client-IP header and preserves actor/session data", async (t) => {
  let hits = 0;
  const app = await fixture(t, (req, res) => {
    hits++;
    assert.equal(req.headers["x-ahibizz-ingress-client-ip"], undefined);
    assert.equal(req.headers["x-ahibizz-ingress-other"], undefined);
    assert.equal(req.headers["x-forwarded-for"], undefined);
    assert.equal(req.headers["x-real-ip"], undefined);
    assert.equal(req.headers["x-ahibizz-account-id"], "fixture-actor");
    assert.equal(req.headers.cookie, "fixture=private-session");
    assert.equal(req.headers.authorization, "Bearer fixture-only");
    res.end("guard-only");
  });
  const headers = [
    "Host",
    "fixture.example.invalid",
    "X-Real-IP",
    "203.0.113.9",
    "X-Forwarded-For",
    "198.51.100.5",
    "X-AhiBizz-Ingress-Client-IP",
    "198.51.100.6",
    "X-AhiBizz-Ingress-Other",
    "forged",
    "X-AhiBizz-Account-ID",
    "fixture-actor",
    "Cookie",
    "fixture=private-session",
    "Authorization",
    "Bearer fixture-only",
  ];
  assert.equal((await send(app.publicPort, { headers })).status, 200);
  assert.equal((await send(app.publicPort, { headers, localAddress: "127.0.0.2" })).status, 403);
  assert.equal(hits, 1);
});

test("duplicate or missing real-IP, malformed Host and absolute URLs never reach the fixed loopback upstream", async (t) => {
  let hits = 0;
  const app = await fixture(t, (_req, res) => {
    hits++;
    res.end("unexpected");
  });
  for (const headers of [
    ["Host", "fixture.example.invalid"],
    ["Host", "other.example.invalid/path", "X-Real-IP", "203.0.113.9"],
    ["Host", "fixture.example.invalid", "X-Real-IP", "203.0.113.9", "x-real-ip", "198.51.100.5"],
  ])
    assert.equal((await send(app.publicPort, { headers })).status, 400);
  assert.equal(
    (await send(app.publicPort, { path: "http://other.example.invalid/private" })).status,
    400,
  );
  assert.equal(hits, 0);
});

test("valid rewritten Host is discarded without altering canonical redirects, cookies or original origin headers", async (t) => {
  let hits = 0;
  const app = await fixture(t, (req, res) => {
    hits++;
    assert.equal(req.headers.host, "fixture.example.invalid");
    assert.equal(req.headers["x-forwarded-host"], "fixture.example.invalid");
    assert.equal(req.headers["x-forwarded-proto"], "https");
    assert.equal(req.headers["x-forwarded-port"], "443");
    assert.equal(req.headers.origin, "https://untrusted.invalid");
    assert.equal(req.headers.referer, "https://untrusted.invalid/source");
    assert.equal(req.headers["x-ahibizz-ingress-client-ip"], undefined);
    assert.equal(req.headers.cookie, "fixture=session");
    res.writeHead(307, {
      Location: "https://fixture.example.invalid/nalog",
      "Set-Cookie": [
        "fixture-a=1; HttpOnly; Secure; SameSite=Lax",
        "fixture-b=2; HttpOnly; Secure",
      ],
    });
    res.end();
  });
  for (const host of [
    "127.0.0.1:43127",
    "container_name:43127",
    "[::1]:43127",
    "UNKNOWN.INVALID:443",
  ]) {
    const result = await send(app.publicPort, {
      headers: [
        "Host",
        host,
        "X-Real-IP",
        "203.0.113.9",
        "X-Forwarded-Host",
        "attacker.invalid",
        "X-Forwarded-Proto",
        "http",
        "Origin",
        "https://untrusted.invalid",
        "Referer",
        "https://untrusted.invalid/source",
        "Cookie",
        "fixture=session",
        "X-AhiBizz-Ingress-Client-IP",
        "198.51.100.4",
      ],
    });
    assert.equal(result.status, 307);
    assert.equal(result.location, "https://fixture.example.invalid/nalog");
    assert.deepEqual(result.cookies, [
      "fixture-a=1; HttpOnly; Secure; SameSite=Lax",
      "fixture-b=2; HttpOnly; Secure",
    ]);
  }
  assert.equal(hits, 4);
});

test("the www alias of the configured origin is sent to that origin and never reaches the upstream", async (t) => {
  let hits = 0;
  const app = await fixture(t, (_req, res) => {
    hits++;
    res.end("upstream");
  });
  for (const host of [
    "www.fixture.example.invalid",
    "WWW.Fixture.Example.Invalid",
    "www.fixture.example.invalid:443",
  ]) {
    const result = await send(app.publicPort, {
      path: "/prijava?nastavi=%2Fnalog",
      headers: ["Host", host, "X-Real-IP", "203.0.113.9"],
    });
    assert.equal(result.status, 308, host);
    assert.equal(result.location, "https://fixture.example.invalid/prijava?nastavi=%2Fnalog");
    assert.equal(result.body.length, 0);
  }
  const posted = await send(app.publicPort, {
    method: "POST",
    path: "/api/auth/sign-in/email",
    headers: ["Host", "www.fixture.example.invalid", "X-Real-IP", "203.0.113.9"],
    body: "{}",
  });
  assert.equal(posted.status, 308);
  assert.equal(posted.location, "https://fixture.example.invalid/api/auth/sign-in/email");
  assert.equal(hits, 0);
  // Other names are not aliases: they are served as the configured origin, as before.
  for (const host of [
    "www2.fixture.example.invalid",
    "www.fixture.example.invalid.evil.invalid",
    "www.fixture.example.invalid:8443",
    "fixture.example.invalid",
  ]) {
    const result = await send(app.publicPort, {
      headers: ["Host", host, "X-Real-IP", "203.0.113.9"],
    });
    assert.equal(result.status, 200, host);
    assert.equal(result.location, undefined);
  }
  assert.equal(hits, 4);
  // A caller that is not the gateway is refused before any redirect is considered.
  const outsider = await send(app.publicPort, {
    localAddress: "127.0.0.2",
    headers: ["Host", "www.fixture.example.invalid", "X-Real-IP", "203.0.113.9"],
  });
  assert.equal(outsider.status, 403);
});

test("binary bodies, streaming responses, duplicate Set-Cookie and redirects remain byte-preserving", async (t) => {
  const body = Buffer.from([0, 255, 1, 128, 13, 10]);
  const responseBody = Buffer.alloc(512 * 1024, 173);
  const app = await fixture(t, async (req, res) => {
    const received: Buffer[] = [];
    for await (const chunk of req) received.push(chunk);
    assert.deepEqual(Buffer.concat(received), body);
    assert.equal(req.headers.cookie, "fixture-cookie=unchanged");
    assert.equal(req.headers.authorization, "Bearer fixture-token");
    res.statusCode = 307;
    res.setHeader("Location", "/prijava?nastavi=%2Fnalog");
    res.setHeader("Set-Cookie", ["fixture-a=1; HttpOnly", "fixture-b=2; Secure"]);
    for (let offset = 0; offset < responseBody.length; offset += 8192)
      if (!res.write(responseBody.subarray(offset, offset + 8192)))
        await new Promise<void>((resolve) => res.once("drain", resolve));
    res.end();
  });
  const result = await send(app.publicPort, {
    method: "POST",
    body,
    headers: [
      "Host",
      "fixture.example.invalid",
      "X-Real-IP",
      "203.0.113.9",
      "Content-Length",
      String(body.length),
      "Cookie",
      "fixture-cookie=unchanged",
      "Authorization",
      "Bearer fixture-token",
    ],
  });
  assert.equal(result.status, 307);
  assert.equal(result.location, "/prijava?nastavi=%2Fnalog");
  assert.deepEqual(result.cookies, ["fixture-a=1; HttpOnly", "fixture-b=2; Secure"]);
  assert.deepEqual(result.body, responseBody);
});

test("request body limits reject declared and streamed overflow without passing oversized bodies", async (t) => {
  let hits = 0;
  const app = await fixture(
    t,
    async (req, res) => {
      hits++;
      for await (const _chunk of req) {
      }
      res.end("accepted");
    },
    { maxBodyBytes: 8 },
  );
  const declared = await send(app.publicPort, {
    method: "POST",
    body: "123456789",
    headers: ["Host", "fixture.example.invalid", "X-Real-IP", "203.0.113.9", "Content-Length", "9"],
  });
  assert.equal(declared.status, 413);
  assert.equal(hits, 0);
  assert.equal(
    (await send(app.publicPort, { method: "POST", chunks: ["12345", "67890"] })).status,
    413,
  );
});

test("a silent upstream times out with a bounded generic response", async (t) => {
  const app = await fixture(t, () => {}, { upstreamTimeoutMs: 40 });
  const result = await send(app.publicPort);
  assert.equal(result.status, 504);
  assert.equal(result.body.toString(), "Gateway request unavailable.");
});

test("only bare loopback health GETs work without a supplied client IP", async (t) => {
  let hits = 0;
  const app = await fixture(t, (req, res) => {
    hits++;
    assert.equal(req.headers["x-ahibizz-ingress-client-ip"], undefined);
    res.end("healthy");
  });
  for (const path of ["/api/health/live", "/api/health/ready"])
    assert.equal(
      (
        await send(app.publicPort, {
          path,
          headers: ["Host", "localhost"],
          localAddress: "127.0.0.2",
        })
      ).status,
      200,
    );
  assert.equal(
    (
      await send(app.publicPort, {
        path: "/api/health/live?other=1",
        headers: ["Host", "localhost"],
        localAddress: "127.0.0.2",
      })
    ).status,
    403,
  );
  assert.equal(hits, 2);
});

test("WebSocket upgrade and CONNECT are explicitly denied rather than becoming an unguarded tunnel", async (t) => {
  let hits = 0;
  const app = await fixture(t, (_req, res) => {
    hits++;
    res.end("unexpected");
  });
  async function raw(value: string, localAddress: string) {
    return new Promise<string>((resolve, reject) => {
      const socket = createConnection({ host: "127.0.0.1", port: app.publicPort, localAddress });
      let data = "";
      socket.on("connect", () => socket.write(value));
      socket.on("data", (chunk) => (data += chunk));
      socket.on("error", reject);
      socket.on("end", () => resolve(data));
    });
  }
  for (const request of [
    "GET / HTTP/1.1\r\nHost: fixture.example.invalid\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
    "CONNECT other.example.invalid:443 HTTP/1.1\r\nHost: other.example.invalid\r\n\r\n",
  ])
    for (const peer of ["127.0.0.1", "127.0.0.2"])
      assert.match(
        await raw(request, peer),
        peer === "127.0.0.1" ? /^HTTP\/1.1 405 / : /^HTTP\/1.1 403 /,
      );
  assert.equal(hits, 0);
});

test("shutdown drains a live stream, closes idle sockets and permits a fresh listener", {
  timeout: 5000,
}, async (t) => {
  let firstResponse = true;
  let finishStream!: () => void;
  const app = await fixture(t, (_req, res) => {
    res.write("first-");
    if (firstResponse) {
      firstResponse = false;
      finishStream = () => res.end("last");
    } else res.end("last");
  });
  let started!: () => void;
  const firstChunk = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pending = send(app.publicPort, { onFirstChunk: started });
  await Promise.race([
    firstChunk,
    pending.then(() => {
      throw new Error("The drain fixture ended before its first chunk.");
    }),
  ]);
  const stopping = app.gateway.close(200);
  finishStream();
  assert.equal((await pending).body.toString(), "first-last");
  await stopping;
  const fresh = forwarder.createIngressForwarder({ policy: app.policy });
  await new Promise<void>((resolve) => fresh.server.listen(app.publicPort, "127.0.0.1", resolve));
  assert.equal((await send(app.publicPort)).status, 200);
  await fresh.close(100);
});

test("verified client A and B reach distinct actual pinned BetterAuth buckets despite spoofed XFF", async (t) => {
  const manifest = realpathSync(
    new URL("../node_modules/better-auth/package.json", import.meta.url),
  );
  const require = createRequire(manifest);
  const ip = await import(pathToFileURL(require.resolve("@better-auth/core/utils/ip")).href);
  const limiter = await import(
    pathToFileURL(path.join(path.dirname(manifest), "dist/api/rate-limiter/index.mjs")).href
  );
  const options = {
    advanced: {
      trustedProxyHeaders: false,
      ipAddress: { ipAddressHeaders: [policyLib.internalClientIpHeader], disableIpTracking: false },
    },
  };
  const context = {
    baseURL: "https://fixture.example.invalid/api/auth",
    options,
    rateLimit: {
      enabled: true,
      storage: "memory",
      window: 60,
      max: 100,
      customRules: { "/sign-in/email": { window: 60, max: 2 } },
    },
    logger: {
      warn() {
        throw new Error("Unexpected missing IP");
      },
    },
  };
  const keys: string[] = [];
  const app = await fixture(
    t,
    async (req, res) => {
      const incoming = new Request(`https://fixture.example.invalid${req.url}`, {
        method: "POST",
        headers: {
          [policyLib.internalClientIpHeader]: String(req.headers[policyLib.internalClientIpHeader]),
        },
      });
      const client = ip.getIP(incoming, options);
      keys.push(ip.createRateLimitKey(client, "/sign-in/email"));
      const decision = await limiter.onRequestRateLimit(incoming, context);
      res.statusCode = decision?.status ?? 200;
      res.end("isolated rate decision");
    },
    { trustClientIp: true },
  );
  const attempt = (client: string) =>
    send(app.publicPort, {
      method: "POST",
      path: "/api/auth/sign-in/email",
      headers: [
        "Host",
        "fixture.example.invalid",
        "X-Real-IP",
        client,
        "X-Forwarded-For",
        "198.51.100.123",
        "X-AhiBizz-Ingress-Client-IP",
        "198.51.100.124",
      ],
    });
  assert.equal((await attempt("203.0.113.21")).status, 200);
  assert.equal((await attempt("203.0.113.21")).status, 200);
  assert.equal((await attempt("203.0.113.21")).status, 429);
  assert.equal((await attempt("203.0.113.22")).status, 200);
  assert.deepEqual(keys, [
    "203.0.113.21|/sign-in/email",
    "203.0.113.21|/sign-in/email",
    "203.0.113.21|/sign-in/email",
    "203.0.113.22|/sign-in/email",
  ]);
});

test("client response abort cancels the upstream stream instead of retaining a hidden request", async (t) => {
  let closed = false;
  const app = await fixture(t, (_req, res) => {
    res.write("first");
    const timer = setInterval(() => res.write("next"), 10);
    res.once("close", () => {
      closed = true;
      clearInterval(timer);
    });
  });
  await new Promise<void>((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port: app.publicPort,
        agent: false,
        headers: { Host: "fixture.example.invalid", "X-Real-IP": "203.0.113.9" },
      },
      (res) => {
        res.once("data", () => {
          res.destroy();
          resolve();
        });
        res.on("error", () => {});
      },
    );
    req.on("error", reject);
    req.end();
  });
  for (let count = 0; count < 100 && !closed; count++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(closed, true);
});

test("an unavailable loopback upstream returns a generic error without exposing socket details", async (t) => {
  const app = await fixture(t, (_req, res) => res.end("unused"));
  await close(app.upstream);
  const result = await send(app.publicPort);
  assert.equal(result.status, 502);
  assert.equal(result.body.toString(), "Gateway request unavailable.");
});
