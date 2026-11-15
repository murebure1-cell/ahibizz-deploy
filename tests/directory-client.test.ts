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
