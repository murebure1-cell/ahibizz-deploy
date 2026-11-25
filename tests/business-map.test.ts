import assert from "node:assert/strict";
import test from "node:test";
import {
  cityPins,
  countryKey,
  countryPins,
  distanceLabel,
  type MapPin,
  mapCities,
  mapCountries,
  mapMarkers,
  mapPins,
  mapPlaces,
  mapTotals,
  nearestCity,
  pinMatches,
  pointBounds,
  worldPixel,
} from "../src/lib/business-map";

const pin = (
  id: string,
  city: string | null,
  latitude: number,
  longitude: number,
  more: Partial<MapPin> = {},
): MapPin => ({
  id,
  title: id,
  city,
  country: null,
  latitude,
  longitude,
  logo: null,
  image: null,
  category: null,
  kind: null,
  verified: false,
  details: null,
  rating: null,
  ...more,
});

test("countries group their cities and unknown countries fall under Ostalo", () => {
  const pins = mapPins([
    { id: "1", title: "a", city: "Tuzla", countryCode: "ba", latitude: 44.5, longitude: 18.6 },
    { id: "2", title: "b", city: "Sarajevo", countryCode: "BA", latitude: 43.8, longitude: 18.4 },
    { id: "3", title: "c", city: "Tuzla", countryCode: "BA", latitude: 44.6, longitude: 18.7 },
    {
      id: "4",
      title: "d",
      city: "Freilassing",
      countryCode: "DE",
      latitude: 47.8,
      longitude: 12.9,
    },
    { id: "5", title: "e", city: "Negdje", countryCode: "x1", latitude: 40, longitude: 10 },
  ]);
  const countries = mapCountries(pins);
  assert.deepEqual(
    countries.map(({ code, count }) => [code, count]),
    [
      ["BA", 3],
      ["DE", 1],
      [null, 1],
    ],
  );
  assert.equal(countries[2]?.name, "Ostalo");
  assert.deepEqual(
    countries[0]?.cities.map(({ name, count }) => [name, count]),
    [
      ["Tuzla", 2],
      ["Sarajevo", 1],
    ],
  );
  assert.deepEqual(mapTotals(pins, countries), { businesses: 5, countries: 2, cities: 4 });
  assert.equal(countryKey(null), "ostalo");
  assert.deepEqual(
    countryPins(pins, "ba").map((item) => item.id),
    ["1", "2", "3"],
  );
  assert.deepEqual(
    countryPins(pins, "ostalo").map((item) => item.id),
    ["5"],
  );
  assert.deepEqual(
    cityPins(pins, " tuzla ").map((item) => item.id),
    ["1", "3"],
  );
});

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

test("a pin carries what its card shows and nothing malformed", () => {
  const [full, bare] = mapPins([
    {
      id: "a",
      title: "Sofra",
      city: "Sarajevo",
      countryCode: "BA",
      latitude: 43.86,
      longitude: 18.42,
      categoryName: " Ugostiteljski objekti ",
      subcategoryName: "Restoran",
      verified: true,
      details: { timezone: null, hours: null, amenities: ["wifi"] },
      reviews: { count: 4, sum: 19 },
    },
    {
      id: "b",
      title: "Servis",
      city: null,
      latitude: 44,
      longitude: 18,
      categoryName: "Servisi",
      subcategoryName: "  ",
      verified: null,
      details: { hours: "uvijek" },
      reviews: { count: 2, sum: 30 },
    },
  ]);
  assert.equal(full?.category, "Ugostiteljski objekti");
  assert.equal(full?.kind, "Restoran");
  assert.equal(full?.verified, true);
  assert.deepEqual(full?.details?.amenities, ["wifi"]);
  assert.equal(full?.rating, 4.75);
  assert.equal(full?.image, null);
  // A category stands in for a missing subcategory; broken details and an impossible rating are dropped.
  assert.equal(bare?.kind, "Servisi");
  assert.equal(bare?.verified, false);
  assert.equal(bare?.details, null);
  assert.equal(bare?.rating, null);
});

test("cities group case-insensitively, average their points and sort by count", () => {
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

test("the globe gets one light for a place, with its number and its country", () => {
  const places = mapPlaces([
    pin("1", "Sarajevo", 43.856, 18.413, { country: "BA" }),
    pin("2", "Sarajevo", 43.861, 18.42, { country: "BA" }),
    pin("3", "Tuzla", 44.54, 18.67, { country: "BA" }),
    pin("4", null, 48.2, 16.37),
  ]);
  assert.deepEqual(
    places.map(({ count, country }) => [count, country]),
    [
      [2, "BA"],
      [1, "BA"],
      [1, "ostalo"],
    ],
  );
  assert.ok(Math.abs((places[0]?.latitude ?? 0) - 43.8585) < 1e-9);
});

test("businesses close together on the screen become one group until the map is close", () => {
  const pins = [
    pin("a", "Sarajevo", 43.8563, 18.4131),
    pin("b", "Sarajevo", 43.8564, 18.4133),
    pin("c", "Sarajevo", 43.8565, 18.4129),
    pin("far", "Tuzla", 44.5384, 18.6763),
  ];
  const far = mapMarkers(pins, 12);
  assert.equal(far.length, 2);
  const group = far.find((marker) => marker.type === "group");
  assert.ok(group && group.type === "group");
  assert.equal(group.count, 3);
  assert.deepEqual([...group.ids].sort(), ["a", "b", "c"]);
  assert.ok(Math.abs(group.latitude - 43.8564) < 1e-9);

  // The chosen business stays a pin of its own; the others still group.
  const kept = mapMarkers(pins, 12, { keep: "b" });
  assert.equal(kept.filter((marker) => marker.type === "pin").length, 2);
  assert.equal(kept.find((marker) => marker.type === "group")?.count, 2);

  // Up close nothing is grouped, so two businesses at one address can both be reached.
  assert.equal(
    mapMarkers(pins, 19).every((marker) => marker.type === "pin"),
    true,
  );
  assert.deepEqual(mapMarkers([], 12), []);
});

test("the flat world doubles with every zoom and puts Greenwich in the middle", () => {
  assert.deepEqual(worldPixel(0, 0, 0), { x: 128, y: 128 });
  const near = worldPixel(43.8563, 18.4131, 10);
  const nearer = worldPixel(43.8563, 18.4131, 11);
  assert.ok(Math.abs(nearer.x - near.x * 2) < 1e-6);
  assert.ok(Math.abs(nearer.y - near.y * 2) < 1e-6);
  assert.ok(Number.isFinite(worldPixel(90, 0, 3).y));
});

test("the search on the map reads names, kinds and cities without diacritics", () => {
  const cevabdzinica = pin("x", "Sarajevo", 43.85, 18.41, {
    title: "Ćevabdžinica Željo",
    category: "Ugostiteljski objekti",
    kind: "Restoran",
  });
  assert.equal(pinMatches(cevabdzinica, ""), true);
  assert.equal(pinMatches(cevabdzinica, "cevabdzinica zeljo"), true);
  assert.equal(pinMatches(cevabdzinica, "restoran sarajevo"), true);
  assert.equal(pinMatches(cevabdzinica, "ugostitelj"), true);
  assert.equal(pinMatches(cevabdzinica, "frizer"), false);
  assert.equal(pinMatches(pin("y", null, 1, 1, { title: "Đurđevak" }), "djurdjevak"), true);
});

test("a frame around points always has a size, and the nearest city must be near", () => {
  assert.equal(pointBounds([]), null);
  const one = pointBounds([{ latitude: 43.85, longitude: 18.41 }]);
  assert.ok(one && one.north > one.south && one.east > one.west);
  assert.deepEqual(
    pointBounds([
      { latitude: 43.8, longitude: 18.4 },
      { latitude: 44.6, longitude: 17.2 },
    ]),
    { south: 43.8, west: 17.2, north: 44.6, east: 18.4 },
  );
  const cities = mapCities([
    pin("1", "Sarajevo", 43.8563, 18.4131),
    pin("2", "Tuzla", 44.5384, 18.6763),
  ]);
  assert.equal(nearestCity(cities, { latitude: 43.83, longitude: 18.35 })?.name, "Sarajevo");
  assert.equal(nearestCity(cities, { latitude: 45.81, longitude: 15.98 }), null);
});

test("distances read as metres, then kilometres", () => {
  assert.equal(distanceLabel(4), "10 m");
  assert.equal(distanceLabel(447), "450 m");
  assert.equal(distanceLabel(1240), "1,2 km");
  assert.equal(distanceLabel(1240, "en"), "1.2 km");
  assert.equal(distanceLabel(18_600), "19 km");
  assert.equal(distanceLabel(Number.NaN), "");
});
