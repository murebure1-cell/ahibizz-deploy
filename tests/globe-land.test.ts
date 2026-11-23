import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decodeLand, isLand } from "../src/lib/globe-land";

const file = readFileSync(new URL("../public/globe/land-50m.bin", import.meta.url));
const rings = decodeLand(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));

test("home globe land outlines cover the continents and leave the oceans empty", () => {
  assert.ok(rings.length > 500);
  assert.ok(isLand(rings, 43.86, 18.41), "Sarajevo");
  assert.ok(isLand(rings, 44.54, 18.67), "Tuzla");
  assert.ok(isLand(rings, -1.29, 36.82), "Nairobi");
  assert.ok(isLand(rings, 40.71, -74.0) || isLand(rings, 40.75, -73.9), "New York");
  assert.ok(isLand(rings, 66, -175), "Chukotka across the antimeridian");
  assert.ok(isLand(rings, -85, 40), "Antarctica");
  assert.ok(!isLand(rings, 30, -40), "middle of the Atlantic");
  assert.ok(!isLand(rings, -20, -120), "South Pacific");
  assert.ok(!isLand(rings, 43, 5), "Mediterranean off France");
});
