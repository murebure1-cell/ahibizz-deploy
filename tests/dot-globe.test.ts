import assert from "node:assert/strict";
import test from "node:test";
import {
  type GlobeView,
  globeElevationLimits,
  globeFacing,
  globePlaceAt,
  globeProject,
  globeRest,
  globeTurn,
  globeVector,
  landDots,
  lightSize,
  nearestTurn,
} from "../src/lib/dot-globe";

const close = (a: number, b: number, tolerance = 1e-9) => Math.abs(a - b) < tolerance;

test("an untilted globe shows the meridian it was turned to, north up and east to the right", () => {
  const view: GlobeView = { spin: 0, elevation: 0, roll: 0 };
  const front = globeProject(globeVector(0, 0), view);
  assert.ok(close(front.x, 0) && close(front.y, 0) && close(front.z, 1));
  assert.ok(globeProject(globeVector(45, 0), view).y > 0);
  assert.ok(globeProject(globeVector(0, 30), view).x > 0);
  assert.ok(globeProject(globeVector(0, 180), view).z < 0);
  // Turning by minus a longitude brings that longitude to the front.
  const turned = globeProject(globeVector(0, 18), { ...view, spin: (-18 * Math.PI) / 180 });
  assert.ok(close(turned.x, 0) && close(turned.z, 1));
});

test("the drawn tilt leans the pole to the left and towards the viewer", () => {
  const pole = globeProject(globeVector(90, 0), { spin: 0, ...globeRest });
  assert.ok(pole.x < 0);
  assert.ok(pole.y > 0);
  assert.ok(pole.z > 0);
});

test("the table of a frame says the same as the three turns one after another", () => {
  const view: GlobeView = { spin: 1.1, elevation: 0.3, roll: -0.2 };
  const [x, y, z] = globeVector(43.86, 18.41);
  const cs = Math.cos(view.spin);
  const ss = Math.sin(view.spin);
  const x1 = x * cs + z * ss;
  const z1 = -x * ss + z * cs;
  const y2 = y * Math.cos(view.elevation) - z1 * Math.sin(view.elevation);
  const z2 = y * Math.sin(view.elevation) + z1 * Math.cos(view.elevation);
  const expected = {
    x: x1 * Math.cos(view.roll) - y2 * Math.sin(view.roll),
    y: x1 * Math.sin(view.roll) + y2 * Math.cos(view.roll),
    z: z2,
  };
  const got = globeProject([x, y, z], view);
  assert.ok(close(got.x, expected.x) && close(got.y, expected.y) && close(got.z, expected.z));
  assert.equal(globeTurn(view).length, 9);
});

test("a touch on the ball finds the place that was drawn there", () => {
  const view: GlobeView = { spin: -0.4, ...globeRest };
  for (const [latitude, longitude] of [
    [43.86, 18.41],
    [48.2, 16.37],
    [10, 40],
  ] as const) {
    const drawn = globeProject(globeVector(latitude, longitude), view);
    assert.ok(drawn.z > 0);
    const found = globePlaceAt(drawn.x, drawn.y, view);
    assert.ok(found && close(found.latitude, latitude, 1e-6));
    assert.ok(found && close(found.longitude, longitude, 1e-6));
  }
  assert.equal(globePlaceAt(0.9, 0.9, view), null);
});

test("turning to a place brings it to the middle without tipping the ball over", () => {
  const sarajevo = globeFacing(43.86, 18.41);
  const shown = globeProject(globeVector(43.86, 18.41), { ...sarajevo, roll: globeRest.roll });
  assert.ok(Math.abs(shown.x) < 0.25 && shown.z > 0.9);
  const [low, high] = globeElevationLimits;
  assert.equal(globeFacing(89, 0).elevation, high);
  assert.equal(globeFacing(-89, 0).elevation, low);
});

test("a turn takes the short way round", () => {
  const full = Math.PI * 2;
  assert.ok(close(nearestTurn(0, full + 0.2), 0.2));
  assert.ok(close(nearestTurn(0, full - 0.2), -0.2));
  assert.ok(close(nearestTurn(5 * full + 1, 1.5), 5 * full + 1.5));
  assert.ok(Math.abs(nearestTurn(3, -3) - 3) <= Math.PI + 1e-9);
});

test("dots stand only on land and keep their distance up to the poles", () => {
  // A flat world of 8 by 4 cells whose eastern half is land.
  const width = 8;
  const height = 4;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let line = 0; line < height; line++)
    for (let column = width / 2; column < width; column++)
      data[(line * width + column) * 4 + 3] = 255;
  const dots = landDots({ width, height, data }, 10);
  assert.ok(dots.length > 0 && dots.length % 3 === 0);
  let nearPole = 0;
  let nearEquator = 0;
  for (let i = 0; i < dots.length; i += 3) {
    const [x = 0, y = 0, z = 0] = [dots[i], dots[i + 1], dots[i + 2]];
    assert.ok(close(Math.hypot(x, y, z), 1, 1e-6));
    // Eastern longitudes have a positive x on the unit ball.
    assert.ok(x > -1e-6);
    if (Math.abs(y) > Math.sin((70 * Math.PI) / 180)) nearPole++;
    if (Math.abs(y) < Math.sin((10 * Math.PI) / 180)) nearEquator++;
  }
  assert.ok(nearPole > 0 && nearPole < nearEquator);
  assert.equal(
    landDots({ width, height, data: new Uint8ClampedArray(width * height * 4) }, 10).length,
    0,
  );
});

test("a light grows in three steps with the number of businesses", () => {
  assert.ok(lightSize(1).glow < lightSize(3).glow);
  assert.ok(lightSize(3).glow < lightSize(10).glow);
  assert.deepEqual(lightSize(2), lightSize(1));
  assert.deepEqual(lightSize(500), lightSize(10));
});
