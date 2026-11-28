import assert from "node:assert/strict";
import test from "node:test";
import type { AuthService } from "../src/server/auth/service";
import { createReviewRepliesHandler } from "../src/server/review-replies-http";

const baseURL = "https://fixture.invalid";
const business = "0b6f0a52-6f0e-4a57-9d55-2f6f3b1c9a10";
const review = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";

function fixture(options: { signedIn?: boolean; owns?: boolean } = {}) {
  const saved: unknown[][] = [];
  const api = {
    getSession: async () =>
      options.signedIn === false
        ? null
        : { user: { id: "u1" }, session: { id: "s1", userId: "u1", token: "secret" } },
  };
  const http = createReviewRepliesHandler({
    auth: () => ({ api }) as unknown as AuthService,
    baseURL: () => baseURL,
    store: () => ({
      list: async (id) => [
        { reviewId: review, text: `Hvala (${id}).`, updatedAt: "2026-11-28T10:00:00.000Z" },
      ],
      save: async (actorId, reviewId, text) => {
        saved.push([actorId, reviewId, text]);
        return options.owns !== false;
      },
    }),
  });
  return { http, saved };
}

type Call = { body?: unknown; account?: string | null; origin?: string };

function call(
  http: (request: Request) => Promise<Response>,
  method: string,
  path: string,
  init: Call = {},
) {
  const headers = new Headers({ Cookie: "session=fixture" });
  const account = init.account === undefined ? "u1" : init.account;
  if (account !== null) headers.set("X-AhiBizz-Account-ID", account);
  headers.set("Origin", init.origin ?? baseURL);
  const body = init.body === undefined ? undefined : JSON.stringify(init.body);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  return http(new Request(`${baseURL}/api/review-replies/${path}`, { method, headers, body }));
}

async function refused(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), { code });
}

test("anyone reads the owner's answers under a business's reviews", async () => {
  const { http } = fixture({ signedIn: false });
  const response = await call(http, "GET", `businesses/${business}`, { account: null });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), {
    replies: [
      { reviewId: review, text: `Hvala (${business}).`, updatedAt: "2026-11-28T10:00:00.000Z" },
    ],
  });
  await refused(await call(http, "GET", "businesses/not-an-id"), 400, "INVALID_REQUEST");
  await refused(await call(http, "GET", `businesses/${business}?page=2`), 400, "INVALID_REQUEST");
  await refused(
    await call(http, "POST", `businesses/${business}`, { body: {} }),
    405,
    "METHOD_NOT_ALLOWED",
  );
  await refused(await call(http, "GET", "elsewhere"), 404, "NOT_FOUND");
});

test("the signed-in owner writes, replaces or removes an answer", async () => {
  const { http, saved } = fixture();
  const response = await call(http, "POST", `reviews/${review}`, {
    body: { text: "  Hvala, vidimo se.  " },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { saved: true });
  await call(http, "POST", `reviews/${review}`, { body: { text: "" } });
  assert.deepEqual(saved, [
    ["u1", review, "Hvala, vidimo se."],
    ["u1", review, ""],
  ]);
});

test("only a well-formed answer from this site and this account is taken", async () => {
  const { http, saved } = fixture();
  for (const body of [
    {},
    { text: 5 },
    { text: "a", extra: true },
    { body: "a" },
    { text: "a".repeat(1001) },
    ["a"],
  ])
    await refused(await call(http, "POST", `reviews/${review}`, { body }), 400, "INVALID_REQUEST");
  await refused(
    await call(http, "POST", "reviews/not-an-id", { body: { text: "a" } }),
    400,
    "INVALID_REQUEST",
  );
  await refused(await call(http, "GET", `reviews/${review}`), 405, "METHOD_NOT_ALLOWED");
  await refused(
    await call(http, "POST", `reviews/${review}`, {
      body: { text: "a" },
      origin: "https://other.invalid",
    }),
    403,
    "INVALID_ORIGIN",
  );
  await refused(
    await call(http, "POST", `reviews/${review}`, { body: { text: "a" }, account: "u2" }),
    401,
    "ACCOUNT_IDENTITY_CHANGED",
  );
  assert.equal(saved.length, 0);
  const guest = fixture({ signedIn: false });
  assert.equal(
    (await call(guest.http, "POST", `reviews/${review}`, { body: { text: "a" } })).status,
    401,
  );
  const stranger = fixture({ owns: false });
  await refused(
    await call(stranger.http, "POST", `reviews/${review}`, { body: { text: "a" } }),
    404,
    "REVIEW_NOT_FOUND",
  );
});
