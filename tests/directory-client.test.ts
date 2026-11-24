import assert from "node:assert/strict";
import test from "node:test";
import {
  directoryAccessDenied,
  directoryActorRequest,
  directoryRequest,
} from "../src/lib/directory-client";
import { DirectoryRequestError } from "../src/lib/directory-create-submission";

test("directory requests bind the expected mounted account and preserve command headers", async () => {
  const calls: RequestInit[] = [];
  const request = directoryActorRequest("actor-A", async (_path, options = {}) => {
    calls.push(options);
    return { items: [], hasMore: false };
  });
  await request("mine?page=1", {
    headers: { "Idempotency-Key": "original-key", "X-AhiBizz-Account-ID": "actor-B" },
    body: "original-body",
    method: "POST",
  });
  assert.equal(calls.length, 1);
  assert.equal(new Headers(calls[0]?.headers).get("X-AhiBizz-Account-ID"), "actor-A");
  assert.equal(new Headers(calls[0]?.headers).get("Idempotency-Key"), "original-key");
  assert.equal(calls[0]?.body, "original-body");
});

test("a missing or malformed expected directory account fails before reaching transport", async () => {
  let calls = 0;
  for (const id of [undefined, "", "actor A", "x".repeat(129)]) {
    await assert.rejects(
      directoryActorRequest(id, async () => {
        calls++;
        return {};
      })("mine"),
      (error) =>
        error instanceof DirectoryRequestError &&
        error.status === 401 &&
        error.code === "ACCOUNT_IDENTITY_CHANGED",
    );
  }
  assert.equal(calls, 0);
});

test("directory endpoint input cannot escape the private directory path", async () => {
  const old = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw Error("must not call fetch");
  };
  try {
    for (const route of [
      "../auth",
      "mine/../admin",
      "mine?next=https://example.com",
      "mine?page=1#x",
      "//foreign.invalid",
      "mine\\admin",
      "review?status=archived",
      "review?page=1&page=2",
      "admin?page=0",
      "mine?page=501",
      "review?pageSize=1",
      "mine?status=all",
      "mine?map=missing",
      "review?map=missing",
      "admin?map=invalid",
      "admin?map=missing&map=missing",
      "admin?map=missing&status=archived",
      "admin?q=%0A",
      "admin?q=%ZZ",
      `admin?q=${"a".repeat(121)}`,
      "review/id/archive",
      "review/../admin",
      "review/id?next=mine",
    ])
      await assert.rejects(
        directoryRequest(route),
        (error) => error instanceof DirectoryRequestError && error.status === 400,
      );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = old;
  }
});

test("the real account-bound transport accepts private collection filters and encodes user text as a query value", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (url, options) => {
    calls.push(String(url));
    assert.equal(new Headers(options?.headers).get("X-AhiBizz-Account-ID"), "admin-test");
    assert.equal(options?.credentials, "same-origin");
    return Response.json({ items: [], hasMore: false });
  };
  try {
    const send = directoryActorRequest("admin-test");
    const q = "Čapljina & salon + A/B #1?";
    const paths = [
      "review",
      "review?page=1",
      "review?q=",
      "mine?page=2",
      "admin?page=1&status=archived",
      "admin?map=missing&page=2&q=Tuzla",
    ];
    for (const area of ["mine", "admin", "review"]) {
      paths.push(`${area}?${new URLSearchParams({ page: "2", pageSize: "20", q })}`);
      if (area !== "review")
        paths.push(`${area}?${new URLSearchParams({ q, status: "archived", page: "1" })}`);
    }
    for (const route of paths) {
      assert.deepEqual(await send(route), { items: [], hasMore: false });
      assert.equal(calls.at(-1), `/api/directory/${route}`);
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("draft return sends the captured actor and reason only to its private moderation endpoint", async () => {
  const old = globalThis.fetch;
  const calls: { url: string; options: RequestInit }[] = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ business: { id: "business-one", version: 2 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const body = JSON.stringify({ status: "draft", expectedVersion: 1, reason: "Dopuni kontakt" });
    await directoryActorRequest("admin-A")("review/business-one", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "/api/directory/review/business-one");
    assert.equal(calls[0]?.options.method, "PATCH");
    assert.equal(calls[0]?.options.body, body);
    assert.equal(new Headers(calls[0]?.options.headers).get("X-AhiBizz-Account-ID"), "admin-A");
    assert.equal(calls[0]?.options.credentials, "same-origin");
    assert.equal(calls[0]?.options.cache, "no-store");
    assert.equal(calls[0]?.options.redirect, "error");
  } finally {
    globalThis.fetch = old;
  }
});

test("only authentication and authorization failures clear directory private state", () => {
  assert.equal(
    directoryAccessDenied(new DirectoryRequestError("AUTHENTICATION_REQUIRED", 401)),
    true,
  );
  assert.equal(directoryAccessDenied({ status: 403 }), true);
  for (const error of [
    new DirectoryRequestError("VERSION_CONFLICT", 409),
    new Error("network"),
    null,
    undefined,
  ])
    assert.equal(directoryAccessDenied(error), false);
});
