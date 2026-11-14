import assert from "node:assert/strict";
import test from "node:test";
import { type BookingStatus, bookingIsUpcoming } from "../src/lib/booking";
import { BookingAccessError, mineInput } from "../src/server/booking/validation";

test("current and history views partition every status at the exact end instant", () => {
  const asOf = Date.parse("2030-01-21T12:45:00.000Z");
  for (const status of [
    "requested",
    "confirmed",
    "cancelled",
    "declined",
    "completed",
  ] as BookingStatus[]) {
    for (const milliseconds of [-1, 0, 1]) {
      const entry = { status, endsAt: new Date(asOf + milliseconds).toISOString() };
      const current = bookingIsUpcoming(entry, asOf);
      assert.equal(current, ["requested", "confirmed"].includes(status) && milliseconds > 0);
      assert.equal(Number(current) + Number(!current), 1);
    }
  }
  assert.equal(
    bookingIsUpcoming({ status: "confirmed", endsAt: "2030-01-21T13:45:00Z" }, asOf),
    true,
    "An appointment already in progress stays current until its end.",
  );
});

test("private appointment queries accept only bounded pages and the two explicit views", () => {
  assert.deepEqual(mineInput(), { page: 1, view: undefined });
  assert.deepEqual(mineInput({ page: 500, view: "history" }), { page: 500, view: "history" });
  assert.deepEqual(mineInput({ view: "upcoming" }), { page: 1, view: "upcoming" });
  for (const invalid of [
    { view: "all" },
    { view: "UPCOMING" },
    { view: null },
    { view: "" },
    { page: 0, view: "upcoming" },
    { page: 501 },
    { page: 1.5 },
    { page: "1" },
    { customerId: "someone-else" },
    [],
  ]) {
    assert.throws(
      () => mineInput(invalid),
      (failure) => failure instanceof BookingAccessError && failure.status === 400,
    );
  }
});
