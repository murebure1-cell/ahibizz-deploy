import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  createReviewsAdminApi,
  createReviewsApi,
  ReviewsClientError,
  readPublicReview,
  readReviewSummary,
} from "../src/lib/reviews";
import { businessReviewsProjection } from "../src/server/reviews/projection";
import { commandInput, ReviewsAccessError } from "../src/server/reviews/validation";

const id = "00000000-0000-4000-8000-000000000001",
  key = randomUUID();
const review = {
  id,
  rating: 5,
  text: "Odlična usluga.",
  createdAt: "2026-11-17T10:00:00.000Z",
  updatedAt: "2026-11-17T10:00:00.000Z",
  author: { id: null, name: "PRIVATE NAME", photoVersion: 3, email: "private@fixture.invalid" },
  email: "must-not-leak",
};
const input = { rating: 5, text: "  Iskustvo.  ", expectedVersion: 0, idempotencyKey: key };
test("review validates bounded plain text, rating and strict command fields", () => {
  assert.equal(commandInput(input, "save").text, "Iskustvo.");
  for (const value of [
    { ...input, rating: 0 },
    { ...input, rating: 6 },
    { ...input, rating: 1.5 },
    { ...input, text: "" },
    { ...input, text: "a".repeat(2001) },
    { ...input, text: "<script>" },
    { ...input, text: "abc\u202e" },
    { ...input, authorId: "other" },
    { ...input, expectedVersion: -1 },
    { ...input, idempotencyKey: "x" },
  ])
    assert.throws(() => commandInput(value, "save"), ReviewsAccessError);
});
test("withdraw and moderation demand positive CAS version and bounded reason", () => {
  assert.throws(() => commandInput({ expectedVersion: 0, idempotencyKey: key }, "withdraw"));
  for (const reason of ["", "x".repeat(501), "<b>why</b>"])
    assert.throws(() =>
      commandInput({ hidden: true, reason, expectedVersion: 1, idempotencyKey: key }, "moderate"),
    );
  assert.equal(
    commandInput(
      { hidden: false, reason: "Provjereno", expectedVersion: 1, idempotencyKey: key },
      "moderate",
    ).hidden,
    false,
  );
});
test("private author projection discards private identity, photo and unexpected fields", () => {
  const value = readPublicReview(review);
  assert.deepEqual(value.author, { id: null, name: "Korisnik AhiBizza", photoVersion: null });
  assert.equal(JSON.stringify(value).includes("PRIVATE"), false);
  assert.equal("email" in value, false);
});
test("public author projection whitelists opt-in person id and name", () => {
  assert.deepEqual(
    readPublicReview({
      ...review,
      author: { id: "public-person", name: "Javno ime", photoVersion: 2, email: "never" },
    }).author,
    { id: "public-person", name: "Javno ime", photoVersion: 2 },
  );
});
test("summary accepts real count/sum and rejects impossible or coerced aggregates", () => {
  assert.deepEqual(readReviewSummary({ count: 0, sum: 0, average: 5 }), { count: 0, sum: 0 });
  assert.deepEqual(readReviewSummary({ count: 3, sum: 12 }), { count: 3, sum: 12 });
  for (const value of [
    { count: 0, sum: 1 },
    { count: 2, sum: 1 },
    { count: 2, sum: 11 },
    { count: "1", sum: 5 },
    { count: 1, sum: 1.5 },
  ])
    assert.throws(() => readReviewSummary(value));
});
test("shared SQL projection excludes withdrawn, hidden and current self ownership", () => {
  const sql = businessReviewsProjection("business");
  assert.match(sql, /business\.id/);
  assert.match(sql, /NOT r.withdrawn AND NOT r.hidden/);
  assert.match(sql, /r.author_user_id<>business.owner_user_id/);
  assert.match(sql, /approval='approved'/);
  assert.match(sql, /emailVerified/);
  assert.throws(() => businessReviewsProjection("b; DROP TABLE"));
});
test("real fetch adapter sends same-origin actor-bound CAS and preserves command keys", async () => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const api = createReviewsApi((async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({ id, version: 1, secret: "never" });
  }) as typeof fetch);
  assert.deepEqual(await api.save(id, input, "alice"), { id, version: 1 });
  await api.save(id, input, "alice");
  assert.equal(calls[0]?.url, `/api/reviews/businesses/${id}/own`);
  assert.equal(calls[0]?.init?.credentials, "same-origin");
  assert.equal(calls[0]?.init?.cache, "no-store");
  assert.equal(new Headers(calls[0]?.init?.headers).get("X-AhiBizz-Account-ID"), "alice");
  assert.equal(calls[0]?.init?.body, calls[1]?.init?.body);
});
test("real fetch adapter parses public list and own data without email leakage", async () => {
  const api = createReviewsApi((async (url) =>
    Response.json(
      String(url).endsWith("/own")
        ? { accountId: "alice", canReview: true, review: null, email: "never" }
        : {
            items: [review],
            page: 1,
            hasMore: false,
            summary: { count: 1, sum: 5 },
            ownerEmail: "never",
          },
    )) as typeof fetch);
  assert.equal((await api.list(id)).items[0]?.author.name, "Korisnik AhiBizza");
  assert.deepEqual(await api.own(id), { accountId: "alice", canReview: true, review: null });
});
test("real fetch adapter transports withdrawal separately and rejects HTTP failures", async () => {
  let init: RequestInit | undefined;
  const api = createReviewsApi((async (_, options) => {
    init = options;
    return Response.json({ code: "VERSION_CONFLICT" }, { status: 409 });
  }) as typeof fetch);
  await assert.rejects(
    api.withdraw(id, { expectedVersion: 1, idempotencyKey: key }, "alice"),
    (e: unknown) => e instanceof ReviewsClientError && e.code === "VERSION_CONFLICT",
  );
  assert.equal(init?.method, "POST");
});
test("admin adapter preserves reason, version, actor, and never changes score", async () => {
  const calls: { url: string; body: unknown }[] = [];
  const api = createReviewsAdminApi((async (url, options) => {
    calls.push({ url: String(url), body: options?.body ? JSON.parse(String(options.body)) : null });
    return Response.json({ id, version: 2 });
  }) as typeof fetch);
  await api.moderate(
    id,
    { hidden: true, reason: "Neprimjeren sadržaj", expectedVersion: 1, idempotencyKey: key },
    "admin",
  );
  assert.match(calls[0]?.url ?? "", /\/moderate$/);
  assert.equal("rating" in ((calls[0]?.body ?? {}) as object), false);
});
test("admin GET binds the displayed actor before dispatch and forwards cancellation", async () => {
  let observed: RequestInit | undefined;
  const api = createReviewsAdminApi((async (_, init) => {
    observed = init;
    return Response.json({ items: [], page: 1, hasMore: false, accountId: "admin" });
  }) as typeof fetch);
  const controller = new AbortController();
  await api.list(1, "admin", controller.signal);
  assert.equal(new Headers(observed?.headers).get("X-AhiBizz-Account-ID"), "admin");
  assert.equal(observed?.signal, controller.signal);
  assert.equal(observed?.cache, "no-store");
});
