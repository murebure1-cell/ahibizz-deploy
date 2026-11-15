import assert from "node:assert/strict";
import test from "node:test";
import { createBusinessMediaPreviewApi } from "../src/components/preview/business-media-preview-api";
import {
  BusinessMediaRequestError,
  businessMediaAccessDenied,
  businessMediaActorRequest,
  businessMediaNeedsRecovery,
} from "../src/lib/business-media-client";

test("408 and network/server failures retain the exact unconfirmed media command", () => {
  for (const error of [
    new BusinessMediaRequestError(408, "TIMEOUT"),
    new BusinessMediaRequestError(503, "UNAVAILABLE"),
    new Error("network"),
  ])
    assert.equal(businessMediaNeedsRecovery({}, error), true);
});

test("an earlier unknown media result or known receipt survives a later definite denial", () => {
  for (const status of [400, 401, 403, 404, 409, 422]) {
    const error = new BusinessMediaRequestError(status, "REJECTED");
    assert.equal(businessMediaNeedsRecovery({ uncertain: true }, error), true);
    assert.equal(businessMediaNeedsRecovery({ receipt: { confirmed: true } }, error), true);
    assert.equal(businessMediaNeedsRecovery({}, error), false);
  }
});

test("media transport binds the original expected actor without replacing file/key/version", async () => {
  const file = new Blob(["fixture-bytes"], { type: "image/webp" });
  let options: RequestInit | undefined;
  await businessMediaActorRequest("owner-A", async (_path, value) => {
    options = value;
    return {};
  })("mine/business/logo/0", {
    method: "PUT",
    body: file,
    headers: { "Idempotency-Key": "same", "If-Match": '"8"', "X-AhiBizz-Account-ID": "owner-B" },
  });
  assert.equal(options?.body, file);
  assert.equal(new Headers(options?.headers).get("X-AhiBizz-Account-ID"), "owner-A");
  assert.equal(new Headers(options?.headers).get("Idempotency-Key"), "same");
  assert.equal(new Headers(options?.headers).get("If-Match"), '"8"');
});

test("missing media actor is rejected locally while current authority failures are classified", async () => {
  let called = false;
  await assert.rejects(
    businessMediaActorRequest(undefined, async () => {
      called = true;
      return {};
    })("mine/business"),
    (error) =>
      error instanceof BusinessMediaRequestError && error.code === "ACCOUNT_IDENTITY_CHANGED",
  );
  assert.equal(called, false);
  assert.equal(
    businessMediaAccessDenied(new BusinessMediaRequestError(401, "AUTHENTICATION_REQUIRED")),
    true,
  );
  assert.equal(
    businessMediaAccessDenied(new BusinessMediaRequestError(403, "ACCOUNT_SUSPENDED")),
    true,
  );
  assert.equal(
    businessMediaAccessDenied(new BusinessMediaRequestError(409, "VERSION_CONFLICT")),
    false,
  );
});

test("isolated media adapter checks the supplied actor before exposing a manifest", async () => {
  let lookedUp = false;
  const api = createBusinessMediaPreviewApi({
    expectedAccountId: "owner-A",
    readBusiness: () => {
      lookedUp = true;
      return { id: "business", version: 1, status: "draft" };
    },
    bumpBusiness: () => {
      throw Error("No write expected");
    },
  });
  await assert.rejects(
    api.request("mine/business", { headers: { "X-AhiBizz-Account-ID": "owner-B" } }),
    (error) => error instanceof BusinessMediaRequestError && error.status === 401,
  );
  assert.equal(lookedUp, false);
  assert.ok(
    (await api.request("mine/business", { headers: { "X-AhiBizz-Account-ID": "owner-A" } }))
      .manifest,
  );
  api.dispose();
});
