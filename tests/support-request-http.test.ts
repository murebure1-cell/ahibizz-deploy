import assert from "node:assert/strict";
import test from "node:test";
import { AccountAccessError } from "../src/server/auth/accounts";
import type { AuthService } from "../src/server/auth/service";
import { createSupportRequestHandler } from "../src/server/support-request-http";

const baseURL = "https://fixture.invalid";
const key = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";

function fixture(options: { signedIn?: boolean; fail?: AccountAccessError } = {}) {
  const sent: unknown[][] = [];
  const api = {
    getSession: async () =>
      options.signedIn === false
        ? null
        : { user: { id: "u1" }, session: { id: "s1", userId: "u1", token: "secret" } },
  };
  const http = createSupportRequestHandler({
    auth: () => ({ api }) as unknown as AuthService,
    baseURL: () => baseURL,
    submit: () => async (_headers, subject, reference, details) => {
      if (options.fail) throw options.fail;
      sent.push([subject, reference, details]);
    },
  });
  return { http, sent };
}

type Call = { body?: unknown; account?: string | null; origin?: string | null; type?: string };

function call(http: (request: Request) => Promise<Response>, method: string, init: Call = {}) {
  const headers = new Headers({ Cookie: "session=fixture" });
  const account = init.account === undefined ? "u1" : init.account;
  if (account !== null) headers.set("X-AhiBizz-Account-ID", account);
  const origin = init.origin === undefined ? baseURL : init.origin;
  if (origin !== null) headers.set("Origin", origin);
  const body = init.body === undefined ? undefined : JSON.stringify(init.body);
  if (body !== undefined) headers.set("Content-Type", init.type ?? "application/json");
  return http(new Request(`${baseURL}/api/support/requests`, { method, headers, body }));
}

async function refused(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), { code });
}

test("a question from the app reaches support as a help request under its topic", async () => {
  const { http, sent } = fixture();
  const response = await call(http, "POST", {
    body: { topic: "nalog", details: "Ne stiže mi email.", key },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sent: true });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  await call(http, "POST", { body: { topic: "ostalo", details: "Pitanje.", key } });
  assert.deepEqual(sent, [
    ["help", `nalog--${key}`, "Ne stiže mi email."],
    ["help", `ostalo--${key}`, "Pitanje."],
  ]);
});

test("only a whole, well-formed question from this site and this account is passed on", async () => {
  const { http, sent } = fixture();
  const good = { topic: "nalog", details: "Pitanje.", key };
  for (const body of [
    {},
    { ...good, topic: "nepoznato" },
    { ...good, topic: 1 },
    { ...good, key: "not-a-uuid" },
    { ...good, key: undefined },
    { ...good, details: 5 },
    { ...good, subject: "deletion" },
    { ...good, reference: "x" },
    [good],
    null,
  ])
    await refused(await call(http, "POST", { body }), 400, "INVALID_REQUEST");
  await refused(
    await call(http, "POST", { body: good, origin: "https://untrusted.invalid" }),
    403,
    "INVALID_ORIGIN",
  );
  await refused(
    await call(http, "POST", { body: good, type: "text/plain" }),
    415,
    "INVALID_CONTENT_TYPE",
  );
  await refused(
    await call(http, "POST", { body: good, account: "u2" }),
    401,
    "ACCOUNT_IDENTITY_CHANGED",
  );
  await refused(await call(http, "GET"), 405, "METHOD_NOT_ALLOWED");
  await refused(
    await call(fixture({ signedIn: false }).http, "POST", { body: good }),
    401,
    "AUTHENTICATION_REQUIRED",
  );
  assert.equal(sent.length, 0);
});

test("the service's own refusals keep their status: too long, or too many in a day", async () => {
  const good = { topic: "nalog", details: "Pitanje.", key };
  await refused(
    await call(fixture({ fail: new AccountAccessError(429, "TOO_MANY_REQUESTS") }).http, "POST", {
      body: good,
    }),
    429,
    "TOO_MANY_REQUESTS",
  );
  await refused(
    await call(fixture({ fail: new AccountAccessError(400, "INVALID_REQUEST") }).http, "POST", {
      body: good,
    }),
    400,
    "INVALID_REQUEST",
  );
});

test("a deletion request from the app needs an explicit confirmation and nothing else", async () => {
  const { createDeletionRequestHandler } = await import("../src/server/support-request-http");
  const sent: unknown[][] = [];
  const api = {
    getSession: async () => ({
      user: { id: "u1" },
      session: { id: "s1", userId: "u1", token: "secret" },
    }),
  };
  const http = createDeletionRequestHandler({
    auth: () => ({ api }) as unknown as AuthService,
    baseURL: () => baseURL,
    submit: () => async (_headers, subject, reference, details) => {
      sent.push([subject, reference, details]);
    },
  });
  const post = (body: unknown, init: Call = {}) => {
    const headers = new Headers({
      Cookie: "session=fixture",
      "Content-Type": "application/json",
      Origin: init.origin ?? baseURL,
      "X-AhiBizz-Account-ID": init.account ?? "u1",
    });
    return http(
      new Request(`${baseURL}/api/support/deletion`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }),
    );
  };
  for (const body of [{}, { confirm: false }, { confirm: "yes" }, { confirm: true, details: "x" }])
    await refused(await post(body), 400, "INVALID_REQUEST");
  await refused(
    await post({ confirm: true }, { origin: "https://untrusted.invalid" }),
    403,
    "INVALID_ORIGIN",
  );
  await refused(await post({ confirm: true }, { account: "u2" }), 401, "ACCOUNT_IDENTITY_CHANGED");
  assert.equal(sent.length, 0);
  const response = await post({ confirm: true });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sent: true });
  assert.deepEqual(sent, [["deletion", "", ""]]);
});

test("a report from the app reaches support under its subject, with the reason in front", async () => {
  const { createContentReportHandler } = await import("../src/server/support-request-http");
  const sent: unknown[][] = [];
  const api = {
    getSession: async () => ({
      user: { id: "u1" },
      session: { id: "s1", userId: "u1", token: "secret" },
    }),
  };
  const http = createContentReportHandler({
    auth: () => ({ api }) as unknown as AuthService,
    baseURL: () => baseURL,
    submit: () => async (_headers, subject, reference, details) => {
      sent.push([subject, reference, details]);
    },
  });
  const reel = "0b6f0a52-6f0e-4a57-9d55-2f6f3b1c9a10";
  const good = { subject: "reel", reference: reel, reason: "hate", details: " Vrijeđa. " };
  const response = await call(http, "POST", { body: good });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sent: true });
  await call(http, "POST", {
    body: { subject: "business", reference: "b-17", reason: "other", details: "" },
  });
  assert.deepEqual(sent, [
    ["reel", reel, "Uvreda ili govor mržnje. Vrijeđa."],
    ["business", "b-17", "Nešto drugo."],
  ]);
  for (const body of [
    { ...good, subject: "help" },
    { ...good, subject: "deletion", reference: "" },
    { ...good, reference: "not-a-reel-id" },
    { ...good, reason: "toString" },
    { ...good, reason: "spam" },
    { ...good, details: 5 },
    { ...good, extra: true },
    { subject: "reel", reference: reel, reason: "hate" },
    [good],
  ])
    await refused(await call(http, "POST", { body }), 400, "INVALID_REQUEST");
  await refused(await call(http, "GET"), 405, "METHOD_NOT_ALLOWED");
  await refused(
    await call(http, "POST", { body: good, origin: "https://other.invalid" }),
    403,
    "INVALID_ORIGIN",
  );
  await refused(
    await call(http, "POST", { body: good, account: "u2" }),
    401,
    "ACCOUNT_IDENTITY_CHANGED",
  );
  assert.equal(sent.length, 2);
});
