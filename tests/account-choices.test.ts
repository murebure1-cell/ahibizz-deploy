import assert from "node:assert/strict";
import test from "node:test";
import { readAccountChoices } from "../src/lib/account-choices";
import { readChoiceChange } from "../src/server/account-choices";
import { readExportParts } from "../src/server/account-export";

test("a choice change takes only known keys with true or false", () => {
  assert.deepEqual(readChoiceChange({ showCity: false }), { showCity: false });
  assert.deepEqual(readChoiceChange({ pushMessages: true, pushReels: false }), {
    pushMessages: true,
    pushReels: false,
  });
  for (const bad of [null, [], {}, { showCity: "no" }, { email: true }, { showCity: 1 }])
    assert.throws(() => readChoiceChange(bad), { status: 400, code: "INVALID_REQUEST" });
});

test("choices from the server must all be true or false", () => {
  const all = {
    showCity: true,
    showFriendCount: false,
    pushMessages: true,
    pushBookings: true,
    pushReels: false,
  };
  assert.deepEqual(readAccountChoices({ ...all, extra: 1 }), all);
  assert.throws(() => readAccountChoices({ ...all, pushReels: null }));
});

test("the export takes each known part once", () => {
  assert.deepEqual(readExportParts("profil,poruke"), ["profile", "messages"]);
  assert.deepEqual(readExportParts("reels"), ["reels"]);
  for (const bad of [null, "", "profil,profil", "lozinke", "profil,"])
    assert.throws(() => readExportParts(bad), { status: 400, code: "INVALID_EXPORT_PARTS" });
});
