import assert from "node:assert/strict";
import test from "node:test";
import { authReturnLinks } from "../src/lib/auth-return";
import type { AuthService } from "../src/server/auth";
import { createAuthHttpHandler } from "../src/server/auth-http";

const baseURL = "https://fixture.invalid";
function handler(reply: () => Response) {
  return createAuthHttpHandler({
    baseURL,
    auth: { handler: async () => reply() } as unknown as AuthService,
    readUser: async () => null,
  });
}

test("empty JSON-labelled email redirects keep status, location and every cookie", async () => {
  const http = handler(() => {
    const headers = new Headers({
      "Content-Type": "application/json",
      Location: `${baseURL}/nova-lozinka?token=fixture`,
    });
    headers.append("Set-Cookie", "first=one; HttpOnly; Secure; SameSite=Lax");
    headers.append("Set-Cookie", "second=two; HttpOnly; Secure; SameSite=Lax");
    return new Response(null, { status: 302, headers });
  });
  const response = await http(new Request(`${baseURL}/api/auth/reset-password/abcdefgh12345678`));
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), `${baseURL}/nova-lozinka?token=fixture`);
  assert.equal(response.headers.getSetCookie().length, 2);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(await response.text(), "");
});

test("successful POSTs remove library tokens and recompute body framing", async () => {
  const http = handler(
    () =>
      new Response(JSON.stringify({ token: "must-not-be-exposed", user: { id: "fixture" } }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Content-Length": "999" },
      }),
  );
  const response = await http(
    new Request(`${baseURL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { Origin: baseURL, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "member@fixture.invalid", password: "fixture-password" }),
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-length"), null);
  assert.deepEqual(await response.json(), { ok: true });
});

test("unknown routes, untrusted origins and injected roles never reach the auth library", async () => {
  let called = 0;
  const http = handler(() => {
    called++;
    return Response.json({ ok: true });
  });
  const post = (path: string, origin: string, body: unknown) =>
    http(
      new Request(`${baseURL}/api/auth/${path}`, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  assert.equal((await post("delete-user", baseURL, {})).status, 404);
  assert.equal((await post("sign-out", "https://other.invalid", {})).status, 403);
  assert.equal((await post("sign-up/email", baseURL, { role: "owner" })).status, 400);
  assert.equal(called, 0);
});

test("registration and resend retain the safe booking callback without altering auth fields", async () => {
  const destination = "/djelatnosti/11111111-1111-4111-8111-111111111111#business-appointments";
  const callbackURL = authReturnLinks(destination).verification;
  const received: unknown[] = [];
  const http = createAuthHttpHandler({
    baseURL,
    auth: {
      handler: async (request: Request) => {
        received.push(await request.json());
        return Response.json({ user: { id: "fixture" } });
      },
    } as unknown as AuthService,
    readUser: async () => null,
  });
  const signup = {
    name: "Fixture Member",
    email: "member@fixture.invalid",
    password: "fixture-password",
    callbackURL,
  };
  const resend = { email: signup.email, callbackURL };
  for (const [path, body] of [
    ["sign-up/email", signup],
    ["send-verification-email", resend],
  ] as const) {
    const response = await http(
      new Request(`${baseURL}/api/auth/${path}`, {
        method: "POST",
        headers: { Origin: baseURL, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  }
  assert.deepEqual(received, [signup, resend]);
  assert.equal(new URL(callbackURL, baseURL).searchParams.get("nastavi"), destination);
});

test("per-address limits answer 429 before the auth library and fail open on errors", async () => {
  let called = 0;
  const seen: [string, unknown][] = [];
  const signIn = (limitEmail: Parameters<typeof createAuthHttpHandler>[0]["limitEmail"]) =>
    createAuthHttpHandler({
      baseURL,
      auth: {
        handler: async () => {
          called++;
          return Response.json({ error: "INVALID_EMAIL_OR_PASSWORD" }, { status: 401 });
        },
      } as unknown as AuthService,
      readUser: async () => null,
      limitEmail,
    })(
      new Request(`${baseURL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { Origin: baseURL, "Content-Type": "application/json" },
        body: JSON.stringify({ email: "Member@Fixture.invalid", password: "fixture-password" }),
      }),
    );
  const limited = await signIn(async (path, email) => {
    seen.push([path, email]);
    return { allowed: false, retryAfter: 42 };
  });
  assert.equal(limited.status, 429);
  assert.deepEqual(await limited.json(), { code: "RATE_LIMITED" });
  assert.equal(limited.headers.get("retry-after"), "42");
  assert.equal(limited.headers.get("x-retry-after"), "42");
  assert.equal(limited.headers.get("cache-control"), "no-store");
  assert.equal(called, 0);
  assert.deepEqual(seen, [["/sign-in/email", "Member@Fixture.invalid"]]);
  const allowed = await signIn(async () => ({ allowed: true }));
  assert.equal(allowed.status, 401);
  assert.equal(called, 1);
  const broken = await signIn(async () => {
    throw new Error("database unavailable");
  });
  assert.equal(broken.status, 401);
  assert.equal(called, 2);
});
