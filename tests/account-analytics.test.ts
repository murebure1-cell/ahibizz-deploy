import assert from "node:assert/strict";
import test from "node:test";
import { analyticsPath } from "../src/lib/account-analytics";
import { readAnalyticsInput } from "../src/server/account-analytics";

const id = "11111111-1111-4111-8111-111111111111";

test("analytics take one business, a known period and an optional export", () => {
  assert.deepEqual(readAnalyticsInput(new URLSearchParams()), {
    business: null,
    days: 30,
    csv: false,
  });
  assert.deepEqual(readAnalyticsInput(new URLSearchParams(`djelatnost=${id}&dana=7&izvoz=csv`)), {
    business: id,
    days: 7,
    csv: true,
  });
  for (const bad of ["dana=14", "djelatnost=x", "izvoz=pdf", "dana=7&dana=30", "korisnik=a"])
    assert.throws(() => readAnalyticsInput(new URLSearchParams(bad)), {
      status: 400,
      code: "INVALID_ANALYTICS_QUERY",
    });
});

test("the analytics address keeps the default period out", () => {
  assert.equal(analyticsPath(null, 30), "/nalog/analitika");
  assert.equal(analyticsPath(id, 7), `/nalog/analitika?djelatnost=${id}&dana=7`);
});
