import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ReviewsAccessError, type ReviewsService } from "../src/server/reviews";
import { createReviewsHttpHandler } from "../src/server/reviews-http";

const baseURL = "https://review-fixture.invalid",
  id = "00000000-0000-4000-8000-000000000001",
  key = randomUUID();
function fixture(failure?: { method: keyof ReviewsService; status: number; code: string }) {
  const calls: string[] = [];
  const service = Object.fromEntries(
    ["authenticate", "list", "own", "save", "withdraw", "moderate", "moderationList"].map(
      (method) => [
        method,
        async () => {
          calls.push(method);
          if (failure?.method === method)
            throw new ReviewsAccessError(failure.status, failure.code);
          if (method === "list")
            return {
              items: [],
              page: 1,
              hasMore: false,
              summary: { count: 0, sum: 0 },
              email: "never",
            };
          if (method === "own")
            return { accountId: "alice", canReview: true, review: null, email: "never" };
          if (method === "moderationList")
            return { items: [], page: 1, hasMore: false, accountId: "admin" };
          return { id, version: 1 };
        },
      ],
    ),
  ) as unknown as ReviewsService;
  const http = createReviewsHttpHandler({ service, baseURL });
  return {
    calls,
    send: (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
      http(
        new Request(baseURL + path, {
          method,
          headers: { origin: baseURL, "content-type": "application/json", ...headers },
          ...(body === undefined
            ? {}
            : { body: typeof body === "string" ? body : JSON.stringify(body) }),
        }),
      ),
  };
}
const path = `/api/reviews/businesses/${id}`,
  body = { rating: 5, text: "Iskustvo", expectedVersion: 0, idempotencyKey: key };
test("public GET is anonymous and projects only documented public page", async () => {
  const f = fixture(),
    r = await f.send("GET", path);
  assert.equal(r.status, 200);
  assert.deepEqual(f.calls, ["list"]);
  assert.equal("email" in (await r.json()), false);
  assert.equal(r.headers.get("Cache-Control"), "no-store");
});
test("own GET uses real authenticated service projection", async () => {
  const f = fixture(),
    r = await f.send("GET", `${path}/own`);
  assert.equal(r.status, 200);
  assert.equal("email" in (await r.json()), false);
  assert.deepEqual(f.calls, ["own"]);
});
for (const origin of ["https://evil.invalid", "null", "https://review-fixture.invalid.evil"])
  test(`CSRF rejects ${origin} before auth or parsing`, async () => {
    const f = fixture(),
      r = await f.send("PUT", `${path}/own`, "not-json", { origin });
    assert.equal(r.status, 403);
    assert.deepEqual(f.calls, []);
  });
test("mutating body is unread before authority denies access", async () => {
  const f = fixture({ method: "authenticate", status: 401, code: "AUTHENTICATION_REQUIRED" }),
    r = await f.send("PUT", `${path}/own`, "not-json");
  assert.equal(r.status, 401);
  assert.deepEqual(f.calls, ["authenticate"]);
});
test("valid save authenticates before write, preserves receipt", async () => {
  const f = fixture(),
    r = await f.send("PUT", `${path}/own`, body);
  assert.equal(r.status, 200);
  assert.deepEqual(f.calls, ["authenticate", "save"]);
  assert.deepEqual(await r.json(), { id, version: 1 });
});
test("duplicate JSON keys cannot bypass validated review rating", async () => {
  const f = fixture(),
    r = await f.send(
      "PUT",
      `${path}/own`,
      `{"rating":1,"rating":5,"text":"a","expectedVersion":0,"idempotencyKey":"${key}"}`,
    );
  assert.equal(r.status, 400);
  assert.deepEqual(f.calls, ["authenticate"]);
});
test("request stream has bounded bytes and rejects excessive content", async () => {
  const f = fixture(),
    r = await f.send("PUT", `${path}/own`, "x".repeat(12289));
  assert.equal(r.status, 413);
  assert.deepEqual(f.calls, ["authenticate"]);
});
test("content type is mandatory", async () => {
  const f = fixture();
  assert.equal(
    (await f.send("PUT", `${path}/own`, body, { "content-type": "text/plain" })).status,
    415,
  );
});
test("routes reject extra fields, duplicate pagination, invalid ids and mutation queries", async () => {
  const f = fixture();
  assert.equal((await f.send("GET", `${path}?page=1&page=2`)).status, 400);
  assert.equal((await f.send("GET", `${path}?email=private`)).status, 400);
  assert.equal((await f.send("PUT", `${path}/own?test=1`, body)).status, 400);
  assert.equal((await f.send("PUT", `${path}/own`, { ...body, authorId: "other" })).status, 400);
  assert.equal((await f.send("GET", "/api/reviews/businesses/nope")).status, 404);
});
test("moderation requires explicit action and reason, owner authority is enforced by service", async () => {
  const f = fixture({ method: "moderate", status: 403, code: "OWNER_REQUIRED" });
  assert.equal(
    (
      await f.send("POST", `/api/reviews/admin/${id}/moderate`, {
        hidden: true,
        reason: "Neprimjereno",
        expectedVersion: 1,
        idempotencyKey: key,
      })
    ).status,
    403,
  );
  assert.deepEqual(f.calls, ["authenticate", "moderate"]);
});
test("admin list is protected service call without unexpected fields", async () => {
  const f = fixture({ method: "moderationList", status: 403, code: "OWNER_REQUIRED" });
  assert.equal((await f.send("GET", "/api/reviews/admin")).status, 403);
  assert.deepEqual(f.calls, ["moderationList"]);
});
test("CAS and idempotency failures keep explicit conflict response", async () => {
  for (const code of ["VERSION_CONFLICT", "IDEMPOTENCY_CONFLICT"]) {
    const f = fixture({ method: "save", status: 409, code });
    const r = await f.send("PUT", `${path}/own`, body);
    assert.equal(r.status, 409);
    assert.deepEqual(await r.json(), { code });
  }
});
