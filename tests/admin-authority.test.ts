import assert from "node:assert/strict";
import test from "node:test";
import {
  AdminRequestError,
  adminAccessDenied,
  adminActorRequest,
  responseData,
} from "../src/components/admin/responses";

test("missing or malformed admin actor cannot dispatch a privileged read or mutation", async () => {
  let calls = 0;
  for (const actor of [undefined, "", "foreign/actor", "x".repeat(129)]) {
    const request = adminActorRequest(actor, async () => {
      calls++;
      return Response.json({});
    });
    for (const path of ["/api/admin/accounts?approval=pending&page=1", "/api/directory/categories"])
      await assert.rejects(
        request(path),
        (failure) =>
          failure instanceof AdminRequestError &&
          failure.status === 401 &&
          failure.code === "ACCOUNT_IDENTITY_CHANGED",
      );
  }
  assert.equal(calls, 0);
});

test("admin binding keeps original decision body and overrides a foreign actor header", async () => {
  const controller = new AbortController(),
    body = JSON.stringify({ approval: "approved", expected: "pending" });
  const original = new Headers({
    "Content-Type": "application/json",
    "X-AhiBizz-Account-ID": "owner-B",
  });
  await adminActorRequest("owner-A", async (path, init) => {
    assert.equal(path, "/api/admin/accounts/member");
    assert.equal(new Headers(init?.headers).get("X-AhiBizz-Account-ID"), "owner-A");
    assert.equal(new Headers(init?.headers).get("Content-Type"), "application/json");
    assert.equal(init?.body, body);
    assert.equal(init?.signal, controller.signal);
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.credentials, "same-origin");
    assert.equal(init?.mode, "same-origin");
    assert.equal(init?.redirect, "error");
    return Response.json({});
  })("/api/admin/accounts/member", {
    method: "PATCH",
    headers: original,
    body,
    signal: controller.signal,
    credentials: "include",
    redirect: "follow",
  });
  assert.equal(original.get("X-AhiBizz-Account-ID"), "owner-B");
});

test("privileged denial is classified before stale-read or cancellation handling", async () => {
  for (const status of [401, 403]) {
    let caught: unknown;
    try {
      await responseData(Response.json({ code: "ACCOUNT_IDENTITY_CHANGED" }, { status }));
    } catch (failure) {
      caught = failure;
    }
    assert.equal(adminAccessDenied(caught), true);
  }
  for (const failure of [
    new AdminRequestError(408),
    new AdminRequestError(409),
    new AdminRequestError(503),
    new Error("network"),
    null,
  ])
    assert.equal(adminAccessDenied(failure), false);
});
