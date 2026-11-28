import assert from "node:assert/strict";
import test from "node:test";
import {
  describeUserAgent,
  listMySessions,
  readMyLogins,
  revokeMySession,
  unlinkMyGoogle,
} from "../src/server/auth/my-logins";
import type { AuthService } from "../src/server/auth/service";

type Calls = { revoked: unknown[]; unlinked: unknown[] };

function fakeAuth(options: { providers?: string[]; signedIn?: boolean } = {}) {
  const calls: Calls = { revoked: [], unlinked: [] };
  const api = {
    getSession: async () =>
      options.signedIn === false ? null : { user: { id: "u1" }, session: { id: "s-current" } },
    listSessions: async () => [
      {
        id: "s-old",
        token: "secret-old",
        userAgent: "Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/131.0 Safari/537.36 Edg/131.0",
        updatedAt: new Date("2026-11-20T10:00:00Z"),
      },
      {
        id: "s-current",
        token: "secret-current",
        userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/131.0 Mobile Safari/537.36",
        updatedAt: new Date("2026-11-27T09:00:00Z"),
      },
    ],
    revokeSession: async (input: unknown) => {
      calls.revoked.push(input);
    },
    revokeOtherSessions: async () => {},
    listUserAccounts: async () =>
      (options.providers ?? ["credential", "google"]).map((providerId) => ({
        id: `a-${providerId}`,
        providerId,
      })),
    unlinkAccount: async (input: unknown) => {
      calls.unlinked.push(input);
    },
  };
  return { auth: { api } as unknown as AuthService, calls };
}

test("a user agent becomes a short device and browser name", () => {
  assert.deepEqual(
    describeUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) AppleWebKit Version/18.0 Safari/604.1",
    ),
    { device: "iPhone", browser: "Safari" },
  );
  assert.deepEqual(describeUserAgent("Mozilla/5.0 (Windows NT 10.0) Chrome/131.0 Edg/131.0"), {
    device: "Windows",
    browser: "Edge",
  });
  assert.deepEqual(describeUserAgent("AhiBizz/1.0.0 (Android)"), {
    device: "Android",
    browser: "AhiBizz",
  });
  assert.deepEqual(describeUserAgent(undefined), { device: "", browser: "" });
});

test("sessions are listed without tokens, this device first", async () => {
  const { auth } = fakeAuth();
  const list = await listMySessions(auth, new Headers());
  assert.equal(list[0]?.id, "s-current");
  assert.equal(list[0]?.current, true);
  assert.equal(list[1]?.device, "Windows");
  assert.ok(list.every((entry) => !("token" in entry)));
});

test("signing out another session looks its token up on the server", async () => {
  const { auth, calls } = fakeAuth();
  await revokeMySession(auth, new Headers(), "s-old");
  assert.deepEqual(calls.revoked, [{ headers: new Headers(), body: { token: "secret-old" } }]);
  await assert.rejects(revokeMySession(auth, new Headers(), "s-current"), {
    code: "CURRENT_SESSION",
  });
  await assert.rejects(revokeMySession(auth, new Headers(), "missing"), {
    code: "SESSION_NOT_FOUND",
  });
  await assert.rejects(revokeMySession(auth, new Headers(), "../x"), { code: "INVALID_SESSION" });
});

test("signed-out callers are refused", async () => {
  const { auth } = fakeAuth({ signedIn: false });
  await assert.rejects(listMySessions(auth, new Headers()), { code: "SIGNED_OUT" });
});

test("Google is detached only while a password remains", async () => {
  const both = fakeAuth();
  assert.deepEqual(await readMyLogins(both.auth, new Headers()), { google: true, password: true });
  await unlinkMyGoogle(both.auth, new Headers());
  assert.deepEqual(both.calls.unlinked, [
    { headers: new Headers(), body: { accountId: "a-google" } },
  ]);
  const googleOnly = fakeAuth({ providers: ["google"] });
  await assert.rejects(unlinkMyGoogle(googleOnly.auth, new Headers()), {
    code: "PASSWORD_REQUIRED",
  });
  assert.equal(googleOnly.calls.unlinked.length, 0);
  const passwordOnly = fakeAuth({ providers: ["credential"] });
  await assert.rejects(unlinkMyGoogle(passwordOnly.auth, new Headers()), {
    code: "GOOGLE_NOT_LINKED",
  });
});
