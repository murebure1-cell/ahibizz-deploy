import assert from "node:assert/strict";
import test from "node:test";
import { minimumAppVersion, olderThan } from "../src/lib/app-version";

test("an app is too old only when its version is below the minimum", () => {
  assert.equal(olderThan("1.0.0", "1.0.0"), false);
  assert.equal(olderThan("1.0.9", "1.1.0"), true);
  assert.equal(olderThan("1.10.0", "1.9.0"), false);
  assert.equal(olderThan("0.9", "1.0.0"), true);
  assert.equal(olderThan("2", "1.9.9"), false);
  assert.equal(olderThan("abc", "1.0.0"), false);
  assert.equal(olderThan("1.0.0", ""), false);
  assert.match(minimumAppVersion, /^\d+\.\d+\.\d+$/);
});
