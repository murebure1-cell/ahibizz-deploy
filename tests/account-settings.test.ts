import assert from "node:assert/strict";
import test from "node:test";
import {
  AccountSettingsError,
  accountSettingsRequest,
  appearanceUpdate,
  readAccountSettings,
} from "../src/lib/account-settings";
import type { Appearance } from "../src/lib/appearance";
import { createAccountService } from "../src/server/auth/accounts";

const account = {
  id: "member_1",
  name: "Probni član",
  email: "clan@example.invalid",
  emailVerified: true,
  role: "member",
  approval: "approved",
  locale: "bs",
  appearance: "light",
} as const;

test("settings accepts only the signed eligible actor and a matching save acknowledgement", () => {
  assert.deepEqual(readAccountSettings({ account }, account.id), account);
  assert.deepEqual(readAccountSettings({ account }, account.id, "light"), account);
  for (const value of [
    { account, privateToken: "hidden" },
    { account: { ...account, appearance: "unexpected" } },
    { account: { ...account, role: "administrator" } },
    { account: { ...account, session: "hidden" } },
    { account: null },
    {},
    null,
    [],
  ])
    assert.throws(() => readAccountSettings(value, account.id), AccountSettingsError);
  assert.throws(
    () => readAccountSettings({ account }, "another_actor"),
    (failure) => failure instanceof AccountSettingsError && failure.status === 401,
  );
  for (const changes of [
    { approval: "suspended" },
    { approval: "pending" },
    { emailVerified: false },
  ])
    assert.throws(
      () => readAccountSettings({ account: { ...account, ...changes } }, account.id),
      (failure) => failure instanceof AccountSettingsError && failure.status === 403,
    );
  assert.throws(() => readAccountSettings({ account }, account.id, "dark"), AccountSettingsError);
});

test("a preference command is scoped to appearance and the displayed saved value", () => {
  assert.deepEqual(appearanceUpdate("dark", "system"), {
    appearance: "dark",
    expectedAppearance: "system",
  });
  for (const value of ["unknown", null, [], undefined]) {
    assert.throws(() => appearanceUpdate(value as Appearance, "system"), AccountSettingsError);
    assert.throws(() => appearanceUpdate("light", value as Appearance), AccountSettingsError);
  }
});

test("malformed appearance expectations fail before account authority or database access", async () => {
  const never = () => {
    throw new Error("No authentication or database access is expected");
  };
  const service = createAccountService({
    auth: { api: { getSession: never } } as never,
    pool: { connect: never } as never,
  });
  for (const input of [
    { expectedAppearance: "system" },
    { appearance: "dark", expectedAppearance: "auto" },
    { appearance: "dark", expectedAppearance: null },
    { appearance: "dark", expectedAppearance: "system", role: "owner" },
  ])
    await assert.rejects(
      () => service.update(new Headers(), input),
      (failure) => failure instanceof Error && "status" in failure && failure.status === 400,
    );
});

test("settings transport uses no-store same-origin and reports rejected or malformed receipts", async () => {
  const original = globalThis.fetch;
  const calls: { input: RequestInfo | URL; options?: RequestInit }[] = [];
  try {
    globalThis.fetch = async (input, options) => {
      calls.push({ input, options });
      return Response.json({ account });
    };
    const body = JSON.stringify(appearanceUpdate("dark", "light"));
    await accountSettingsRequest({ method: "PATCH", body });
    assert.equal(calls[0]?.input, "/api/account");
    assert.equal(calls[0]?.options?.cache, "no-store");
    assert.equal(calls[0]?.options?.credentials, "same-origin");
    assert.equal(calls[0]?.options?.body, body);
    assert.equal(new Headers(calls[0]?.options?.headers).get("content-type"), "application/json");
    globalThis.fetch = async () => Response.json({ code: "APPEARANCE_CONFLICT" }, { status: 409 });
    await assert.rejects(
      () => accountSettingsRequest({ method: "PATCH", body }),
      (failure) =>
        failure instanceof AccountSettingsError && failure.code === "APPEARANCE_CONFLICT",
    );
    globalThis.fetch = async () => new Response("invalid", { status: 200 });
    await assert.rejects(
      () => accountSettingsRequest(),
      (failure) => failure instanceof AccountSettingsError && failure.status === 503,
    );
  } finally {
    globalThis.fetch = original;
  }
});
