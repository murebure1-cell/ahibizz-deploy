import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  clearFavoriteIntent,
  type FavoriteIntent,
  readFavoriteIntent,
  writeFavoriteIntent,
} from "../src/lib/favorite-recovery";

function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
const actor = "fixture-a",
  id = randomUUID(),
  intent: FavoriteIntent = {
    accountId: actor,
    businessId: id,
    command: { saved: true, expectedVersion: 0, idempotencyKey: randomUUID() },
  };
test("favorite recovery reload keeps the original actor, desired state, version and exact command key", () => {
  const store = storage();
  assert.equal(readFavoriteIntent(store, actor, id), null);
  writeFavoriteIntent(store, intent);
  assert.deepEqual(readFavoriteIntent(store, actor, id), intent);
  assert.equal(readFavoriteIntent(store, "fixture-b", id), null);
  assert.deepEqual(writeFavoriteIntent(store, structuredClone(intent)), intent);
});
test("an uncertain favorite command cannot be replaced by a fresh intent", () => {
  const store = storage();
  writeFavoriteIntent(store, intent);
  assert.throws(() =>
    writeFavoriteIntent(store, {
      ...intent,
      command: { ...intent.command, idempotencyKey: randomUUID() },
    }),
  );
  assert.deepEqual(readFavoriteIntent(store, actor, id), intent);
});
test("late successful recovery cannot clear a newer command", () => {
  const store = storage();
  writeFavoriteIntent(store, intent);
  clearFavoriteIntent(store, intent);
  const next = {
    ...intent,
    command: { ...intent.command, saved: false, expectedVersion: 1, idempotencyKey: randomUUID() },
  };
  writeFavoriteIntent(store, next);
  clearFavoriteIntent(store, intent);
  assert.deepEqual(readFavoriteIntent(store, actor, id), next);
  clearFavoriteIntent(store, next);
  assert.equal(readFavoriteIntent(store, actor, id), null);
});
test("unavailable, failed or corrupted recovery storage fails before a dispatchable intent exists", () => {
  const denied = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {},
    removeItem: () => {},
  };
  assert.throws(() => writeFavoriteIntent(denied, intent));
  assert.throws(() => writeFavoriteIntent({ ...storage(), setItem: () => {} }, intent));
  const store = storage();
  writeFavoriteIntent(store, intent);
  const key = [...store.values.keys()][0] as string;
  for (const value of [
    "{",
    JSON.stringify({ ...intent, accountId: "another" }),
    JSON.stringify({ ...intent, command: { ...intent.command, expectedVersion: -1 } }),
    JSON.stringify({ ...intent, command: { ...intent.command, unexpected: 1 } }),
  ]) {
    store.values.set(key, value);
    assert.throws(() => readFavoriteIntent(store, actor, id));
  }
});
