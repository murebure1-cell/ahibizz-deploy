import assert from "node:assert/strict";
import test from "node:test";
import {
  type AccountPackageSnapshot,
  isPackageId,
  packageBusinessLimit,
  packageIds,
  packageName,
  readAccountPackage,
} from "../src/lib/packages";
import { packageInput, packageTarget } from "../src/server/account-package";
import { createAccountPackageHttpHandler } from "../src/server/account-package-http";
import { AccountAccessError } from "../src/server/auth/accounts";

test("the three packages carry the limits the owner set", () => {
  assert.deepEqual([...packageIds], ["basic", "startup", "business"]);
  assert.deepEqual(packageIds.map(packageBusinessLimit), [1, 3, 10]);
  assert.deepEqual(packageIds.map(packageName), ["Basic", "Startup", "Business"]);
  for (const other of ["premium", "Basic", "", null, 1, undefined])
    assert.equal(isPackageId(other), false);
});

const snapshot: AccountPackageSnapshot = {
  id: "member-1",
  subjectLabel: "Fixture owner",
  identity: "owner@package-fixture.invalid",
  package: "startup",
  version: 2,
  businesses: 2,
  businessLimit: 3,
  lastDecision: {
    previousPackage: "basic",
    package: "startup",
    reason: "Dogovoreno",
    actorName: "Administrator",
    at: "2026-11-25T10:00:00.000Z",
  },
};

test("an account's package is read only for the account that was asked about", () => {
  assert.deepEqual(readAccountPackage(snapshot, "member-1"), snapshot);
  const untouched = {
    ...snapshot,
    package: "basic",
    version: 0,
    businessLimit: 1,
    lastDecision: null,
  };
  assert.deepEqual(readAccountPackage(untouched, "member-1"), untouched);
  for (const wrong of [
    null,
    [],
    { ...snapshot, id: "member-2" },
    { ...snapshot, package: "premium" },
    { ...snapshot, businessLimit: 10 },
    { ...snapshot, businesses: -1 },
    { ...snapshot, version: 1.5 },
    { ...snapshot, extra: true },
    { ...snapshot, lastDecision: null },
    { ...untouched, package: "startup", businessLimit: 3 },
    { ...snapshot, lastDecision: { ...snapshot.lastDecision, package: "business" } },
    { ...snapshot, lastDecision: { ...snapshot.lastDecision, previousPackage: "startup" } },
    { ...snapshot, lastDecision: { ...snapshot.lastDecision, at: "yesterday" } },
    { ...snapshot, lastDecision: { ...snapshot.lastDecision, reason: "" } },
  ])
    assert.throws(() => readAccountPackage(wrong, "member-1"), JSON.stringify(wrong));
});

test("a package change needs a known package, the current version and a reason", () => {
  assert.deepEqual(
    packageInput({ package: "business", expectedVersion: 0, reason: " Uplata \r\n" }),
    {
      package: "business",
      expectedVersion: 0,
      reason: "Uplata",
    },
  );
  for (const wrong of [
    null,
    [],
    { package: "premium", expectedVersion: 0, reason: "x" },
    { package: "basic", expectedVersion: -1, reason: "x" },
    { package: "basic", expectedVersion: "0", reason: "x" },
    { package: "basic", expectedVersion: 0, reason: " " },
    { package: "basic", expectedVersion: 0, reason: "x".repeat(501) },
    { package: "basic", expectedVersion: 0, reason: "a\u0000b" },
    { package: "basic", expectedVersion: 0, reason: "x", userId: "member-2" },
    { package: "basic", expectedVersion: 0 },
  ])
    assert.throws(
      () => packageInput(wrong),
      (error) => error instanceof AccountAccessError && error.status === 400,
      JSON.stringify(wrong),
    );
  assert.equal(packageTarget("member_1-A"), "member_1-A");
  for (const wrong of ["", "a/b", "a b", "x".repeat(129)])
    assert.throws(() => packageTarget(wrong), AccountAccessError);
});

test("the package route reads freely but writes only same-origin JSON", async () => {
  const baseURL = "https://fixture.example.invalid";
  const calls: unknown[][] = [];
  const service = {
    read: async (_headers: Headers, id: string) => {
      calls.push(["read", id]);
      return { ...snapshot, id };
    },
    decide: async (_headers: Headers, id: string, input: unknown) => {
      calls.push(["decide", id, input]);
      return { ...snapshot, id };
    },
  };
  const api = createAccountPackageHttpHandler(service, baseURL);
  const send = (path: string, init: RequestInit = {}) =>
    api(new Request(`${baseURL}${path}`, init));
  const body = JSON.stringify({ package: "startup", expectedVersion: 0, reason: "Dogovoreno" });
  const json = { origin: baseURL, "content-type": "application/json" };

  const read = await send("/api/admin/packages/member-1");
  assert.equal(read.status, 200);
  assert.equal(read.headers.get("cache-control"), "no-store");
  assert.equal((await send("/api/admin/packages/member-1?x=1")).status, 400);
  assert.equal((await send("/api/admin/packages/a%20b")).status, 400);
  assert.equal((await send("/api/admin/packages/member-1", { method: "DELETE" })).status, 405);
  assert.equal(
    (
      await send("/api/admin/packages/member-1", {
        method: "PUT",
        body,
        headers: { ...json, origin: "https://other.invalid" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await send("/api/admin/packages/member-1", {
        method: "PUT",
        body,
        headers: { origin: baseURL, "content-type": "text/plain" },
      })
    ).status,
    415,
  );
  assert.equal(
    (
      await send("/api/admin/packages/member-1", {
        method: "PUT",
        body: '{"package":"basic","package":"business","expectedVersion":0,"reason":"x"}',
        headers: json,
      })
    ).status,
    400,
  );
  assert.deepEqual(calls, [["read", "member-1"]]);
  assert.equal(
    (await send("/api/admin/packages/member-1", { method: "PUT", body, headers: json })).status,
    200,
  );
  assert.deepEqual(calls[1], ["decide", "member-1", JSON.parse(body)]);

  const refusing = createAccountPackageHttpHandler(
    {
      read: async () => {
        throw new AccountAccessError(409, "TARGET_NOT_ELIGIBLE");
      },
      decide: async () => {
        throw new Error("database is away");
      },
    },
    baseURL,
  );
  const refused = await refusing(new Request(`${baseURL}/api/admin/packages/member-1`));
  assert.equal(refused.status, 409);
  assert.deepEqual(await refused.json(), { code: "TARGET_NOT_ELIGIBLE" });
  const away = await refusing(
    new Request(`${baseURL}/api/admin/packages/member-1`, { method: "PUT", body, headers: json }),
  );
  assert.equal(away.status, 503);
  assert.deepEqual(await away.json(), { code: "PACKAGE_UNAVAILABLE" });
});
