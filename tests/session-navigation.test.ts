import assert from "node:assert/strict";
import test from "node:test";
import { headerAccessRequest, readHeaderAccess } from "../src/lib/header-access";
import { readEligibleNavigationRole, signedInReturnPath } from "../src/lib/session-navigation";

const member = { id: "fixture-member", role: "member", emailVerified: true, approval: "approved" };
const owner = { ...member, id: "fixture-owner", role: "owner" };

test("navigation presents a role only for an eligible well-formed current account", () => {
  assert.equal(readEligibleNavigationRole(member), "member");
  assert.equal(readEligibleNavigationRole(owner), "owner");
  for (const value of [
    null,
    [],
    {},
    "owner",
    { ...owner, id: "" },
    { ...owner, id: "../owner" },
    { ...owner, id: "x".repeat(129) },
    { ...owner, role: "admin" },
    { ...owner, emailVerified: "true" },
    { ...owner, emailVerified: false },
    { ...owner, approval: "pending" },
    { ...owner, approval: "suspended" },
    Object.create(owner),
  ]) {
    assert.equal(readEligibleNavigationRole(value), null);
    assert.equal(readHeaderAccess({ account: value }), "unknown");
  }
  for (const value of [null, [], owner, { user: owner }, Object.create({ account: owner })])
    assert.equal(readHeaderAccess(value), "unknown");
  assert.equal(readHeaderAccess({ account: owner }), "owner");
});

test("eligible sign-in shortcuts use only closed paths and preserve owner admin destinations", () => {
  for (const path of [
    "/administracija",
    "/administracija/uvoz-prijava",
    "/administracija?odjeljak=nalozi",
    "/administracija?odjeljak=kategorije",
    "/administracija?odjeljak=djelatnosti",
    "/administracija?odjeljak=naplata",
  ]) {
    assert.equal(signedInReturnPath(owner, path), path);
    assert.equal(signedInReturnPath(member, path), "/nalog");
  }
  for (const path of [
    "/nalog?odjeljak=poruke&osoba=fixture-person",
    "/nalog?odjeljak=termini",
    "/djelatnosti/11111111-1111-4111-8111-111111111111#business-appointments",
  ])
    assert.equal(signedInReturnPath(member, path), path);
  for (const value of ["https://evil.invalid", "//evil.invalid", ["/administracija"], undefined])
    assert.equal(signedInReturnPath(owner, value), "/nalog");
});

test("absent or denied accounts never skip the sign-in form", () => {
  for (const value of [
    null,
    {},
    { ...owner, emailVerified: false },
    { ...owner, approval: "suspended" },
  ])
    assert.equal(signedInReturnPath(value, "/administracija?odjeljak=naplata"), null);
});

test("lazy header access uses one credentialed no-store GET and treats only401 as guest", async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  const cases: [number, unknown, string][] = [
    [200, { account: owner }, "owner"],
    [200, { account: member }, "member"],
    [200, { account: { ...owner, approval: "suspended" } }, "unknown"],
    [200, { role: "owner" }, "unknown"],
    [401, { account: owner }, "guest"],
    [403, { account: owner }, "unknown"],
    [429, { account: owner }, "unknown"],
    [503, { account: owner }, "unknown"],
  ];
  let calls = 0;
  try {
    for (const [status, body, expected] of cases) {
      globalThis.fetch = async (url, options) => {
        calls++;
        assert.equal(url, "/api/account");
        assert.equal(options?.method, "GET");
        assert.equal(options?.credentials, "same-origin");
        assert.equal(options?.mode, "same-origin");
        assert.equal(options?.redirect, "error");
        assert.equal(options?.cache, "no-store");
        assert.equal(options?.signal, controller.signal);
        assert.equal(options?.body, undefined);
        return Response.json(body, { status });
      };
      assert.equal(await headerAccessRequest({ signal: controller.signal }), expected);
    }
    assert.equal(calls, cases.length);
    globalThis.fetch = async () => new Response("invalid JSON", { status: 200 });
    assert.equal(await headerAccessRequest({ signal: controller.signal }), "unknown");
    globalThis.fetch = async () => {
      throw new Error("isolated network failure");
    };
    await assert.rejects(() => headerAccessRequest({ signal: controller.signal }));
  } finally {
    globalThis.fetch = original;
  }
});
