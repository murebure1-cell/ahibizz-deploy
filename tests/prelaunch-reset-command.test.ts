import assert from "node:assert/strict";
import test from "node:test";
import { describePlan, readArguments } from "../scripts/prelaunch-reset.mjs";

const digest = "c".repeat(64);

test("the operator command accepts only plan, or apply with the digest of a shown plan", () => {
  assert.deepEqual(readArguments(["plan"]), { command: "plan" });
  assert.deepEqual(readArguments(["apply", "--confirm", digest]), { command: "apply", digest });
  for (const argv of [
    [],
    ["apply"],
    ["apply", "--confirm"],
    ["apply", "--confirm", "yes"],
    ["apply", "--confirm", digest.toUpperCase()],
    ["apply", "--force", digest],
    ["plan", "--confirm", digest],
    ["apply", "--confirm", digest, "extra"],
  ])
    assert.throws(() => readArguments(argv), /reset_arguments_invalid/);
});

test("the shown plan names who stays, what goes and hides empty tables behind a count", () => {
  assert.deepEqual(
    describePlan({
      owners: [{ id: "owner-1", email: "owner@fixture.invalid" }],
      accounts: 3,
      businesses: 2,
      tables: [
        { name: "business_favorite", rows: 1 },
        { name: "directory_business", rows: 2 },
        { name: "message_thread", rows: 0 },
      ],
      blockers: [],
      kept: ["owner-1"],
      digest,
    }),
    {
      stays: ["owner@fixture.invalid"],
      accounts: 3,
      businesses: 2,
      rows: [
        { name: "business_favorite", rows: 1 },
        { name: "directory_business", rows: 2 },
      ],
      emptyTables: 1,
      blockers: [],
      digest,
    },
  );
});
