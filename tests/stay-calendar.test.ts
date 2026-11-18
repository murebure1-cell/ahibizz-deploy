import assert from "node:assert/strict";
import test from "node:test";
import { addDays } from "../src/lib/booking-time";
import { lastArrivalDate, lastStayDate, stayCalendarMonth } from "../src/lib/stay-calendar";

test("the stay calendar has no next month after the last possible checkout", () => {
  assert.deepEqual(stayCalendarMonth("9999-12"), {
    first: "9999-12-01",
    end: "9999-12-31",
    next: null,
    previous: "9999-11",
    days: 31,
    weekdayOffset: 2,
  });
  assert.equal(addDays(lastArrivalDate, 1), lastStayDate);
  assert.equal(stayCalendarMonth("0001-01").previous, null);
});
test("calendar matches a leap February and the year boundary", () => {
  assert.equal(stayCalendarMonth("2028-02").days, 29);
  assert.equal(stayCalendarMonth("2027-02").days, 28);
  assert.equal(stayCalendarMonth("2026-12").end, "2027-01-01");
  assert.equal(stayCalendarMonth("2027-01").previous, "2026-12");
});
