import { strict as assert } from "node:assert";
import test from "node:test";
import { localInstant } from "../src/lib/booking-time";
import { rentalQuote } from "../src/lib/rentals";
import { interval } from "../src/server/rentals/validation";

test("rental prices use elapsed hours and started 24-hour units across Sarajevo clock changes", () => {
  const local = (day: string, hour: number) => {
    const time = localInstant(day, hour * 60, "Europe/Sarajevo");
    assert.ok(time);
    return time;
  };
  const spring = [local("2027-03-27", 12), local("2027-03-28", 12)] as const;
  const autumn = [local("2027-10-30", 12), local("2027-10-31", 12)] as const;
  assert.equal(rentalQuote(100, "hour", ...spring), 2300);
  assert.equal(rentalQuote(100, "day", ...spring), 100);
  assert.equal(rentalQuote(100, "hour", ...autumn), 2500);
  assert.equal(rentalQuote(100, "day", ...autumn), 200);
  assert.equal(localInstant("2027-03-28", 150, "Europe/Sarajevo"), null);
  assert.equal(localInstant("2027-10-31", 150, "Europe/Sarajevo"), null);
});

test("rental requests require real UTC minutes and strictly later return; a calendar window is bounded independently", () => {
  const end = "2028-03-01T11:01:00.000Z";
  assert.deepEqual(interval("2028-02-29T11:01Z", end), {
    startsAt: "2028-02-29T11:01:00.000Z",
    endsAt: end,
  });
  for (const invalid of [
    "2027-02-29T11:01Z",
    "2028-02-29T24:00Z",
    "0000-01-01T00:00Z",
    "2028-02-29T11:01:08Z",
    "2028-02-29T11:01",
  ]) {
    assert.throws(() => interval(invalid, end), { code: "INVALID_RENTAL_INTERVAL" });
  }
  assert.throws(() => interval(end, end), { code: "INVALID_RENTAL_INTERVAL" });
  assert.throws(() => interval(end, "2028-02-29T11:01Z"), { code: "INVALID_RENTAL_INTERVAL" });
  assert.throws(() => interval(end, "2030-03-01T11:01Z", true), {
    code: "INVALID_RENTAL_INTERVAL",
  });
  assert.equal(interval(end, "2030-03-01T11:01Z").endsAt, "2030-03-01T11:01:00.000Z");
});
