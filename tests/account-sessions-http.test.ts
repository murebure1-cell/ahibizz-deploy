import assert from "node:assert/strict";
import test from "node:test";
import { createAccountSessionsHandler } from "../src/server/account-sessions-http";
import type { AuthService } from "../src/server/auth/service";

const baseURL = "https://fixture.invalid";

function fixture(options: { signedIn?: boolean; available?: boolean } = {}) {
  const calls = { revoked: [] as unknown[], others: 0 };
  const expiresAt = new Date(Date.now() + 86400000);
  let sessions = [
    {
      id: "s-old",
      token: "secret-old",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) AppleWebKit Version/18.0 Safari/604.1",
      updatedAt: new Date("2026-11-20T10:00:00Z"),
      expiresAt,
    },
    {
      id: "s-app",
      token: "secret-app",
      userAgent: "AhiBizz/1.0.0 (Android)",
      updatedAt: new Date("2026-11-28T08:00:00Z"),
      expiresAt,
    },
    {
      id: "s-web",
      token: "secret-web",
      userAgent: "Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/131.0 Safari/537.36",
      updatedAt: new Date("2026-11-27T10:00:00Z"),
      expiresAt,
    },
  ];
  const $context = Promise.resolve({
    internalAdapter: { listSessions: async (userId: string) => (userId === "u1" ? sessions : []) },
  });
  const api = {
    getSession: async () =>
      options.signedIn === false
        ? null
        : { user: { id: "u1" }, session: { id: "s-app", userId: "u1", token: "secret-app" } },
    revokeSession: async (input: { body: { token: string } }) => {
      calls.revoked.push(input.body);
      sessions = sessions.filter((entry) => entry.token !== input.body.token);
    },
    revokeOtherSessions: async () => {
      calls.others += 1;
      sessions = sessions.filter((entry) => entry.id === "s-app");
    },
  };
  const http = createAccountSessionsHandler({
    auth: () =>
      options.available === false ? null : ({ api, $context } as unknown as AuthService),
    baseURL: () => baseURL,
  });
  return { http, calls };
}

type Call = {
  body?: unknown;
  raw?: string;
  account?: string | null;
  origin?: string | null;
  type?: string;
  query?: string;
};

function call(http: (request: Request) => Promise<Response>, method: string, init: Call = {}) {
  const headers = new Headers({ Cookie: "session=fixture" });
  const account = init.account === undefined ? "u1" : init.account;
  if (account !== null) headers.set("X-AhiBizz-Account-ID", account);
  const origin = init.origin === undefined ? baseURL : init.origin;
  if (origin !== null) headers.set("Origin", origin);
  const body = init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body));
  if (body !== undefined) headers.set("Content-Type", init.type ?? "application/json");
  return http(
    new Request(`${baseURL}/api/account/sessions${init.query ?? ""}`, { method, headers, body }),
  );
}

async function refused(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), { code });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
}

test("the app reads its account's sign-ins without tokens, this device first", async () => {
  const { http } = fixture();
  const response = await call(http, "GET");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const text = await response.text();
  assert.doesNotMatch(text, /secret|token|userAgent/);
  assert.deepEqual(JSON.parse(text), {
    sessions: [
      {
        id: "s-app",
        device: "Android",
        browser: "AhiBizz",
        lastActive: "2026-11-28T08:00:00.000Z",
        current: true,
      },
      {
        id: "s-web",
        device: "Windows",
        browser: "Chrome",
        lastActive: "2026-11-27T10:00:00.000Z",
        current: false,
      },
      {
        id: "s-old",
        device: "iPhone",
        browser: "Safari",
        lastActive: "2026-11-20T10:00:00.000Z",
        current: false,
      },
    ],
  });
});

test("only the signed-in account its screen was showing is answered", async () => {
  const { http } = fixture();
  await refused(await call(http, "GET", { account: null }), 401, "ACCOUNT_IDENTITY_CHANGED");
  await refused(await call(http, "GET", { account: "u2" }), 401, "ACCOUNT_IDENTITY_CHANGED");
  await refused(await call(http, "GET", { account: "not an id" }), 400, "INVALID_PROFILE");
  await refused(await call(http, "GET", { query: "?id=s-web" }), 400, "INVALID_REQUEST");
  for (const method of ["PUT", "PATCH", "DELETE"])
    await refused(await call(http, method), 405, "METHOD_NOT_ALLOWED");
  const signedOut = fixture({ signedIn: false });
  await refused(await call(signedOut.http, "GET"), 401, "AUTHENTICATION_REQUIRED");
  // Who is asking is settled before what they sent is read.
  await refused(
    await call(signedOut.http, "POST", { body: { nothing: 1 } }),
    401,
    "AUTHENTICATION_REQUIRED",
  );
  assert.equal(signedOut.calls.revoked.length + signedOut.calls.others, 0);
  await refused(await call(fixture({ available: false }).http, "GET"), 503, "ACCOUNT_UNAVAILABLE");
});

test("one other device is signed out by its id, and never this one", async () => {
  const { http, calls } = fixture();
  const response = await call(http, "POST", { body: { id: "s-web" } });
  assert.equal(response.status, 200);
  const data = (await response.json()) as { sessions: { id: string }[] };
  assert.deepEqual(
    data.sessions.map((entry) => entry.id),
    ["s-app", "s-old"],
  );
  // The token is found on the server; the app only ever named the id.
  assert.deepEqual(calls.revoked, [{ token: "secret-web" }]);
  await refused(await call(http, "POST", { body: { id: "s-app" } }), 400, "CURRENT_SESSION");
  await refused(await call(http, "POST", { body: { id: "s-web" } }), 404, "SESSION_NOT_FOUND");
  await refused(await call(http, "POST", { body: { id: "../x" } }), 400, "INVALID_SESSION");
  assert.equal(calls.revoked.length, 1);
  assert.equal(calls.others, 0);
});

test("every other device is signed out in one request", async () => {
  const { http, calls } = fixture();
  const response = await call(http, "POST", { body: { others: true } });
  assert.equal(response.status, 200);
  const data = (await response.json()) as { sessions: { id: string; current: boolean }[] };
  assert.deepEqual(data.sessions, [
    {
      id: "s-app",
      device: "Android",
      browser: "AhiBizz",
      lastActive: "2026-11-28T08:00:00.000Z",
      current: true,
    },
  ]);
  assert.equal(calls.others, 1);
  assert.equal(calls.revoked.length, 0);
});

test("a change comes from this site, as JSON, asking for exactly one thing", async () => {
  const { http, calls } = fixture();
  const wanted = { body: { id: "s-web" } };
  await refused(
    await call(http, "POST", { ...wanted, origin: "https://untrusted.invalid" }),
    403,
    "INVALID_ORIGIN",
  );
  await refused(await call(http, "POST", { ...wanted, origin: null }), 403, "INVALID_ORIGIN");
  await refused(await call(http, "POST", { ...wanted, origin: "null" }), 403, "INVALID_ORIGIN");
  await refused(
    await call(http, "POST", { ...wanted, type: "text/plain" }),
    415,
    "INVALID_CONTENT_TYPE",
  );
  for (const body of [
    {},
    { id: 1 },
    { id: null },
    { others: false },
    { others: "true" },
    { id: "s-web", others: true },
    { id: "s-web", token: "secret-web" },
    ["s-web"],
    "s-web",
    null,
  ])
    await refused(await call(http, "POST", { body }), 400, "INVALID_REQUEST");
  for (const raw of ["", "{", '{"id":"s-web","id":"s-old"}'])
    await refused(await call(http, "POST", { raw }), 400, "INVALID_REQUEST");
  await refused(
    await call(http, "POST", { body: { id: "x".repeat(5000) } }),
    413,
    "REQUEST_TOO_LARGE",
  );
  assert.equal(calls.revoked.length, 0);
  assert.equal(calls.others, 0);
});
