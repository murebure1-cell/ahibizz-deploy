import assert from "node:assert/strict";
import test from "node:test";
import type { OwnershipSnapshot } from "../src/lib/business-ownership";
import {
  createBusinessOwnershipApi,
  readOwnershipSnapshot,
} from "../src/lib/business-ownership-client";
import {
  forgetOwnershipIntent,
  ownershipIntentState,
  readOwnershipIntent,
  retainOwnershipIntent,
} from "../src/lib/business-ownership-recovery";

const id = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const currentOwner = { id: "admin-a", name: "Administrator", email: "admin@example.test" };
const target = { id: "owner-b", name: "Novi vlasnik", email: "owner@example.test" };
const initial = {
  business: { id, ownerId: currentOwner.id, title: "Djelatnost", version: 3, status: "published" },
  currentOwner,
  receipt: null,
} as OwnershipSnapshot;
const intent = {
  previousOwnerId: currentOwner.id,
  command: {
    expectedVersion: 3,
    targetAccountId: target.id,
    targetEmail: target.email,
    idempotencyKey: requestId,
  },
};
const receipt = {
  requestId,
  businessId: id,
  previousOwnerId: currentOwner.id,
  targetAccountId: target.id,
  previousVersion: 3,
  resultVersion: 4,
  recordedAt: "2026-11-17T18:00:00Z",
};
function memory() {
  const rows = new Map<string, string>();
  return {
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => {
      rows.set(key, value);
    },
    removeItem: (key: string) => {
      rows.delete(key);
    },
  };
}
test("ownership client pins actor and same-origin transport and keeps email out of URLs", async () => {
  let observed: { url: string; init: RequestInit } | undefined;
  const api = createBusinessOwnershipApi(async (input, init) => {
    observed = { url: String(input), init: init ?? {} };
    return Response.json({ ...initial, candidate: target });
  });
  const found = await api.lookup(id, "OWNER@example.test", currentOwner.id);
  assert.equal(found.candidate.id, target.id);
  assert.equal(observed?.url, `/api/directory/ownership/${id}/lookup`);
  assert.equal(observed?.init.body, JSON.stringify({ email: "OWNER@example.test" }));
  assert.equal(new Headers(observed?.init.headers).get("X-AhiBizz-Account-ID"), currentOwner.id);
  assert.equal(observed?.init.mode, "same-origin");
  assert.equal(observed?.init.credentials, "same-origin");
  assert.equal(observed?.init.redirect, "error");
  assert.equal(observed?.init.cache, "no-store");
  assert.ok(observed?.init.signal);
});
test("ownership lookup rejects a different email acknowledgement and private identity mismatch", async () => {
  const api = createBusinessOwnershipApi(async () =>
    Response.json({ ...initial, candidate: { ...target, email: "other@example.test" } }),
  );
  await assert.rejects(api.lookup(id, target.email, currentOwner.id), {
    code: "OWNERSHIP_UNAVAILABLE",
    status: 503,
  });
  assert.throws(() => readOwnershipSnapshot({ ...initial, currentOwner: target }, id));
  assert.throws(() =>
    readOwnershipSnapshot({ ...initial, currentOwner: { ...currentOwner, id: undefined } }, id),
  );
});
test("ownership reads retain the deadline and caller cancellation together", async () => {
  const controller = new AbortController();
  let sentSignal: AbortSignal | null | undefined;
  const api = createBusinessOwnershipApi(async (_input, init) => {
    sentSignal = init?.signal;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
  });
  const pending = api.read(id, currentOwner.id, undefined, controller.signal);
  assert.ok(sentSignal);
  assert.notEqual(sentSignal, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(sentSignal.aborted, true);
});
test("ownership receipt is historical evidence and cannot describe a future or contradictory current version", () => {
  const later = { ...initial, business: { ...initial.business, version: 5 }, receipt };
  assert.equal(readOwnershipSnapshot(later, id).currentOwner.id, currentOwner.id);
  assert.equal(ownershipIntentState(intent, later), "confirmed");
  assert.throws(() => readOwnershipSnapshot({ ...initial, receipt }, id));
  assert.throws(() =>
    readOwnershipSnapshot(
      { ...initial, business: { ...initial.business, version: 4 }, receipt },
      id,
    ),
  );
  assert.throws(() =>
    readOwnershipSnapshot({ ...later, receipt: { ...receipt, businessId: requestId } }, id),
  );
});
test("ownership unknown outcome stays gated until a matching receipt or a later business version", () => {
  assert.equal(ownershipIntentState(intent, initial), "unchanged");
  assert.equal(
    ownershipIntentState(intent, { ...initial, business: { ...initial.business, version: 4 } }),
    "superseded",
  );
  assert.equal(
    ownershipIntentState(intent, {
      ...initial,
      business: { ...initial.business, ownerId: target.id },
    }),
    "invalid",
  );
  assert.equal(
    ownershipIntentState(intent, {
      ...initial,
      receipt: { ...receipt, targetAccountId: "foreign-owner" },
    }),
    "invalid",
  );
});
test("ownership journal survives recreation and cannot cross account or business scopes", () => {
  const store = memory();
  retainOwnershipIntent(store, currentOwner.id, id, intent);
  assert.deepEqual(readOwnershipIntent(store, currentOwner.id, id), intent);
  assert.equal(readOwnershipIntent(store, target.id, id), null);
  assert.equal(readOwnershipIntent(store, currentOwner.id, requestId), null);
  assert.throws(() =>
    retainOwnershipIntent(store, currentOwner.id, id, {
      ...intent,
      command: { ...intent.command, targetEmail: "other@example.test" },
    }),
  );
  forgetOwnershipIntent(store, currentOwner.id, id, {
    ...intent,
    command: { ...intent.command, idempotencyKey: id },
  });
  assert.deepEqual(readOwnershipIntent(store, currentOwner.id, id), intent);
  forgetOwnershipIntent(store, currentOwner.id, id, intent);
  assert.equal(readOwnershipIntent(store, currentOwner.id, id), null);
});
test("ownership journal cannot claim durability on quota failure or silent failed persistence", () => {
  const silent = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  assert.throws(() => retainOwnershipIntent(silent, currentOwner.id, id, intent));
  const denied = {
    ...silent,
    setItem: () => {
      throw new Error("quota");
    },
  };
  assert.throws(() => retainOwnershipIntent(denied, currentOwner.id, id, intent), /quota/);
  const corrupt = { ...silent, getItem: () => "{broken" };
  assert.throws(() => readOwnershipIntent(corrupt, currentOwner.id, id));
});
