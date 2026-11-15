import assert from "node:assert/strict";
import test from "node:test";
import type { PersonalProfile } from "../src/lib/people";
import { AccountAccessError } from "../src/server/auth/accounts";
import { PeopleAccessError, type PeopleService } from "../src/server/people";
import { createPeopleHttpHandler } from "../src/server/people-http";

const baseURL = "https://people-http-fixture.invalid";
const profile: PersonalProfile = {
  id: "fixture-only",
  name: "Fixture name",
  birthDate: null,
  city: null,
  countryCode: null,
  bio: null,
  skills: [],
  workStatus: "not_specified",
  version: 2,
  photoVersion: 2,
  coverVersion: null,
  canCustomizeCover: false,
};
const image = {
  bytes: Buffer.from("public-safe-fixture-bytes"),
  mime: "image/webp",
  width: 512,
  height: 512,
  version: 2,
};
type Method = "read" | "update" | "readMedia" | "saveMedia" | "removeMedia";
function fixture(
  options: { failure?: { method: Method; error: Error }; missingImage?: boolean } = {},
) {
  const calls: { method: Method; args: unknown[] }[] = [];
  const service = Object.fromEntries(
    (["read", "update", "readMedia", "saveMedia", "removeMedia"] as const).map((method) => [
      method,
      async (...args: unknown[]) => {
        calls.push({ method, args });
        if (options.failure?.method === method) throw options.failure.error;
        return method === "readMedia" ? (options.missingImage ? null : image) : profile;
      },
    ]),
  ) as unknown as PeopleService;
  const http = createPeopleHttpHandler({ service, baseURL });
  async function send(
    method: string,
    path: string,
    options: {
      body?: BodyInit;
      origin?: string | null;
      type?: string | null;
      match?: string;
      headers?: Record<string, string>;
    } = {},
  ) {
    const headers = new Headers({ cookie: "fixture=only", ...options.headers });
    if (options.origin !== null) headers.set("origin", options.origin ?? baseURL);
    if (options.type !== null) headers.set("content-type", options.type ?? "application/json");
    if (options.match !== undefined) headers.set("if-match", options.match);
    const response = await http(
      new Request(new URL(path, baseURL), { method, headers, body: options.body }),
    );
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("pragma"), "no-cache");
    return response;
  }
  return { calls, http, send };
}

test("own profile reads forward real headers and no arbitrary-user route is admitted", async () => {
  const f = fixture();
  assert.deepEqual(await (await f.send("GET", "/api/people/me")).json(), { profile });
  assert.equal(f.calls[0]?.method, "read");
  const headers = f.calls[0]?.args[0];
  assert.ok(headers instanceof Headers);
  assert.equal(headers.get("cookie"), "fixture=only");
  for (const path of [
    "/api/people/other",
    "/api/people/me/other",
    "/api/people/me/media/avatar",
    "/api/people/users/fixture/media/photo",
  ])
    assert.equal((await f.send("GET", path)).status, 404);
  for (const [method, path] of [
    ["POST", "/api/people/me"],
    ["PATCH", "/api/people/me/media/photo"],
    ["DELETE", "/api/people/me"],
  ])
    assert.equal((await f.send(method as string, path as string)).status, 404);
  assert.equal(f.calls.length, 1);
});

test("unauthenticated writes are rejected before body access or image parsing", async () => {
  const f = fixture({
    failure: { method: "read", error: new AccountAccessError(401, "AUTHENTICATION_REQUIRED") },
  });
  let bodyAccess = 0;
  const request = new Request(`${baseURL}/api/people/me/media/photo`, {
    method: "PUT",
    headers: { origin: baseURL, "content-type": "image/png", "if-match": '"0"' },
  });
  Object.defineProperty(request, "body", {
    get() {
      bodyAccess++;
      throw new Error("must not parse unauthenticated bytes");
    },
  });
  const response = await f.http(request);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { code: "AUTHENTICATION_REQUIRED" });
  assert.equal(bodyAccess, 0);
  assert.deepEqual(
    f.calls.map((call) => call.method),
    ["read"],
  );
});

test("private image account query binds browser image requests and rejects conflicting identities", async () => {
  const f = fixture();
  assert.equal(
    (await f.send("GET", "/api/people/me/media/photo?v=2&accountId=fixture-only")).status,
    200,
  );
  const headers = f.calls[0]?.args[0];
  assert.ok(headers instanceof Headers);
  assert.equal(headers.get("X-AhiBizz-Account-ID"), "fixture-only");
  for (const query of ["accountId=", "accountId=other%2Fperson", "accountId=a&accountId=b"])
    assert.equal((await f.send("GET", `/api/people/me/media/photo?${query}`)).status, 400);
  const conflicting = await f.send("GET", "/api/people/me/media/photo?accountId=fixture-only", {
    headers: { "X-AhiBizz-Account-ID": "different-account" },
  });
  assert.equal(conflicting.status, 401);
  assert.equal(f.calls.length, 1);
});

test("write origin is exact and closed query/URL limits reject before authority calls", async () => {
  const f = fixture();
  for (const origin of [null, "https://other.invalid", `${baseURL}.other.invalid`])
    assert.equal((await f.send("PATCH", "/api/people/me", { origin, body: "{}" })).status, 403);
  for (const path of [
    "/api/people/me?userId=other",
    "/api/people/me/media/photo?v=1&v=2",
    "/api/people/me/media/photo?v=abc",
    `/api/people/me?${"q".repeat(8200)}`,
  ])
    assert.equal((await f.send("GET", path)).status, 400);
  assert.equal((await f.send("PUT", "/api/people/me/media/photo?v=1", { body: "{}" })).status, 400);
  assert.equal(f.calls.length, 0);
});

test("profile JSON is bounded to actual 8192 bytes and decoded as strict UTF8 after auth", async () => {
  const f = fixture();
  const body = { expectedVersion: 2, name: "New fixture name" };
  const response = await f.send("PATCH", "/api/people/me", { body: JSON.stringify(body) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { profile });
  assert.deepEqual(
    f.calls.map((call) => call.method),
    ["read", "update"],
  );
  assert.deepEqual(f.calls[1]?.args[1], body);
  for (const body of [undefined, "", '{"bad":}', new Uint8Array([0xff])])
    assert.equal((await f.send("PATCH", "/api/people/me", { body })).status, 400);
  assert.equal(
    (
      await f.send("PATCH", "/api/people/me", {
        body: JSON.stringify({ value: "😀".repeat(2100) }),
        headers: { "content-length": "1" },
      })
    ).status,
    413,
  );
  assert.equal(
    (await f.send("PATCH", "/api/people/me", { type: "text/plain", body: "{}" })).status,
    415,
  );
  assert.equal(f.calls.filter((call) => call.method === "update").length, 1);
});

test("image writes require one strong quoted numeric If-Match before upload bytes reach storage", async () => {
  const f = fixture();
  for (const match of [
    undefined,
    "1",
    'W/"1"',
    "*",
    '"1", "2"',
    '"-1"',
    '"1.5"',
    '"2147483647"',
    '"99999999999"',
  ])
    assert.equal(
      (
        await f.send("PUT", "/api/people/me/media/photo", {
          match,
          type: "image/png",
          body: image.bytes,
        })
      ).status,
      400,
    );
  for (const type of [null, "image/gif", "image/svg+xml", "application/octet-stream"])
    assert.equal(
      (await f.send("PUT", "/api/people/me/media/photo", { match: '"2"', type, body: image.bytes }))
        .status,
      415,
    );
  for (const [kind, type] of [
    ["photo", "image/jpeg"],
    ["cover", "image/png"],
    ["photo", "image/webp"],
  ]) {
    const response = await f.send("PUT", `/api/people/me/media/${kind}`, {
      match: '"2"',
      type,
      body: image.bytes,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { profile });
    const call = f.calls.at(-1);
    assert.equal(call?.method, "saveMedia");
    assert.equal(call?.args[1], kind);
    assert.deepEqual(call?.args[2], { expectedVersion: 2, bytes: new Uint8Array(image.bytes) });
  }
  assert.equal(f.calls.filter((call) => call.method === "saveMedia").length, 3);
});

test("actual image stream bytes cannot exceed four MiB even with false Content-Length", async () => {
  const f = fixture();
  const response = await f.send("PUT", "/api/people/me/media/photo", {
    match: '"2"',
    type: "image/png",
    body: new Uint8Array(4 * 1024 * 1024 + 1),
    headers: { "content-length": "1" },
  });
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { code: "REQUEST_TOO_LARGE" });
  assert.deepEqual(
    f.calls.map((call) => call.method),
    ["read"],
  );
});

test("private image GET is no-store/nosniff/same-origin with no user data in the binary reply", async () => {
  const f = fixture();
  const response = await f.send("GET", "/api/people/me/media/photo?v=2");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/webp");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("content-security-policy"), "default-src 'none'; sandbox");
  assert.equal(
    response.headers.get("content-disposition"),
    'inline; filename="profile-photo.webp"',
  );
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), image.bytes);
  assert.equal(f.calls[0]?.method, "readMedia");
  assert.equal(f.calls[0]?.args[1], "photo");
  assert.equal(
    (await fixture({ missingImage: true }).send("GET", "/api/people/me/media/photo")).status,
    404,
  );
});

test("image removal authenticates and preserves the exact CAS with no request body", async () => {
  const f = fixture();
  assert.equal(
    (await f.send("DELETE", "/api/people/me/media/cover", { match: '"2"' })).status,
    200,
  );
  assert.deepEqual(
    f.calls.map((call) => call.method),
    ["read", "removeMedia"],
  );
  assert.deepEqual(f.calls[1]?.args.slice(1), ["cover", { expectedVersion: 2 }]);
  assert.equal(
    (await f.send("DELETE", "/api/people/me/media/cover", { match: '"2"', body: "{}" })).status,
    400,
  );
  assert.equal(f.calls.filter((call) => call.method === "removeMedia").length, 1);
});

test("typed access errors keep safe codes while unexpected failures expose no database details", async () => {
  for (const [error, status, code] of [
    [new PeopleAccessError(409, "VERSION_CONFLICT"), 409, "VERSION_CONFLICT"],
    [new AccountAccessError(403, "ACCOUNT_SUSPENDED"), 403, "ACCOUNT_SUSPENDED"],
    [new Error("postgresql://private:secret@private.invalid/db"), 503, "PROFILE_UNAVAILABLE"],
  ] as const) {
    const response = await fixture({ failure: { method: "read", error } }).send(
      "GET",
      "/api/people/me",
    );
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { code });
  }
});
