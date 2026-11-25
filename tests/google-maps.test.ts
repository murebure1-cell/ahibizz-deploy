import assert from "node:assert/strict";
import test from "node:test";
import {
  mapGround,
  mapPalette,
  mapStyleKind,
  mapStyles,
  readGoogleMapId,
  readGoogleMapsKey,
  streetsFromZoom,
} from "../src/lib/google-maps";

test("only a plain Google Map ID is published to the page", () => {
  assert.equal(readGoogleMapId(" 8f1c2a7d9e0b4c11 "), "8f1c2a7d9e0b4c11");
  for (const value of [undefined, "", "abc", "a b c d", '1234"><script>', "x".repeat(65)])
    assert.equal(readGoogleMapId(value), null);
});

test("only a well-formed Google Maps browser key is published to the page", () => {
  const key = `AIza${"A".repeat(35)}`;
  assert.equal(readGoogleMapsKey(key), key);
  assert.equal(readGoogleMapsKey(` ${key} `), key);
  for (const value of [
    undefined,
    "",
    "AIza123",
    `${key}x`,
    `BIza${"A".repeat(35)}`,
    `${key}"><script>`,
  ])
    assert.equal(readGoogleMapsKey(value), null);
});

test("every map look hides other businesses' places and uses plain hex colours", () => {
  for (const dark of [true, false])
    for (const kind of ["streets", "country"] as const) {
      const style = mapStyles(dark, kind);
      assert.ok(
        style.some((rule) => rule.featureType === "poi" && rule.stylers[0]?.visibility === "off"),
      );
      for (const rule of style)
        for (const styler of rule.stylers)
          if (typeof styler.color === "string") assert.match(styler.color, /^#[0-9a-f]{6}$/);
    }
});

test("the streets keep their roads and parks, the country keeps only its outline and name", () => {
  const streets = mapStyles(true, "streets");
  assert.ok(
    streets.some(
      (rule) => rule.featureType === "road" && rule.stylers[0]?.color === mapPalette.dark.road,
    ),
  );
  assert.ok(
    streets.some((rule) => rule.featureType === "poi.park" && rule.stylers[0]?.visibility === "on"),
  );
  const country = mapStyles(false, "country");
  assert.ok(
    country.some((rule) => rule.featureType === "road" && rule.stylers[0]?.visibility === "off"),
  );
  assert.ok(
    country.some(
      (rule) =>
        rule.featureType === "administrative.country" &&
        rule.elementType === "geometry.stroke" &&
        rule.stylers.some((styler) => styler.color === mapPalette.light.border),
    ),
  );
});

test("the look follows the zoom, and the ground shows the right colour before the tiles", () => {
  assert.equal(mapStyleKind(undefined), "country");
  assert.equal(mapStyleKind(streetsFromZoom - 1), "country");
  assert.equal(mapStyleKind(streetsFromZoom), "streets");
  assert.equal(mapGround(true, "country"), mapPalette.dark.sea);
  assert.equal(mapGround(false, "streets"), mapPalette.light.land);
});
