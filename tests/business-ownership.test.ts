import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  type BusinessOwnershipService,
  OwnershipAccessError,
} from "../src/server/business-ownership";
import {
  accountId,
  commandInput,
  email,
  lookupInput,
  uuid,
} from "../src/server/business-ownership/validation";
import { createBusinessOwnershipHttpHandler } from "../src/server/business-ownership-http";

const origin = "https://ownership-fixture.invalid",
  id = randomUUID(),
  key = randomUUID();
const command = {
  expectedVersion: 3,
  targetAccountId: "fixture-target",
  targetEmail: "target@fixture.invalid",
  idempotencyKey: key,
};
const invalid = (action: () => unknown) =>
  assert.throws(
    action,
    (error) =>
      error instanceof OwnershipAccessError &&
      error.status === 400 &&
      error.code === "INVALID_OWNERSHIP_INPUT",
  );
test("ownership email lookup is exact, normalized and explicitly bounded", () => {
  assert.equal(email(" Target@Fixture.Invalid "), "target@fixture.invalid");
  assert.equal(lookupInput({ email: "Target@Fixture.Invalid" }), "target@fixture.invalid");
  for (const value of [
    "target",
    "a@b",
    "a@b.invalid\n",
    "a@b.invalid\u202e",
    "<a>@b.invalid",
    "a@b.invalid other",
    "x".repeat(255),
    null,
    ["a@b.invalid"],
  ])
    invalid(() => email(value));
  invalid(() => lookupInput({ email: "target@fixture.invalid", role: "owner" }));
});
test("ownership command preserves stable identity and rejects escalation/unbounded fields", () => {
  assert.deepEqual(
    commandInput({
      ...command,
      targetEmail: "TARGET@FIXTURE.INVALID",
      note: " Prijenos vlasniku ",
    }),
    { ...command, note: "Prijenos vlasniku" },
  );
  assert.deepEqual(commandInput(command), { ...command, note: "" });
  for (const patch of [
    { expectedVersion: 0 },
    { expectedVersion: 2147483647 },
    { expectedVersion: 1.5 },
    { targetAccountId: "other user" },
    { targetEmail: "a@b" },
    { idempotencyKey: "a" },
    { note: "x".repeat(501) },
    { note: "a\nb" },
    { note: "<script>" },
    { note: null },
    { ownerId: "x" },
    { status: "published" },
  ])
    invalid(() => commandInput({ ...command, ...patch }));
});
test("ownership identifiers do not accept traversal, arrays or versionless UUIDs", () => {
  assert.equal(uuid(id.toUpperCase()), id);
  assert.equal(accountId("a-b_C123"), "a-b_C123");
  for (const value of ["../x", "", "a b", "x".repeat(129), null, ["abc"]])
    invalid(() => accountId(value));
  for (const value of ["../x", "00000000-0000-0000-0000-000000000000", null, [id]])
    invalid(() => uuid(value));
});
function fixture(failure?: { method: string; status: number; code: string }) {
  const calls: { method: string; args: unknown[] }[] = [];
  const service = Object.fromEntries(
    ["authenticate", "read", "lookup", "assign"].map((method) => [
      method,
      async (...args: unknown[]) => {
        calls.push({ method, args });
        if (failure?.method === method)
          throw new OwnershipAccessError(failure.status, failure.code);
        if (method === "authenticate") return "admin";
        return {
          business: { id },
          currentOwner: { id: "old", name: "Owner", email: "owner@fixture.invalid" },
          receipt: null,
          ...(method === "lookup"
            ? {
                candidate: {
                  id: command.targetAccountId,
                  name: "Target",
                  email: command.targetEmail,
                },
              }
            : {}),
        };
      },
    ]),
  ) as unknown as BusinessOwnershipService;
  const handler = createBusinessOwnershipHttpHandler({ service, baseURL: origin });
  const send = (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    handler(
      new Request(origin + path, {
        method,
        headers: { origin, "content-type": "application/json", ...headers },
        ...(body === undefined
          ? {}
          : { body: typeof body === "string" ? body : JSON.stringify(body) }),
      }),
    );
  return { calls, send };
}
const route = `/api/directory/ownership/${id}`;
test("private ownership GET passes expected actor and optional request receipt without a write", async () => {
  const f = fixture(),
    response = await f.send("GET", `${route}?requestId=${key}`, undefined, {
      "X-AhiBizz-Account-ID": "admin",
    });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Pragma"), "no-cache");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal(f.calls.length, 1);
  const call = f.calls[0];
  assert.ok(call);
  assert.equal(call.method, "read");
  assert.equal((call.args[0] as Headers).get("X-AhiBizz-Account-ID"), "admin");
  assert.equal(f.calls[0]?.args[2], key);
});
test("private lookup sends the exact normalized target only after authority", async () => {
  const f = fixture(),
    response = await f.send("POST", `${route}/lookup`, { email: " Target@Fixture.Invalid " });
  assert.equal(response.status, 200);
  assert.deepEqual(
    f.calls.map((c) => c.method),
    ["authenticate", "lookup"],
  );
  assert.deepEqual(f.calls[1]?.args[2], { email: "target@fixture.invalid" });
});
test("assign authenticates before dispatch and retains the original key and CAS version", async () => {
  const f = fixture(),
    response = await f.send("PUT", route, command);
  assert.equal(response.status, 200);
  assert.deepEqual(
    f.calls.map((c) => c.method),
    ["authenticate", "assign"],
  );
  assert.deepEqual(f.calls[1]?.args[2], { ...command, note: "" });
});
for (const requestOrigin of ["https://evil.invalid", "null", `${origin}.evil`])
  test(`ownership refuses foreign origin ${requestOrigin} before parsing or authorization`, async () => {
    const f = fixture(),
      response = await f.send("PUT", route, "malformed", { origin: requestOrigin });
    assert.equal(response.status, 403);
    assert.deepEqual(f.calls, []);
  });
test("ownership denial happens before reading malformed private input", async () => {
  const f = fixture({ method: "authenticate", status: 403, code: "OWNER_REQUIRED" }),
    response = await f.send("POST", `${route}/lookup`, "malformed");
  assert.equal(response.status, 403);
  assert.deepEqual(
    f.calls.map((c) => c.method),
    ["authenticate"],
  );
});
test("duplicate, unknown, invalid and email-bearing query strings never invoke private services", async () => {
  for (const suffix of [
    `?requestId=${key}&requestId=${key}`,
    "?email=target%40fixture.invalid",
    "?requestId=no",
    "?page=1",
  ]) {
    const f = fixture(),
      response = await f.send("GET", route + suffix);
    assert.equal(response.status, 400);
    assert.deepEqual(f.calls, []);
  }
});
test("ownership rejects duplicate JSON property names instead of choosing one target", async () => {
  const f = fixture(),
    response = await f.send(
      "POST",
      `${route}/lookup`,
      '{"email":"a@fixture.invalid","email":"b@fixture.invalid"}',
    );
  assert.equal(response.status, 400);
  assert.deepEqual(
    f.calls.map((c) => c.method),
    ["authenticate"],
  );
});
test("ownership input streams are bounded before any assign", async () => {
  const f = fixture(),
    response = await f.send("PUT", route, JSON.stringify({ ...command, note: "x".repeat(4200) }));
  assert.equal(response.status, 413);
  assert.deepEqual(
    f.calls.map((c) => c.method),
    ["authenticate"],
  );
});
test("ownership requires JSON and no query parameters for private POST or PUT", async () => {
  const f = fixture();
  assert.equal((await f.send("PUT", route, command, { "content-type": "text/plain" })).status, 415);
  assert.equal(
    (await f.send("POST", `${route}/lookup?requestId=${key}`, { email: command.targetEmail }))
      .status,
    400,
  );
  assert.deepEqual(
    f.calls.map((c) => c.method),
    ["authenticate"],
  );
});
test("ownership response surfaces stable access codes without returning request credentials", async () => {
  const f = fixture({ method: "assign", status: 409, code: "BUSINESS_LIMIT_REACHED" }),
    response = await f.send("PUT", route, command, { cookie: "private-cookie" });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { code: "BUSINESS_LIMIT_REACHED" });
});
test("ownership exposes only the exact route and three documented methods", async () => {
  for (const [method, path] of [
    ["POST", route],
    ["GET", `${route}/lookup`],
    ["PATCH", route],
    ["PUT", `${route}/extra`],
    ["GET", "/api/directory/ownership/not-an-id"],
  ]) {
    const f = fixture(),
      response = await f.send(method as string, path as string, method === "GET" ? undefined : {});
    assert.equal(response.status, 404);
    assert.deepEqual(f.calls, []);
  }
});
