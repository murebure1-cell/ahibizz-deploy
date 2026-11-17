import assert from "node:assert/strict";
import test from "node:test";
import { createAccountAuthorityBoundary } from "../src/lib/account-authority";
import { AccountSettingsError } from "../src/lib/account-settings";

const account = {
  id: "fixture-account-a",
  name: "Privatni nalog",
  email: "account@example.invalid",
  emailVerified: true,
  role: "member",
  approval: "approved",
  locale: "bs",
  appearance: "system",
} as const;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("SSR eligibility does not add an account read until a browser boundary", async () => {
  let reads = 0;
  const gate = createAccountAuthorityBoundary({
    accountId: account.id,
    request: async (options) => {
      reads++;
      assert.equal(new Headers(options?.headers).get("X-AhiBizz-Account-ID"), account.id);
      assert.equal(options?.method, undefined);
      assert.equal(options?.body, undefined);
      return { account };
    },
    changed: () => {},
  });
  await gate.revalidate();
  assert.equal(reads, 0);
  assert.equal(gate.state().visible, true);
  gate.conceal();
  assert.equal(gate.state().visible, false);
  await gate.revalidate();
  assert.equal(reads, 1);
  assert.equal(gate.state().visible, true);
  await gate.revalidate();
  assert.equal(reads, 1);
  gate.dispose();
});

test("focus/pageshow checks coalesce and never dispatch a business command", async () => {
  const reply = deferred<unknown>();
  let reads = 0;
  const unsent = { draft: "Ne poslati ovaj tekst", command: { key: "same-original-key" } };
  const gate = createAccountAuthorityBoundary({
    accountId: account.id,
    request: async () => {
      reads++;
      return reply.promise;
    },
    changed: () => {},
  });
  gate.conceal();
  const first = gate.revalidate();
  await gate.revalidate();
  assert.equal(reads, 1);
  assert.equal(gate.state().checking, true);
  reply.resolve({ account });
  await first;
  assert.equal(gate.state().visible, true);
  assert.deepEqual(unsent, {
    draft: "Ne poslati ovaj tekst",
    command: { key: "same-original-key" },
  });
  gate.dispose();
});

test("a different signed account and an ineligible same account remain concealed", async () => {
  for (const replacement of [
    { ...account, id: "fixture-account-b" },
    { ...account, approval: "suspended" },
    { ...account, approval: "pending" },
    { ...account, emailVerified: false },
  ]) {
    const gate = createAccountAuthorityBoundary({
      accountId: account.id,
      request: async () => ({ account: replacement }),
      changed: () => {},
    });
    gate.conceal();
    await gate.revalidate();
    assert.equal(gate.state().visible, false);
    assert.equal(gate.state().denied, true);
    gate.dispose();
  }
});

test("a same-account role change requires a new server-rendered workspace", async () => {
  let confirmations = 0;
  for (const [expected, actual] of [
    ["member", "owner"],
    ["owner", "member"],
  ] as const) {
    const gate = createAccountAuthorityBoundary({
      accountId: account.id,
      expectedRole: expected,
      request: async () => ({ account: { ...account, role: actual } }),
      changed: () => {},
      confirmed: () => confirmations++,
    });
    gate.conceal();
    await gate.revalidate();
    assert.equal(gate.state().visible, false);
    assert.equal(gate.state().denied, true);
    assert.equal(confirmations, 0);
    gate.dispose();
  }
});

test("a new browser boundary inside confirmation cannot reveal the old response", async () => {
  const gate = createAccountAuthorityBoundary({
    accountId: account.id,
    request: async () => ({ account }),
    changed: () => {},
    confirmed: () => gate.conceal(),
  });
  gate.conceal();
  await gate.revalidate();
  assert.equal(gate.state().visible, false);
  assert.equal(gate.state().checking, false);
  gate.dispose();
});

test("A to B to A late successes and denials cannot replace the newest authority", async () => {
  const oldA = deferred<unknown>(),
    oldB = deferred<unknown>();
  const replies = [oldA.promise, oldB.promise, Promise.resolve({ account })];
  const signals: AbortSignal[] = [];
  let confirmed = 0;
  const gate = createAccountAuthorityBoundary({
    accountId: account.id,
    request: async (options) => {
      signals.push(options?.signal as AbortSignal);
      return replies.shift();
    },
    changed: () => {},
    confirmed: () => confirmed++,
  });
  gate.conceal();
  const first = gate.revalidate();
  gate.conceal();
  const second = gate.revalidate();
  gate.conceal();
  await gate.revalidate();
  assert.equal(gate.state().visible, true);
  assert.equal(confirmed, 1);
  oldB.reject(new AccountSettingsError(401, "ACCOUNT_IDENTITY_CHANGED"));
  await second;
  oldA.resolve({ account });
  await first;
  assert.equal(gate.state().visible, true);
  assert.equal(gate.state().denied, false);
  assert.equal(confirmed, 1);
  assert.equal(signals[0]?.aborted, true);
  assert.equal(signals[1]?.aborted, true);
  gate.dispose();
});

test("an old success cannot reveal the page after a newer actor is denied", async () => {
  const oldA = deferred<unknown>();
  let reads = 0;
  const gate = createAccountAuthorityBoundary({
    accountId: account.id,
    request: async () => {
      if (reads++ === 0) return oldA.promise;
      throw new AccountSettingsError(403, "ACCOUNT_SUSPENDED");
    },
    changed: () => {},
  });
  gate.conceal();
  const first = gate.revalidate();
  gate.conceal();
  await gate.revalidate();
  oldA.resolve({ account });
  await first;
  assert.equal(gate.state().visible, false);
  assert.equal(gate.state().denied, true);
  gate.dispose();
});

test("a timeout is fail closed even if a transport ignores cancellation", async () => {
  const reply = deferred<unknown>();
  let signal: AbortSignal | null = null;
  const gate = createAccountAuthorityBoundary({
    accountId: account.id,
    request: async (options) => {
      signal = options?.signal as AbortSignal;
      return reply.promise;
    },
    changed: () => {},
    timeoutMs: 1,
  });
  gate.conceal();
  const read = gate.revalidate();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(gate.state().visible, false);
  assert.equal(gate.state().unavailable, true);
  assert.equal((signal as AbortSignal | null)?.aborted, true);
  reply.resolve({ account });
  await read;
  assert.equal(gate.state().visible, false);
  gate.dispose();
});

test("malformed responses and network errors never expose a private page", async () => {
  for (const result of [
    null,
    {},
    { account, extra: "untrusted" },
    { account: { ...account, role: "admin" } },
  ]) {
    const gate = createAccountAuthorityBoundary({
      accountId: account.id,
      request: async () => result,
      changed: () => {},
    });
    gate.conceal();
    await gate.revalidate();
    assert.equal(gate.state().visible, false);
    assert.equal(gate.state().unavailable, true);
    gate.dispose();
  }
});

test("disposing a boundary makes a late reply inert", async () => {
  const reply = deferred<unknown>();
  let changed = 0;
  const gate = createAccountAuthorityBoundary({
    accountId: account.id,
    request: async () => reply.promise,
    changed: () => changed++,
  });
  gate.conceal();
  const read = gate.revalidate();
  gate.dispose();
  const before = changed;
  reply.resolve({ account });
  await read;
  assert.equal(changed, before);
  assert.equal(gate.state().visible, false);
});
