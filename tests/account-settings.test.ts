import assert from "node:assert/strict";
import test from "node:test";
import {
  AccountSettingsError,
  accountSettingsActorRequest,
  accountSettingsRequest,
  appearanceUpdate,
  readAccountSettings,
} from "../src/lib/account-settings";
import type { Appearance } from "../src/lib/appearance";
import { AccountAccessError, createAccountService } from "../src/server/auth/accounts";

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
    const bound = accountSettingsActorRequest(account.id);
    await bound({ method: "PATCH", body, headers: new Headers({ "X-Test": "preserved" }) });
    assert.equal(calls[0]?.input, "/api/account");
    assert.equal(calls[0]?.options?.cache, "no-store");
    assert.equal(calls[0]?.options?.credentials, "same-origin");
    assert.equal(calls[0]?.options?.body, body);
    assert.equal(new Headers(calls[0]?.options?.headers).get("content-type"), "application/json");
    assert.equal(new Headers(calls[0]?.options?.headers).get("X-Test"), "preserved");
    assert.equal(new Headers(calls[0]?.options?.headers).get("X-AhiBizz-Account-ID"), account.id);
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

test("the displayed settings actor overrides foreign headers and invalid identities never dispatch", async () => {
  const calls: RequestInit[] = [];
  const request = accountSettingsActorRequest(account.id, async (options = {}) => {
    calls.push(options);
    return { account };
  });
  const controller = new AbortController();
  await request({
    signal: controller.signal,
    headers: { "X-AhiBizz-Account-ID": "another_actor", "If-Match": '"1"' },
  });
  assert.equal(new Headers(calls[0]?.headers).get("X-AhiBizz-Account-ID"), account.id);
  assert.equal(new Headers(calls[0]?.headers).get("If-Match"), '"1"');
  assert.equal(calls[0]?.signal, controller.signal);
  for (const id of ["", "invalid actor", "../another", "x".repeat(129)])
    await assert.rejects(
      () => accountSettingsActorRequest(id, request)(),
      (error) => error instanceof AccountSettingsError && error.code === "ACCOUNT_IDENTITY_CHANGED",
    );
  assert.equal(calls.length, 1);
});

test("account identity is checked under authority locks before a same-value preference command", async () => {
  const statements: string[] = [];
  const client = {
    async query(sql: string) {
      statements.push(sql);
      if (sql.includes("FROM auth_user WHERE")) return { rows: [{ ...account, id: "member_B" }] };
      if (sql.includes("WITH locked_session")) return { rowCount: 1, rows: [{ id: "session_B" }] };
      if (sql.includes("LEFT JOIN auth_account_preferences"))
        return { rows: [{ ...account, id: "member_B" }] };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const service = createAccountService({
    auth: {
      api: {
        async getSession() {
          return {
            session: { id: "session_B", userId: "member_B", token: "fixture" },
            user: { id: "member_B" },
          };
        },
      },
    } as never,
    pool: { connect: async () => client } as never,
  });
  const headers = new Headers({ "X-AhiBizz-Account-ID": account.id });
  for (const action of [
    () => service.read(headers),
    () => service.update(headers, { appearance: "dark", expectedAppearance: "light" }),
  ]) {
    statements.length = 0;
    await assert.rejects(
      action,
      (error) =>
        error instanceof AccountAccessError &&
        error.status === 401 &&
        error.code === "ACCOUNT_IDENTITY_CHANGED",
    );
    assert.ok(
      statements.some((sql) => sql.includes("auth_user WHERE") && sql.includes("FOR UPDATE")),
    );
    assert.ok(statements.some((sql) => sql.includes("locked_session")));
    assert.equal(
      statements.some((sql) => /^(INSERT|UPDATE|DELETE)/.test(sql)),
      false,
    );
    assert.equal(statements.at(-1), "ROLLBACK");
  }
  assert.equal(
    (await service.read(new Headers())).id,
    "member_B",
    "Legacy reads remain compatible",
  );
});

test("malformed expected account headers fail before authentication or database access", async () => {
  const never = () => {
    throw new Error("Malformed actor must not dispatch");
  };
  const service = createAccountService({
    auth: { api: { getSession: never } } as never,
    pool: { connect: never } as never,
  });
  for (const id of ["", "invalid actor", "../another", "x".repeat(129)]) {
    const headers = new Headers({ "X-AhiBizz-Account-ID": id });
    await assert.rejects(
      () => service.update(headers, { appearance: "dark", expectedAppearance: "system" }),
      (error) => error instanceof AccountAccessError && error.status === 400,
    );
  }
});
