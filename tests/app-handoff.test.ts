import assert from "node:assert/strict";
import test from "node:test";
import { accountReturnPath } from "../src/lib/account-return";
import {
  appHandoffPagePath,
  appHandoffReturnPath,
  appReturnLink,
  readAppHandoff,
} from "../src/lib/app-handoff";
import { createAppSignInHandler, type StartAppHandoff } from "../src/server/app-sign-in-http";
import type { AuthService } from "../src/server/auth";
import { appHandoffIdentifier, pkceChallenge } from "../src/server/auth/app-handoff";
import { createAuthHttpHandler } from "../src/server/auth-http";

const baseURL = "https://fixture.invalid";
const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const state = "Zt4a9fQx2LmN8pRk";
const page = `/nalog/aplikacija?izazov=${challenge}&stanje=${state}`;

test("PKCE S256 matches RFC 7636 and stored codes are only hashes", () => {
  assert.equal(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), challenge);
  const code = "Wv3kY8n2bq0cX5mJr7tLh1sPz9dGf6aKeU4oNiQyTxM";
  const identifier = appHandoffIdentifier(code);
  assert.match(identifier, /^app-handoff:[a-f0-9]{64}$/);
  assert.ok(!identifier.includes(code));
});

test("only one written form of the confirmation page is read and survives sign-in", () => {
  assert.deepEqual(readAppHandoff(new URLSearchParams(`izazov=${challenge}&stanje=${state}`)), {
    challenge,
    state,
  });
  assert.equal(appHandoffPagePath({ challenge, state }), page);
  for (const query of [
    `izazov=${challenge}`,
    `stanje=${state}`,
    `izazov=${challenge}&izazov=${challenge}&stanje=${state}`,
    `izazov=${challenge}&stanje=${state}&stanje=${state}`,
    `izazov=${challenge.slice(1)}&stanje=${state}`,
    `izazov=${challenge}x&stanje=${state}`,
    `izazov=${challenge.replace("E", "+")}&stanje=${state}`,
    `izazov=${challenge}&stanje=short`,
    `izazov=${challenge}&stanje=${"s".repeat(65)}`,
    `izazov=${challenge}&stanje=${state}&kod=x`,
  ])
    assert.equal(readAppHandoff(new URLSearchParams(query)), null, query);
  assert.deepEqual(
    readAppHandoff(new URLSearchParams(`izazov=${challenge}&stanje=${state}&greska=1`), ["greska"]),
    { challenge, state },
  );
  assert.equal(appHandoffReturnPath(page), page);
  assert.equal(accountReturnPath(page), page);
  for (const variant of [
    `/nalog/aplikacija?stanje=${state}&izazov=${challenge}`,
    `${page}&greska=1`,
    `${page}#x`,
    `/nalog/aplikacija/?izazov=${challenge}&stanje=${state}`,
    `/nalog/aplikacija?izazov=${challenge}&stanje=${state}%20`,
    `https://fixture.invalid${page}`,
    "/nalog/aplikacija",
  ])
    assert.equal(accountReturnPath(variant), "/nalog", variant);
  assert.equal(appReturnLink("code", state), `ahibizz://povratak?kod=code&stanje=${state}`);
});

/** `origin: null` sends no Origin at all; `site` is the browser's Sec-Fetch-Site. */
function form(
  fields: [string, string][],
  init: { origin?: string | null; type?: string; site?: string } = {},
) {
  const headers = new Headers({
    "Content-Type": init.type ?? "application/x-www-form-urlencoded",
    Cookie: "session=fixture",
  });
  const origin = init.origin === undefined ? baseURL : init.origin;
  if (origin !== null) headers.set("Origin", origin);
  if (init.site) headers.set("Sec-Fetch-Site", init.site);
  return new Request(`${baseURL}/api/account/app-sign-in`, {
    method: "POST",
    headers,
    body: new URLSearchParams(fields).toString(),
  });
}

test("the confirmation form opens the app with its code and returns failures to the page", async () => {
  const calls: Parameters<StartAppHandoff>[0][] = [];
  let outcome: { code: string } | { statusCode: number } = { code: "one-time-code" };
  const http = createAppSignInHandler({
    baseURL,
    start: async (input) => {
      calls.push(input);
      if ("statusCode" in outcome) throw Object.assign(new Error("fixture"), outcome);
      return outcome;
    },
  });
  const fields: [string, string][] = [
    ["izazov", challenge],
    ["stanje", state],
    ["nalog", "account_1"],
  ];
  const opened = await http(form(fields));
  assert.equal(opened.status, 303);
  assert.equal(
    opened.headers.get("location"),
    `ahibizz://povratak?kod=one-time-code&stanje=${state}`,
  );
  assert.equal(opened.headers.get("cache-control"), "no-store");
  assert.equal(opened.headers.get("referrer-policy"), "no-referrer");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.body, { challenge, account: "account_1" });
  assert.equal(calls[0]?.headers.get("cookie"), "session=fixture");

  for (const [status, location] of [
    [401, `/prijava?nastavi=${encodeURIComponent(page)}`],
    [409, page],
    [403, page],
    [429, `${page}&greska=previse`],
    [500, `${page}&greska=1`],
  ] as const) {
    outcome = { statusCode: status };
    const response = await http(form(fields));
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), location);
  }

  // A page whose referrer policy hides its origin sends "Origin: null" (seen live on
  // 2026-11-27); the browser's Sec-Fetch-Site still says whether it came from this site.
  outcome = { code: "one-time-code" };
  for (const origin of ["null", null])
    assert.equal(
      (await http(form(fields, { origin, site: "same-origin" }))).headers.get("location"),
      `ahibizz://povratak?kod=one-time-code&stanje=${state}`,
    );
  calls.length = 0;
  for (const refused of [
    { origin: "https://untrusted.invalid" },
    { origin: "https://untrusted.invalid", site: "same-origin" },
    { origin: "null" },
    { origin: "null", site: "cross-site" },
    { origin: "null", site: "same-site" },
    { origin: null },
    { origin: null, site: "none" },
  ])
    assert.equal((await http(form(fields, refused))).status, 403, JSON.stringify(refused));
  assert.equal((await http(form(fields, { type: "application/json" }))).status, 415);
  for (const broken of [
    fields.slice(1),
    [...fields, ["nalog", "account_2"]],
    [...fields, ["kod", "x"]],
    [
      ["izazov", "short"],
      ["stanje", state],
      ["nalog", "account_1"],
    ],
    [
      ["izazov", challenge],
      ["stanje", state],
      ["nalog", "bad account"],
    ],
    [...fields, ["x", "y".repeat(3000)]],
  ] as [string, string][][])
    assert.equal((await http(form(broken))).status, 400);
  assert.equal(calls.length, 0);
});

test("over HTTP the app may only exchange a code; starting one is never routed", async () => {
  const reached: string[] = [];
  const http = createAuthHttpHandler({
    baseURL,
    auth: {
      handler: async (request: Request) => {
        reached.push(new URL(request.url).pathname);
        const headers = new Headers({ "Content-Type": "application/json" });
        headers.append("Set-Cookie", "session=app; HttpOnly; Secure; SameSite=Lax");
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
      },
    } as unknown as AuthService,
    readUser: async () => null,
  });
  const post = (path: string, body: unknown) =>
    http(
      new Request(`${baseURL}/api/auth${path}`, {
        method: "POST",
        headers: { Origin: baseURL, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  const exchanged = await post("/app-handoff/exchange", { code: "c", verifier: "v" });
  assert.equal(exchanged.status, 200);
  assert.deepEqual(await exchanged.json(), { ok: true });
  assert.equal(exchanged.headers.getSetCookie().length, 1);
  assert.equal(
    (await post("/app-handoff/exchange", { code: "c", verifier: "v", x: 1 })).status,
    400,
  );
  assert.equal((await post("/app-handoff/start", { challenge, account: "a" })).status, 404);
  assert.equal((await http(new Request(`${baseURL}/api/auth/app-handoff/exchange`))).status, 404);
  assert.deepEqual(reached, ["/api/auth/app-handoff/exchange"]);
});
