import assert from "node:assert/strict";
import test from "node:test";
import {
  arrivalLabel,
  durationLabel,
  easeInOut,
  maneuverSign,
  metresBetween,
  pathLengths,
  pathPoint,
  pathProgress,
  pathUntil,
  readRoute,
  stepAt,
} from "../src/lib/route-progress";

// About 111 m north, then about 80 m east, at Sarajevo's latitude.
const start = { lat: 43.856, lng: 18.413 };
const corner = { lat: 43.857, lng: 18.413 };
const end = { lat: 43.857, lng: 18.414 };
const path = [start, corner, end];
const near = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance;

test("a path knows how far each of its points is from the start", () => {
  const lengths = pathLengths(path);
  assert.equal(lengths[0], 0);
  assert.ok(near(lengths[1] ?? 0, 111.2, 0.5));
  assert.ok(near(lengths[2] ?? 0, 111.2 + 80.2, 1));
  assert.ok(near(metresBetween(start, corner), 111.2, 0.5));
  assert.deepEqual(pathLengths([]), []);
});

test("the drawn part of a line grows smoothly to the whole line", () => {
  const lengths = pathLengths(path);
  assert.deepEqual(pathUntil(path, lengths, 0), [start]);
  const half = pathUntil(path, lengths, (lengths[1] ?? 0) / 2);
  assert.equal(half.length, 2);
  assert.ok(near(half[1]?.lat ?? 0, 43.8565, 1e-6));
  const turned = pathUntil(path, lengths, (lengths[1] ?? 0) + 40);
  assert.equal(turned.length, 3);
  assert.ok(near(turned[2]?.lng ?? 0, 18.4135, 2e-5));
  assert.deepEqual(pathUntil(path, lengths, 10_000), path);
  assert.deepEqual(pathUntil([], [], 5), []);
});

test("a distance along the line names one point of it", () => {
  const lengths = pathLengths(path);
  const total = lengths[lengths.length - 1] ?? 0;
  assert.deepEqual(pathPoint(path, lengths, -5), path[0]);
  assert.deepEqual(pathPoint(path, lengths, 0), path[0]);
  assert.deepEqual(pathPoint(path, lengths, total + 50), path[path.length - 1]);
  // Half way along the first stretch lies half way between its ends.
  const half = pathPoint(path, lengths, (lengths[1] ?? 0) / 2);
  const [a, b] = path;
  assert.ok(half && a && b);
  assert.ok(Math.abs(half.lat - (a.lat + b.lat) / 2) < 1e-9);
  assert.ok(Math.abs(half.lng - (a.lng + b.lng) / 2) < 1e-9);
  // It is the same point at which the drawn part of the line ends.
  const part = pathUntil(path, lengths, total * 0.7);
  assert.deepEqual(pathPoint(path, lengths, total * 0.7), part[part.length - 1]);
  assert.equal(pathPoint([], [], 10), null);
});

test("a person beside the route is put on its nearest point", () => {
  const lengths = pathLengths(path);
  // Ten metres east of the middle of the first stretch.
  const beside = pathProgress(path, lengths, { lat: 43.8565, lng: 18.413125 });
  assert.ok(beside);
  assert.ok(near(beside.along, 55.6, 1));
  assert.ok(near(beside.off, 10, 1));
  assert.ok(near(beside.point.lng, 18.413, 1e-6));
  // Past the corner the nearest point is on the second stretch.
  const later = pathProgress(path, lengths, { lat: 43.85705, lng: 18.4136 });
  assert.ok(later && later.along > (lengths[1] ?? 0));
  // At the end, the whole length is behind.
  const last = pathProgress(path, lengths, end);
  assert.ok(last && near(last.along, lengths[2] ?? 0, 0.5) && last.off < 0.5);
  assert.equal(pathProgress([], [], start), null);
});

test("the step in hand follows the distance walked", () => {
  const steps = [
    { instruction: "Kreni na sjever", maneuver: "DEPART", metres: 110 },
    { instruction: "Skreni desno", maneuver: "TURN_RIGHT", metres: 80 },
  ];
  assert.deepEqual(stepAt(steps, 0), { index: 0, toNext: 110 });
  assert.deepEqual(stepAt(steps, 100), { index: 0, toNext: 10 });
  assert.deepEqual(stepAt(steps, 110), { index: 1, toNext: 80 });
  assert.deepEqual(stepAt(steps, 500), { index: 1, toNext: 0 });
  assert.equal(stepAt([], 10), null);
});

test("a turn gets an arrow, and an unknown turn means keep going", () => {
  assert.equal(maneuverSign("TURN_LEFT"), "left");
  assert.equal(maneuverSign("turn_slight_right"), "right");
  assert.equal(maneuverSign("ROUNDABOUT_LEFT"), "left");
  assert.equal(maneuverSign("STRAIGHT"), "straight");
  assert.equal(maneuverSign(""), "straight");
  assert.equal(maneuverSign("SOMETHING_NEW"), "straight");
});

test("Google's answer becomes a route only when it has a line", () => {
  const route = readRoute({
    path: [
      { lat: 43.856, lng: 18.413, altitude: 0 },
      { lat: () => 43.857, lng: () => 18.413 },
      { lat: 200, lng: 18 },
      "junk",
    ],
    distanceMeters: 111,
    durationMillis: 84_000,
    legs: [
      {
        steps: [
          { instructions: " Kreni na sjever ", maneuver: "DEPART", distanceMeters: 111 },
          { instructions: "", maneuver: "TURN_LEFT", distanceMeters: 5 },
          { instructions: "Bez dužine", distanceMeters: "x" },
        ],
      },
      null,
    ],
  });
  assert.deepEqual(route, {
    path: [
      { lat: 43.856, lng: 18.413 },
      { lat: 43.857, lng: 18.413 },
    ],
    metres: 111,
    seconds: 84,
    steps: [{ instruction: "Kreni na sjever", maneuver: "DEPART", metres: 111 }],
  });
  // Without Google's own length the line is measured.
  const measured = readRoute({ path });
  assert.ok(measured && near(measured.metres, 191.4, 1.5) && measured.seconds === 0);
  for (const bad of [null, "x", {}, { path: [] }, { path: [{ lat: 1, lng: 1 }] }])
    assert.equal(readRoute(bad), null);
});

test("an instruction Google broke into lines reads as sentences on one", () => {
  const route = readRoute({
    path,
    legs: [
      {
        steps: [
          {
            instructions: "Blago nadesno na Ferhadija\nOdredište će biti s desne strane.\n",
            maneuver: "TURN_SLIGHT_RIGHT",
            distanceMeters: 306,
          },
        ],
      },
    ],
  });
  assert.equal(
    route?.steps[0]?.instruction,
    "Blago nadesno na Ferhadija. Odredište će biti s desne strane",
  );
});

test("times read as minutes, then hours, and the arrival as a clock time", () => {
  assert.equal(durationLabel(20), "1 min");
  assert.equal(durationLabel(360), "6 min");
  assert.equal(durationLabel(3900), "1 h 5 min");
  assert.equal(durationLabel(7200), "2 h");
  assert.match(arrivalLabel(new Date(2026, 10, 25, 14, 26, 0), 360), /^14:32$/);
});

test("the line starts and ends slowly", () => {
  assert.equal(easeInOut(0), 0);
  assert.equal(easeInOut(1), 1);
  assert.equal(easeInOut(0.5), 0.5);
  assert.ok(easeInOut(0.1) < 0.1 && easeInOut(0.9) > 0.9);
});
