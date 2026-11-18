import assert from "node:assert/strict";
import test from "node:test";
import { dodoTestReturnPath } from "../src/lib/dodo-test-return";

test("Dodo return path retains only internal UUID, never provider email or status", () => {
  assert.equal(
    dodoTestReturnPath("00000000-0000-4000-8000-000000000001"),
    "/dodo-proba?narudzba=00000000-0000-4000-8000-000000000001",
  );
  for (const value of [
    undefined,
    "",
    "bad",
    "//evil.invalid",
    "00000000-0000-4000-8000-000000000001&email=test@example.invalid",
    "pay_fixture",
  ])
    assert.equal(dodoTestReturnPath(value), "/dodo-proba");
});
