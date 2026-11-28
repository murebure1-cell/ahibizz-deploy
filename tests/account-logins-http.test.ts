import assert from "node:assert/strict";
import test from "node:test";
import { createAccountLoginsHandler } from "../src/server/account-logins-http";
import type { AuthService } from "../src/server/auth/service";

const baseURL = "https://fixture.invalid";

function fixture(options: { providers?: string[]; signedIn?: boolean; stale?: boolean } = {}) {
  const calls = { unlinked: [] as unknown[] };
  let providers = options.providers ?? ["credential", "google"];
  const api = {
    getSession: async () =>
      options.signedIn === false
        ? null
        : { user: { id: "u1" }, session: { id: "s1", userId: "u1", token: "secret" } },
    listUserAccounts: async () =>
      providers.map((providerId) => ({ id: `a-${providerId}`, providerId })),
    unlinkAccount: async (input: { body: { accountId: string } }) => {
      // What the sign-in library answers once the sign-in is more than a day old.
      if (options.stale)
        throw Object.assign(new Error("Session is not fresh"), {
          statusCode: 403,
          body: { code: "SESSION_NOT_FRESH", message: "Session is not fresh" },
        });
      calls.unlinked.push(input.body);
      providers = providers.filter((providerId) => `a-${providerId}` !== input.body.accountId);
    },
  };
  const http = createAccountLoginsHandler({
    auth: () => ({ api }) as unknown as AuthService,
    baseURL: () => baseURL,
  });
  return { http, calls };
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
  return http(new Request(`${baseURL}/api/account/logins`, { method, headers, body }));
}

async function refused(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), { code });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
}

test("the app reads how its account signs in, and nothing about the linked account itself", async () => {
  const response = await call(fixture().http, "GET");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { logins: { google: true, password: true } });
  assert.deepEqual(await (await call(fixture({ providers: ["google"] }).http, "GET")).json(), {
    logins: { google: true, password: false },
  });
  assert.deepEqual(await (await call(fixture({ providers: ["credential"] }).http, "GET")).json(), {
    logins: { google: false, password: true },
  });
});

test("Google is detached once, and only while a password remains", async () => {
  const { http, calls } = fixture();
  const response = await call(http, "POST", { body: { google: false } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { logins: { google: false, password: true } });
  assert.deepEqual(calls.unlinked, [{ accountId: "a-google" }]);
  await refused(await call(http, "POST", { body: { google: false } }), 404, "GOOGLE_NOT_LINKED");
  const googleOnly = fixture({ providers: ["google"] });
  await refused(
    await call(googleOnly.http, "POST", { body: { google: false } }),
    409,
    "PASSWORD_REQUIRED",
  );
  assert.equal(googleOnly.calls.unlinked.length, 0);
});

test("more than a day after signing in, detaching asks for a new sign-in", async () => {
  const stale = fixture({ stale: true });
  await refused(await call(stale.http, "POST", { body: { google: false } }), 403, "SIGN_IN_AGAIN");
  assert.equal(stale.calls.unlinked.length, 0);
  // Reading is not affected.
  assert.equal((await call(stale.http, "GET")).status, 200);
});

test("a change comes from this site, as JSON, for the account shown, and only detaches", async () => {
  const { http, calls } = fixture();
  const wanted = { body: { google: false } };
  await refused(
    await call(http, "POST", { ...wanted, origin: "https://untrusted.invalid" }),
    403,
    "INVALID_ORIGIN",
  );
  await refused(await call(http, "POST", { ...wanted, origin: null }), 403, "INVALID_ORIGIN");
  await refused(
    await call(http, "POST", { ...wanted, type: "text/plain" }),
    415,
    "INVALID_CONTENT_TYPE",
  );
  await refused(
    await call(http, "POST", { ...wanted, account: "u2" }),
    401,
    "ACCOUNT_IDENTITY_CHANGED",
  );
  await refused(
    await call(http, "POST", { ...wanted, account: null }),
    401,
    "ACCOUNT_IDENTITY_CHANGED",
  );
  for (const body of [
    {},
    { google: true },
    { google: "false" },
    { google: null },
    { google: false, password: false },
    { password: false },
    [false],
    false,
    null,
  ])
    await refused(await call(http, "POST", { body }), 400, "INVALID_REQUEST");
  for (const method of ["PUT", "PATCH", "DELETE"])
    await refused(await call(http, method), 405, "METHOD_NOT_ALLOWED");
  await refused(
    await call(fixture({ signedIn: false }).http, "POST", wanted),
    401,
    "AUTHENTICATION_REQUIRED",
  );
  assert.equal(calls.unlinked.length, 0);
});
