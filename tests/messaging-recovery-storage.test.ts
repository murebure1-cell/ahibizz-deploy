import assert from "node:assert/strict";
import test from "node:test";
import {
  type MessagingIntent,
  MessagingRecoveryStore,
  MessagingStorageError,
} from "../src/lib/messaging-recovery-storage";

class DeviceStorage {
  values = new Map<string, string>();
  failWrite = false;
  failRead = false;
  failRemove = false;
  ignoreWrite = false;
  get length() {
    return this.values.size;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  getItem(key: string) {
    if (this.failRead) throw Error("denied");
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrite) throw Error("quota");
    if (!this.ignoreWrite) this.values.set(key, value);
  }
  removeItem(key: string) {
    if (this.failRemove) throw Error("unavailable");
    this.values.delete(key);
  }
}
const keyA = "10000000-0000-4000-8000-000000000001";
const keyB = "20000000-0000-4000-8000-000000000002";
const receipt = { threadId: "thread_A", messageId: "message_A", sequence: 1 };
const send = (key = keyA): MessagingIntent => ({
  action: "send",
  path: "threads/thread_A/messages",
  body: { body: "Moj tekst" },
  key,
  threadId: "thread_A",
});
function setup() {
  const device = new DeviceStorage();
  const clock = { now: 1800000000000 };
  const store = new MessagingRecoveryStore(
    () => device,
    "actor_A",
    "test",
    () => clock.now,
  );
  return { device, clock, store };
}

test("draft and selected conversation survive a new store instance", () => {
  const { device, clock, store } = setup();
  store.saveDraft("thread_A", "personal", "  Moj tekst\n ");
  store.saveSelection("thread_A", "personal");
  const reopened = new MessagingRecoveryStore(
    () => device,
    "actor_A",
    "test",
    () => clock.now,
  );
  assert.equal(reopened.readDraft("thread_A", "personal"), "  Moj tekst\n ");
  assert.deepEqual(reopened.readSelection(), { threadId: "thread_A", inbox: "personal" });
});
test("account, inbox, thread and fixture namespaces are isolated", () => {
  const { device, clock, store } = setup();
  store.saveDraft("thread_A", "personal", "Lično");
  store.saveDraft("thread_A", "business", "Poslovno");
  store.saveDraft("thread_B", "personal", "Drugi razgovor");
  assert.equal(store.readDraft("thread_A", "personal"), "Lično");
  assert.equal(store.readDraft("thread_A", "business"), "Poslovno");
  assert.equal(store.readDraft("thread_B", "personal"), "Drugi razgovor");
  assert.equal(
    new MessagingRecoveryStore(
      () => device,
      "actor_B",
      "test",
      () => clock.now,
    ).readDraft("thread_A", "personal"),
    "",
  );
  assert.equal(
    new MessagingRecoveryStore(
      () => device,
      "actor_A",
      "live",
      () => clock.now,
    ).readDraft("thread_A", "personal"),
    "",
  );
});
test("multiple edits in the same clock tick preserve the latest text", () => {
  const { store } = setup();
  for (const text of ["Prvo", "Drugo", "Treće", ""]) store.saveDraft("thread_A", "personal", text);
  assert.equal(store.readDraft("thread_A", "personal"), "");
});
test("two windows sending one saved revision share exactly one idempotency key", () => {
  const { store, device, clock } = setup();
  const revision = store.saveDraft("thread_A", "personal", "Moj tekst");
  const other = new MessagingRecoveryStore(
    () => device,
    "actor_A",
    "test",
    () => clock.now,
  );
  assert.equal(other.readDraftState("thread_A", "personal").key, revision);
  const intent = { ...send(revision), draftRevision: revision };
  store.savePending(intent, "personal");
  other.savePending(intent, "personal");
  assert.equal(
    [...device.values.keys()].filter((key) => key.startsWith(`${store.prefix}pending.`)).length,
    1,
  );
  assert.equal(store.readPending()?.intent.draftRevision, revision);
  other.completePending(revision, receipt);
  assert.deepEqual(store.savePending(intent, "personal").receipt, receipt);
});
test("an old stable revision cannot capture a newly typed identical draft", () => {
  const { store } = setup();
  const old = store.saveDraft("thread_A", "personal", "Moj tekst");
  const current = store.saveDraft("thread_A", "personal", "Moj tekst");
  assert.notEqual(old, current);
  store.savePending({ ...send(old), draftRevision: old }, "personal");
  assert.equal(store.clearSentDraft("thread_A", "personal", "Moj tekst", old), "Moj tekst");
  assert.equal(store.readDraftState("thread_A", "personal").key, current);
});
test("dispatched command body and key survive closing before a response", () => {
  const { device, clock, store } = setup();
  store.saveDraft("thread_A", "personal", "Moj tekst");
  store.savePending(send(), "personal");
  const reopened = new MessagingRecoveryStore(
    () => device,
    "actor_A",
    "test",
    () => clock.now,
  );
  assert.deepEqual(reopened.readPending(), {
    inbox: "personal",
    intent: { ...send(), uncertain: true },
  });
});
test("received receipt survives close and a stale same-command write", () => {
  const { store } = setup();
  store.savePending(send(), "personal");
  store.savePending({ ...send(), receipt }, "personal");
  store.savePending(send(), "personal");
  assert.deepEqual(store.readPending()?.intent.receipt, receipt);
});
test("independent windows cannot overwrite distinct unknown commands", () => {
  const { device, clock, store } = setup();
  const other = new MessagingRecoveryStore(
    () => device,
    "actor_A",
    "test",
    () => clock.now,
  );
  store.savePending(send(), "personal");
  other.savePending(send(keyB), "personal");
  assert.equal(store.readPending()?.intent.key, keyA);
  store.clearPending(keyA);
  assert.equal(store.readPending()?.intent.key, keyB);
});
test("same command cannot change body or target", () => {
  const { store } = setup();
  store.savePending(send(), "personal");
  assert.throws(() => store.savePending({ ...send(), body: { body: "Drugo" } }, "personal"));
  assert.throws(() =>
    store.savePending({ ...send(), path: "https://external.invalid/send" }, "personal"),
  );
  assert.equal(store.readPending()?.intent.body.body, "Moj tekst");
});
test("a confirmed send clears its captured revision before recovery is removed", () => {
  const { store } = setup();
  store.saveDraft("thread_A", "personal", "  Moj tekst ");
  store.savePending(send(), "personal");
  store.savePending({ ...send(), receipt }, "personal");
  assert.equal(store.clearSentDraft("thread_A", "personal", "Moj tekst", keyA), "");
  assert.ok(store.readPending()?.intent.receipt);
  store.clearPending(keyA);
  assert.equal(store.readPending(), null);
  assert.equal(store.readDraft("thread_A", "personal"), "");
});
test("send confirmation preserves a newer draft from a second tab", () => {
  const { device, clock, store } = setup();
  store.saveDraft("thread_A", "personal", "Moj tekst");
  store.savePending(send(), "personal");
  clock.now++;
  const other = new MessagingRecoveryStore(
    () => device,
    "actor_A",
    "test",
    () => clock.now,
  );
  other.saveDraft("thread_A", "personal", "Novi nacrt");
  store.savePending({ ...send(), receipt }, "personal");
  assert.equal(store.clearSentDraft("thread_A", "personal", "Moj tekst", keyA), "Novi nacrt");
  store.clearPending(keyA);
  assert.equal(other.readDraft("thread_A", "personal"), "Novi nacrt");
});
test("a newer identical-text revision is also preserved", () => {
  const { device, clock, store } = setup();
  store.saveDraft("thread_A", "personal", "Moj tekst");
  store.savePending(send(), "personal");
  clock.now++;
  new MessagingRecoveryStore(
    () => device,
    "actor_A",
    "test",
    () => clock.now,
  ).saveDraft("thread_A", "personal", "Moj tekst");
  assert.equal(store.clearSentDraft("thread_A", "personal", "Moj tekst", keyA), "Moj tekst");
});
test("late acknowledgement after another window completes cannot recapture a new draft", () => {
  const { store, device, clock } = setup();
  store.saveDraft("thread_A", "personal", "Moj tekst");
  store.savePending(send(), "personal");
  const other = new MessagingRecoveryStore(
    () => device,
    "actor_A",
    "test",
    () => clock.now,
  );
  other.savePending({ ...send(), receipt }, "personal");
  other.clearSentDraft("thread_A", "personal", "Moj tekst", keyA);
  other.completePending(keyA, receipt);
  clock.now++;
  other.saveDraft("thread_A", "personal", "Moj tekst");
  const restored = store.savePending({ ...send(), receipt }, "personal");
  assert.deepEqual(restored.receipt, receipt);
  assert.equal(store.readPending(), null);
  assert.equal(store.clearSentDraft("thread_A", "personal", "Moj tekst", keyA), "Moj tekst");
});
test("a completed key is read-only recovery even when reopened without its receipt", () => {
  const { store } = setup();
  store.savePending({ ...send(), receipt }, "personal");
  store.completePending(keyA, receipt);
  assert.deepEqual(store.savePending(send(), "personal").receipt, receipt);
  assert.equal(store.readPending(), null);
});
test("corrupt completion receipt cannot erase or trap the original command", () => {
  const { store, device, clock } = setup();
  store.saveDraft("thread_A", "personal", "Moj tekst");
  store.savePending(send(), "personal");
  const invalidDone = () =>
    device.values.set(
      `${store.prefix}done.${keyA}`,
      JSON.stringify({ v: 1, at: clock.now, value: { ...receipt, threadId: "thread_B" } }),
    );
  invalidDone();
  assert.equal(store.savePending(send(), "personal").receipt, undefined);
  assert.equal(store.readPending()?.intent.key, keyA);
  invalidDone();
  assert.equal(store.clearSentDraft("thread_A", "personal", "Moj tekst", keyA), "");
  assert.equal(store.readPending()?.intent.key, keyA);
});
test("confirmation cannot clear a different thread or inbox", () => {
  const { store } = setup();
  store.saveDraft("thread_A", "personal", "Moj tekst");
  store.saveDraft("thread_A", "business", "Poslovno");
  store.saveDraft("thread_B", "personal", "Drugo");
  store.savePending(send(), "personal");
  assert.throws(() => store.clearSentDraft("thread_B", "personal", "Moj tekst", keyA));
  assert.throws(() => store.clearSentDraft("thread_A", "business", "Moj tekst", keyA));
  assert.equal(store.readDraft("thread_A", "business"), "Poslovno");
  assert.equal(store.readDraft("thread_B", "personal"), "Drugo");
});
test("quota failure and silently dropped writes cannot acknowledge persistence", () => {
  const { store, device } = setup();
  device.failWrite = true;
  assert.throws(() => store.savePending(send(), "personal"), MessagingStorageError);
  device.failWrite = false;
  device.ignoreWrite = true;
  assert.throws(() => store.savePending(send(), "personal"), MessagingStorageError);
  assert.equal(store.readPending(), null);
});
test("denied storage access is distinguished from missing drafts", () => {
  const { store, device } = setup();
  store.saveDraft("thread_A", "personal", "Moj tekst");
  store.savePending(send(), "personal");
  device.failRead = true;
  assert.throws(() => store.readDraft("thread_A", "personal"), MessagingStorageError);
  assert.throws(() => store.readPending(), MessagingStorageError);
});
test("cleanup failure retains the original recovery command", () => {
  const { store, device } = setup();
  store.saveDraft("thread_A", "personal", "Moj tekst");
  store.savePending({ ...send(), receipt }, "personal");
  device.failRemove = true;
  assert.throws(
    () => store.clearSentDraft("thread_A", "personal", "Moj tekst", keyA),
    MessagingStorageError,
  );
  device.failRemove = false;
  assert.equal(store.readPending()?.intent.key, keyA);
  assert.equal(store.readDraft("thread_A", "personal"), "Moj tekst");
});
test("expired draft revisions and journals are not restored", () => {
  const { store, clock } = setup();
  store.saveDraft("thread_A", "personal", "Moj tekst");
  store.saveSelection("thread_A", "personal");
  store.savePending(send(), "personal");
  clock.now += 31 * 24 * 60 * 60 * 1000;
  assert.equal(store.readDraft("thread_A", "personal"), "");
  assert.equal(store.readSelection(), null);
  assert.equal(store.readPending(), null);
});
test("malformed JSON and unknown versions are discarded without replay", () => {
  const { store, device, clock } = setup();
  device.values.set(`${store.prefix}pending.${keyA}`, "{");
  device.values.set(
    `${store.prefix}selection`,
    JSON.stringify({ v: 2, at: clock.now, value: { threadId: "thread_A", inbox: "personal" } }),
  );
  assert.equal(store.readPending(), null);
  assert.equal(store.readSelection(), null);
  store.savePending(send(), "personal");
  assert.equal(store.readPending()?.intent.key, keyA);
});
test("persisted external URLs, oversized text and mismatched receipts are rejected", () => {
  const { store, device, clock } = setup();
  const put = (intent: unknown) =>
    device.values.set(
      `${store.prefix}pending.${keyA}`,
      JSON.stringify({ v: 1, at: clock.now, value: { inbox: "personal", intent } }),
    );
  for (const value of [
    { ...send(), path: "https://external.invalid" },
    { ...send(), body: { body: "x".repeat(2001) } },
    { ...send(), receipt: { ...receipt, threadId: "thread_B" } },
    { ...send(), key: keyB },
  ]) {
    put(value);
    assert.equal(store.readPending(), null);
  }
});
test("corrupt separate receipt cannot erase a valid unknown command", () => {
  const { store, device, clock } = setup();
  store.savePending(send(), "personal");
  device.values.set(
    `${store.prefix}receipt.${keyA}`,
    JSON.stringify({ v: 1, at: clock.now, value: { ...receipt, threadId: "thread_B" } }),
  );
  assert.equal(store.readPending()?.intent.key, keyA);
  assert.equal(store.readPending()?.intent.receipt, undefined);
});
test("a temporary read failure for the separate receipt cannot erase its command", () => {
  const { store, device } = setup();
  store.savePending(send(), "personal");
  const read = device.getItem.bind(device);
  device.getItem = (key) => {
    if (key === `${store.prefix}receipt.${keyA}`) throw Error("temporarily denied");
    return read(key);
  };
  assert.throws(() => store.readPending(), MessagingStorageError);
  assert.ok(device.values.has(`${store.prefix}pending.${keyA}`));
});
test("draft text and scoped identifiers are bounded", () => {
  const { store } = setup();
  assert.throws(
    () => store.saveDraft("thread_A", "personal", "x".repeat(2001)),
    MessagingStorageError,
  );
  assert.throws(() => store.saveDraft("../foreign", "personal", "x"), MessagingStorageError);
  assert.throws(() => new MessagingRecoveryStore(() => new DeviceStorage(), "bad.actor"));
  assert.throws(() => new MessagingRecoveryStore(() => new DeviceStorage(), "actor_A", "../live"));
});
test("an oversized command envelope is refused before acknowledging durable dispatch", () => {
  const { store, device, clock } = setup();
  for (let index = 0; index < 500; index++)
    device.values.set(
      `${store.prefix}draft.personal.thread_A.${crypto.randomUUID()}`,
      JSON.stringify({ v: 1, at: clock.now, value: { text: "Moj tekst", time: clock.now } }),
    );
  assert.throws(() => store.savePending(send(), "personal"), MessagingStorageError);
});
test("expired drafts are pruned before the 100 conversation limit", () => {
  const { store, clock } = setup();
  for (let index = 0; index < 100; index++) store.saveDraft(`thread_${index}`, "personal", "Tekst");
  assert.throws(() => store.saveDraft("thread_101", "personal", "Novi"), MessagingStorageError);
  clock.now += 31 * 24 * 60 * 60 * 1000;
  assert.doesNotThrow(() => store.saveDraft("thread_101", "personal", "Novi"));
  assert.equal(store.readDraft("thread_101", "personal"), "Novi");
});
test("authorized recovery incrementally sweeps old receipts without removing current recovery", () => {
  const { store, device, clock } = setup();
  const expiredAt = clock.now - 31 * 24 * 60 * 60 * 1000;
  for (let index = 0; index < 130; index++)
    device.values.set(
      `${store.prefix}done.${crypto.randomUUID()}`,
      JSON.stringify({ v: 1, at: expiredAt, value: receipt }),
    );
  device.values.set(
    `${store.prefix}receipt.old`,
    JSON.stringify({ v: 1, at: expiredAt, value: receipt }),
  );
  device.values.set(`${store.prefix}done.corrupt`, "{");
  device.values.set(
    `${store.prefix}receipt.corrupt`,
    JSON.stringify({ v: 1, at: clock.now, value: { threadId: "not-a-receipt" } }),
  );
  const foreign = "ahibizz.messaging.v1.test.actor_B.done.untouched";
  device.values.set(foreign, JSON.stringify({ v: 1, at: expiredAt, value: receipt }));
  store.savePending({ ...send(), receipt }, "personal");
  const initial = [...device.values.keys()].filter((key) =>
    key.startsWith(`${store.prefix}done.`),
  ).length;
  assert.equal(store.readPending()?.intent.key, keyA);
  const afterFirst = [...device.values.keys()].filter((key) =>
    key.startsWith(`${store.prefix}done.`),
  ).length;
  assert.equal(initial - afterFirst, 64);
  store.readPending();
  assert.equal(
    [...device.values.keys()].filter((key) => key.startsWith(`${store.prefix}done.`)).length,
    afterFirst,
  );
  for (let batch = 0; batch < 3; batch++) {
    clock.now += 60001;
    store.readPending();
  }
  assert.equal(
    [...device.values.keys()].filter((key) => key.startsWith(`${store.prefix}done.`)).length,
    0,
  );
  assert.equal(device.values.has(`${store.prefix}receipt.old`), false);
  assert.equal(device.values.has(`${store.prefix}receipt.corrupt`), false);
  assert.ok(device.values.has(`${store.prefix}receipt.${keyA}`));
  assert.deepEqual(store.readPending()?.intent.receipt, receipt);
  assert.ok(device.values.has(foreign));
});
test("explicit logout clears only this actor and namespace", () => {
  const { store, device, clock } = setup();
  const other = new MessagingRecoveryStore(
    () => device,
    "actor_B",
    "test",
    () => clock.now,
  );
  const live = new MessagingRecoveryStore(
    () => device,
    "actor_A",
    "live",
    () => clock.now,
  );
  store.saveDraft("thread_A", "personal", "Privatno");
  store.savePending(send(), "personal");
  other.saveDraft("thread_A", "personal", "Drugi nalog");
  live.saveDraft("thread_A", "personal", "Drugi prostor");
  store.clear();
  assert.equal(store.readDraft("thread_A", "personal"), "");
  assert.equal(store.readPending(), null);
  assert.equal(other.readDraft("thread_A", "personal"), "Drugi nalog");
  assert.equal(live.readDraft("thread_A", "personal"), "Drugi prostor");
  assert.ok(device.getItem(store.logoutKey));
});
test("open and block command recovery is validated without broadening transport", () => {
  const { store } = setup();
  store.savePending(
    {
      action: "open",
      path: "threads",
      body: { kind: "person", targetId: "peer_A" },
      key: keyA,
      threadId: null,
    },
    "personal",
  );
  assert.deepEqual(store.readPending()?.intent.target, { kind: "person", targetId: "peer_A" });
  store.clearPending(keyA);
  store.savePending(
    {
      action: "block",
      path: "threads/thread_A/block",
      body: { blocked: true },
      key: keyB,
      threadId: "thread_A",
    },
    "personal",
  );
  assert.equal(store.readPending()?.intent.body.blocked, true);
});
