import assert from "node:assert/strict";
import test from "node:test";
import {
  initialLocationPoint,
  isLocationPoint,
  parsePhotonResults,
} from "../src/lib/business-location";

function feature(coordinates: unknown = [18.6671, 44.5384], properties: unknown = {}) {
  return { type: "Feature", geometry: { type: "Point", coordinates }, properties };
}
function collection(...features: unknown[]) {
  return { type: "FeatureCollection", features };
}

test("location points preserve zero, edge coordinates and real zero accuracy", () => {
  for (const point of [
    { latitude: 0, longitude: 0 },
    { latitude: -90, longitude: -180, accuracy: 0 },
    { latitude: 90, longitude: 180, accuracy: 123.5 },
  ])
    assert.equal(isLocationPoint(point), true);
  assert.deepEqual(initialLocationPoint(0, 0, 0), { latitude: 0, longitude: 0, accuracy: 0 });
  assert.deepEqual(initialLocationPoint(44.5, 18.6), { latitude: 44.5, longitude: 18.6 });
});

test("incomplete, coerced, out-of-range and non-finite stored coordinates stay unknown", () => {
  for (const [latitude, longitude, accuracy] of [
    [null, 0],
    [0, undefined],
    ["0", 0],
    [0, "0"],
    [91, 0],
    [0, -181],
    [Number.NaN, 0],
    [0, Number.POSITIVE_INFINITY],
    [0, 0, -1],
    [0, 0, Number.NaN],
    [0, 0, null],
  ])
    assert.equal(initialLocationPoint(latitude, longitude, accuracy), null);
  for (const point of [null, [], {}, { latitude: 0 }, { latitude: false, longitude: 0 }])
    assert.equal(isLocationPoint(point), false);
});

test("Photon actual GeoJSON order maps to named coordinates and explicit address fields", () => {
  const source = collection(
    feature([18.6671, 44.5384], {
      osm_type: "N",
      osm_id: 12345,
      name: "Fixture servis",
      street: "Fixture ulica",
      housenumber: "12",
      city: "Tuzla",
      countrycode: "ba",
      country: "Bosna i Hercegovina",
      accuracy: 100,
    }),
  );
  const before = structuredClone(source);
  assert.deepEqual(parsePhotonResults(source), [
    {
      id: "osm:N:12345",
      label: "Fixture servis, Fixture ulica 12, Tuzla, Bosna i Hercegovina",
      addressLine: "Fixture ulica 12",
      city: "Tuzla",
      countryCode: "BA",
      point: { latitude: 44.5384, longitude: 18.6671 },
    },
  ]);
  assert.deepEqual(source, before, "Mapping must not mutate the response or invent accuracy.");
});

test("malformed geometry and properties cannot produce selectable locations", () => {
  const malformed = [
    null,
    {},
    {
      type: "Feature",
      properties: { name: "Not a point" },
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
    },
    feature([0], { name: "Incomplete" }),
    feature(["0", 0], { name: "Coerced" }),
    feature([0, 91], { name: "Outside latitude" }),
    feature([181, 0], { name: "Outside longitude" }),
    feature([0, Number.NaN], { name: "NaN" }),
    feature([Number.NEGATIVE_INFINITY, 0], { name: "Infinity" }),
    feature([0, 0, "bad altitude"], { name: "Invalid position" }),
    feature([0, 0], null),
    feature([0, 0], []),
    feature([0, 0], {}),
  ];
  assert.deepEqual(parsePhotonResults(collection(...malformed)), []);
  for (const input of [
    null,
    [],
    {},
    { type: "FeatureCollection", features: {} },
    { type: "Point", features: [] },
  ])
    assert.deepEqual(parsePhotonResults(input), []);
});

test("zero GeoJSON coordinates remain valid while unknown addresses and country codes remain null", () => {
  const result = parsePhotonResults(
    collection(
      feature([0, 0], {
        name: "Zero point",
        housenumber: "99",
        district: "Not the city",
        state: "Fixture region",
        country: "Bosna i Hercegovina",
        countrycode: "Bosnia",
        osm_type: "N",
        osm_id: Number.MAX_SAFE_INTEGER + 1,
      }),
    ),
  )[0];
  assert.ok(result);
  assert.deepEqual(result.point, { latitude: 0, longitude: 0 });
  assert.equal(result.addressLine, null);
  assert.equal(result.city, null);
  assert.equal(result.countryCode, null);
  assert.match(result.id, /^point:0,0:/);
});

test("only explicit Photon place settlements may use their sanitized name as the city", () => {
  for (const kind of ["city", "town", "village", "hamlet"]) {
    const result = parsePhotonResults(
      collection(
        feature([18.6671, 44.5384], {
          name: "  <b>Tuzla</b>\n",
          osm_key: "place",
          osm_value: kind,
        }),
      ),
    )[0];
    assert.ok(result);
    assert.equal(result.city, "Tuzla");
    assert.equal(result.addressLine, null);
    assert.equal(result.label, "Tuzla");
  }
  for (const properties of [
    { name: "Fixture restaurant", osm_key: "amenity", osm_value: "restaurant" },
    { name: "Fixture district", osm_key: "place", osm_value: "suburb" },
    { name: "Malformed settlement type", osm_key: "place", osm_value: ["city"] },
    { name: "Unknown type", osm_value: "city" },
  ])
    assert.equal(parsePhotonResults(collection(feature([0, 0], properties)))[0]?.city, null);
  const explicit = parsePhotonResults(
    collection(
      feature([0, 0], {
        name: "Place name",
        city: "Existing city",
        osm_key: "place",
        osm_value: "town",
      }),
    ),
  )[0];
  assert.equal(explicit?.city, "Existing city");
});

test("provider display strings are bounded plain text, with no control or bidi markup", () => {
  const result = parsePhotonResults(
    collection(
      feature([13.4, 52.5, 30], {
        name: `  <b>Fixture</b>\n\u0000\u202e${"😀".repeat(250)}`,
        street: "S".repeat(300),
        housenumber: "12",
        city: "C".repeat(200),
        countrycode: " de ",
      }),
    ),
  )[0];
  assert.ok(result);
  assert.ok(Array.from(result.label).length <= 240);
  assert.ok(Array.from(result.addressLine ?? "").length <= 200);
  assert.equal(result.city?.length, 100);
  assert.equal(result.countryCode, "DE");
  assert.equal(result.label.includes("<"), false);
  assert.equal(result.label.includes(">"), false);
  assert.equal(result.label.includes("\u0000"), false);
  assert.equal(result.label.includes("\u202e"), false);
  assert.equal(
    result.label.includes("\ufffd"),
    false,
    "Truncation must not split an emoji codepoint.",
  );
});

test("stable OSM ids deduplicate responses and source country codes are strictly two letters", () => {
  const source = collection(
    feature([1, 2], {
      name: "First",
      osm_type: "w",
      osm_id: "9007199254740993123",
      countrycode: "tr",
    }),
    feature([1, 2], { name: "Duplicate", osm_type: "W", osm_id: "9007199254740993123" }),
    feature([2, 3], { name: "Other", countrycode: "bа" }),
  );
  const results = parsePhotonResults(source);
  assert.equal(results.length, 2);
  assert.equal(results[0]?.id, "osm:W:9007199254740993123");
  assert.equal(results[0]?.countryCode, "TR");
  assert.equal(results[1]?.countryCode, null, "Cyrillic lookalike is not an ISO two-letter code.");
});

test("search mapping bounds both output and malformed source scanning", () => {
  const many = Array.from({ length: 30 }, (_, index) =>
    feature([index, 0], { name: `Place ${index}` }),
  );
  assert.equal(parsePhotonResults(collection(...many)).length, 10);
  assert.deepEqual(
    parsePhotonResults(
      collection(...Array(100).fill(null), feature([0, 0], { name: "Beyond scan limit" })),
    ),
    [],
  );
});
