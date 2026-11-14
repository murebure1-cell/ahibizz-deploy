import assert from "node:assert/strict";
import test from "node:test";
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
