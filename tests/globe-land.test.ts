import assert from "node:assert/strict";
import test from "node:test";
import { landPoints, unitVector } from "../src/lib/globe-land";

function nearestLand(points: Float32Array, latitude: number, longitude: number) {
  const [x, y, z] = unitVector(latitude, longitude);
  let best = -1;
  for (let i = 0; i < points.length; i += 3)
    best = Math.max(
      best,
      x * (points[i] ?? 0) + y * (points[i + 1] ?? 0) + z * (points[i + 2] ?? 0),
    );
  return (Math.acos(Math.min(1, best)) * 180) / Math.PI;
}

test("home globe land dots cover the continents and leave the oceans empty", () => {
  const points = landPoints();
  assert.equal(points.length / 3, 8209);
  assert.ok(nearestLand(points, 43.86, 18.41) < 1, "Sarajevo is on land");
  assert.ok(nearestLand(points, -1.29, 36.82) < 1, "Nairobi is on land");
  assert.ok(nearestLand(points, 35.68, 139.69) < 1.5, "Tokyo is on land");
  assert.ok(nearestLand(points, 30, -40) > 5, "the middle of the Atlantic is water");
  assert.ok(nearestLand(points, -20, -120) > 5, "the South Pacific is water");
  assert.ok(nearestLand(points, 66, -175) < 1.5, "Chukotka across the antimeridian is on land");
});
