import assert from "node:assert/strict";
import test from "node:test";
import {
  noStayChoice,
  stayChoose,
  stayDay,
  stayNightTaken,
  stayRangeFree,
} from "../src/lib/stay-request";

// Taken: the nights of the 5th and the 6th (the guest leaves on the 7th), and the night of the 20th.
const taken = [
  { checkIn: "2026-12-05", checkOut: "2026-12-07" },
  { checkIn: "2026-12-20", checkOut: "2026-12-21" },
];
const today = "2026-12-02";

test("a night is taken from its arrival up to the morning of departure", () => {
  assert.equal(stayNightTaken(taken, "2026-12-04"), false);
  assert.equal(stayNightTaken(taken, "2026-12-05"), true);
  assert.equal(stayNightTaken(taken, "2026-12-06"), true);
  assert.equal(stayNightTaken(taken, "2026-12-07"), false);
  assert.equal(stayRangeFree(taken, "2026-12-03", "2026-12-05"), true);
  assert.equal(stayRangeFree(taken, "2026-12-03", "2026-12-06"), false);
  assert.equal(stayRangeFree(taken, "2026-12-07", "2026-12-20"), true);
  assert.equal(stayRangeFree(taken, "2026-12-07", "2026-12-21"), false);
  assert.equal(stayRangeFree([], "2026-12-01", "2026-12-31"), true);
});

test("the first tap chooses the arrival and the second the departure", () => {
  const arrived = stayChoose(noStayChoice, "2026-12-12", taken, today);
  assert.deepEqual(arrived, { arrival: "2026-12-12", departure: "", choosingEnd: true });
  const stay = stayChoose(arrived, "2026-12-14", taken, today);
  assert.deepEqual(stay, { arrival: "2026-12-12", departure: "2026-12-14", choosingEnd: false });
  // A third tap starts over.
  assert.deepEqual(stayChoose(stay, "2026-12-16", taken, today), {
    arrival: "2026-12-16",
    departure: "",
    choosingEnd: true,
  });
});

test("a stay may end on the morning a taken night begins, but not run through it", () => {
  const arrived = stayChoose(noStayChoice, "2026-12-03", taken, today);
  // Leaving on the 5th is fine: the next guest arrives that day.
  assert.equal(stayChoose(arrived, "2026-12-05", taken, today).departure, "2026-12-05");
  // The 6th is taken and cannot close a stay that began on the 3rd.
  assert.deepEqual(stayChoose(arrived, "2026-12-06", taken, today), arrived);
  // A free day past the taken nights starts a new stay rather than one across them.
  assert.deepEqual(stayChoose(arrived, "2026-12-08", taken, today), {
    arrival: "2026-12-08",
    departure: "",
    choosingEnd: true,
  });
});

test("days before today and taken nights cannot start a stay", () => {
  assert.deepEqual(stayChoose(noStayChoice, "2026-12-01", taken, today), noStayChoice);
  assert.deepEqual(stayChoose(noStayChoice, "2026-12-05", taken, today), noStayChoice);
  assert.deepEqual(stayChoose(noStayChoice, "9999-12-31", [], today), noStayChoice);
  // A departure before the arrival is a new arrival.
  const arrived = stayChoose(noStayChoice, "2026-12-14", taken, today);
  assert.equal(stayChoose(arrived, "2026-12-12", taken, today).arrival, "2026-12-12");
});

test("each day says whether it is taken, chosen or in between, and whether it can be pressed", () => {
  const stay = { arrival: "2026-12-12", departure: "2026-12-14", choosingEnd: false };
  assert.deepEqual(stayDay(stay, "2026-12-12", taken, today), {
    taken: false,
    role: "arrival",
    disabled: false,
  });
  assert.equal(stayDay(stay, "2026-12-13", taken, today).role, "between");
  assert.equal(stayDay(stay, "2026-12-14", taken, today).role, "departure");
  assert.equal(stayDay(stay, "2026-12-15", taken, today).role, null);
  assert.deepEqual(stayDay(stay, "2026-12-05", taken, today), {
    taken: true,
    role: null,
    disabled: true,
  });
  assert.equal(stayDay(stay, "2026-12-01", taken, today).disabled, true);
  // While a departure is awaited, the first taken morning after the arrival can be pressed.
  const arrived = { arrival: "2026-12-03", departure: "", choosingEnd: true };
  assert.equal(stayDay(arrived, "2026-12-05", taken, today).disabled, false);
  assert.equal(stayDay(arrived, "2026-12-06", taken, today).disabled, true);
});
