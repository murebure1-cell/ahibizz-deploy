import assert from "node:assert/strict";
import test from "node:test";
import { stayNights, stayQuote } from "../src/lib/stays";
import { interval, unitInput } from "../src/server/stays/validation";

test("accommodation quotes count local nights at month, leap-year and daylight-saving boundaries", () => {
  for (const [arrival, departure] of [
    ["2028-02-28", "2028-03-01"],
    ["2027-03-27", "2027-03-29"],
    ["2027-10-30", "2027-11-01"],
    ["2027-12-31", "2028-01-02"],
  ] as const) {
    assert.equal(stayNights(arrival, departure), 2);
    assert.equal(stayQuote(7550, arrival, departure), 15100);
    assert.deepEqual(interval(arrival, departure), { checkIn: arrival, checkOut: departure });
  }
  for (const invalid of ["2027-02-29", "2027-04-31", "0000-01-01", "2027-03-28T00:00Z"]) {
    assert.throws(() => interval(invalid, "2028-01-01"), { code: "INVALID_STAY_INTERVAL" });
  }
  assert.throws(() => interval("2028-04-01", "2028-04-01"), { code: "INVALID_STAY_INTERVAL" });
});

test("accommodation unit inputs preserve photo order and reject duplicate or out-of-range slots", () => {
  const input = {
    expectedVersion: 0,
    name: "Apartman",
    type: "apartment",
    beds: 3,
    enabled: true,
    priceMinor: 12000,
    photoSlots: [3, 1],
  };
  assert.deepEqual(unitInput(input).photoSlots, [3, 1]);
  for (const photoSlots of [[1, 1], [9], [0], ["1"]]) {
    assert.throws(() => unitInput({ ...input, photoSlots }), { code: "INVALID_STAY_PHOTO" });
  }
});
