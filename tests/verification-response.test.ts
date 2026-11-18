import assert from "node:assert/strict";
import test from "node:test";
import { readVerification } from "../src/components/admin/verification-response";

const business = {
  kind: "business",
  id: "business-a",
  identity: "person_a",
  subjectLabel: "Prva djelatnost",
  verified: false,
  version: 3,
  lastDecision: null,
};

test("verification controls reject a different target and unusable owner/profile versions", () => {
  for (const overrides of [
    { id: "business-b" },
    { kind: "person" },
    { identity: "../settings" },
    { version: -1 },
    { version: 0.5 },
    { subjectLabel: " " },
  ]) {
    assert.throws(() => readVerification({ ...business, ...overrides }, "business", business.id));
  }
});

test("manual verification displays only the selected profile's documented fields", () => {
  const lastDecision = {
    verified: false,
    reason: "Promjena vlasnika",
    at: "2026-11-18T05:00:00Z",
    actorName: null,
  };
  const expected = { ...business, lastDecision };
  const received = {
    ...expected,
    secret: "unknown",
    lastDecision: { ...lastDecision, extra: "unknown" },
  };
  assert.deepEqual(readVerification(received, "business", business.id), expected);
  assert.throws(() =>
    readVerification(
      { ...business, lastDecision: { ...lastDecision, at: "unknown" } },
      "business",
      business.id,
    ),
  );
});
