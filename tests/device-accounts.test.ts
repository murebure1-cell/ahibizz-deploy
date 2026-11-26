import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import {
  DeviceAccountError,
  listDeviceAccounts,
  switchDeviceAccount,
} from "../src/server/auth/device-accounts";
import type { AuthService } from "../src/server/auth/service";

type Row = { id: string; name: string; emailVerified: boolean; role: string; approval: string };
const people: Record<string, Row> = {
  me: { id: "me", name: "Lični", emailVerified: true, role: "member", approval: "approved" },
  admin: {
    id: "admin",
    name: "Administracija",
    emailVerified: true,
    role: "owner",
    approval: "approved",
  },
  gone: {
    id: "gone",
    name: "Suspendovan",
    emailVerified: true,
    role: "member",
    approval: "suspended",
  },
};
const pool = {
  query: async (_sql: string, [id]: [string]) => ({
    rows: people[id] ? [{ email: `${id}@example.test`, ...people[id] }] : [],
  }),
} as unknown as Pool;

function fakeAuth(active: string | null, onDevice: string[], calls: string[] = []) {
  const cookie = (name: string) => new Response("{}", { headers: { "Set-Cookie": `${name}=1` } });
  return {
    api: {
      getSession: async () => (active ? { user: { id: active }, session: {} } : null),
      rememberDeviceSession: async () => {
        calls.push("remember");
        return cookie("remembered");
      },
      listDeviceSessions: async () =>
        onDevice.map((id) => ({ user: { id }, session: { token: `token-${id}` } })),
      setActiveSession: async ({ body }: { body: { sessionToken: string } }) => {
        calls.push(`active:${body.sessionToken}`);
        return cookie("active");
      },
    },
  } as unknown as AuthService;
}

test("the device lists its usable accounts, the active one first, without tokens", async () => {
  const { accounts, cookies } = await listDeviceAccounts(
    fakeAuth("me", ["admin", "gone", "me"]),
    pool,
    new Headers(),
  );
  assert.deepEqual(accounts, [
    { id: "me", name: "Lični", role: "member", active: true },
    { id: "admin", name: "Administracija", role: "owner", active: false },
  ]);
  assert.ok(cookies.some((value) => value.startsWith("remembered=")));
  assert.equal(JSON.stringify(accounts).includes("token"), false);
});

test("listing needs a signed-in account", async () => {
  await assert.rejects(
    listDeviceAccounts(fakeAuth(null, ["admin"]), pool, new Headers()),
    (error) => error instanceof DeviceAccountError && error.status === 401,
  );
});

test("switching remembers the current account, then activates the chosen one", async () => {
  const calls: string[] = [];
  const result = await switchDeviceAccount(
    fakeAuth("me", ["me", "admin"], calls),
    pool,
    new Headers(),
    "admin",
  );
  assert.equal(result.role, "owner");
  assert.deepEqual(calls, ["remember", "active:token-admin"]);
  assert.equal(result.cookies.length, 2);
});

test("switching refuses accounts that are not usable or not on this device", async () => {
  const auth = fakeAuth("me", ["me", "gone"]);
  for (const [target, status] of [
    ["gone", 403],
    ["admin", 404],
    ["nobody", 403],
    ["../x", 400],
    [42, 400],
  ] as const)
    await assert.rejects(
      switchDeviceAccount(auth, pool, new Headers(), target),
      (error) => error instanceof DeviceAccountError && error.status === status,
      String(target),
    );
});
