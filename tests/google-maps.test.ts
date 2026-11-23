import assert from "node:assert/strict";
import test from "node:test";
import { googleMapsDark, googleMapsLight, readGoogleMapsKey } from "../src/lib/google-maps";

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

test("both map themes hide points of interest and use plain hex colours", () => {
  for (const style of [googleMapsLight, googleMapsDark]) {
    assert.ok(
      style.some((rule) => rule.featureType === "poi" && rule.stylers[0]?.visibility === "off"),
    );
    for (const rule of style)
      for (const styler of rule.stylers)
        if (styler.color) assert.match(styler.color, /^#[0-9a-f]{6}$/);
  }
});
