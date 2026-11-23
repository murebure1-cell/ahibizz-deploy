import assert from "node:assert/strict";
import test from "node:test";
import { mapCities, mapPins } from "../src/lib/business-map";

test("map pins keep only valid coordinates and public fields", () => {
  const pins = mapPins([
    { id: "a", title: "Pekara", city: " Tuzla ", latitude: "44.53", longitude: "18.67" },
    { id: "b", title: "Bez lokacije", city: "Tuzla", latitude: "abc", longitude: "18" },
    { id: "c", title: "Van svijeta", city: "X", latitude: 120, longitude: 18 },
  ]);
  assert.deepEqual(
    pins.map(({ id, city, latitude, longitude, logo }) => ({
      id,
      city,
      latitude,
      longitude,
      logo,
    })),
    [{ id: "a", city: "Tuzla", latitude: 44.53, longitude: 18.67, logo: null }],
  );
});

test("cities group case-insensitively, average their points and sort by count", () => {
  const pin = (id: string, city: string | null, latitude: number, longitude: number) => ({
    id,
    title: id,
    city,
    latitude,
    longitude,
    logo: null,
  });
  const cities = mapCities([
    pin("1", "Tuzla", 44.5, 18.6),
    pin("2", "tuzla", 44.6, 18.8),
    pin("3", "Sarajevo", 43.85, 18.4),
    pin("4", null, 44, 17),
  ]);
  assert.equal(cities.length, 2);
  assert.equal(cities[0]?.name, "Tuzla");
  assert.equal(cities[0]?.count, 2);
  assert.ok(Math.abs((cities[0]?.latitude ?? 0) - 44.55) < 1e-9);
  assert.equal(cities[1]?.name, "Sarajevo");
});
