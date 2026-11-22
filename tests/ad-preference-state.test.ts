import assert from "node:assert/strict";
import test from "node:test";
import { createAdPreferenceEpoch, readAdPreference } from "../src/lib/ad-preference";

test("ad preference accepts only the documented saved choice", () => {
  for (const gender of [null, "women", "men"]) assert.equal(readAdPreference({ gender }), gender);
  for (const value of [null, {}, [], { gender: "unknown" }, { gender: undefined }])
    assert.throws(() => readAdPreference(value));
});

test("a pre-save read and a reopened panel cannot overwrite the saved choice", () => {
  const state = createAdPreferenceEpoch();
  const initialRead = state.read();
  assert.notEqual(initialRead, null);
  const save = state.write();
  assert.notEqual(save, null);
  assert.equal(state.acceptsRead(initialRead as number), false);
  assert.equal(state.read(), null, "closing and reopening must wait for the pending save");
  state.endRead(initialRead as number);
  assert.equal(state.acceptsWrite(save as number), true);
  assert.equal(state.endWrite(save as number), true);
  const confirmedRead = state.read();
  assert.equal(state.acceptsRead(initialRead as number), false);
  assert.equal(state.acceptsRead(confirmedRead as number), true);
});

test("duplicate save and callbacks from an old account cannot change the new state", () => {
  const state = createAdPreferenceEpoch();
  const save = state.write();
  assert.equal(state.write(), null);
  state.clear();
  assert.equal(state.acceptsWrite(save as number), false);
  assert.equal(state.endWrite(save as number), false);
  const fresh = state.read();
  assert.equal(state.acceptsRead(fresh as number), true);
  state.endRead(fresh as number);
  assert.equal(state.acceptsRead(fresh as number), false);
});
