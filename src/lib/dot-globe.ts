/**
 * The dotted globe: where its dots sit and how a turn of the ball puts them on the screen. The
 * ball is drawn with its axis leaning a little to the left and seen a little from above, as on
 * the drawing; `spin` turns it about that axis.
 */
export type GlobeView = {
  /** Turn about the axis, in radians. The meridian `-spin` faces the viewer. */
  spin: number;
  /** How far the north pole leans towards the viewer, in radians. */
  elevation: number;
  /** How far the axis leans to the left on the screen, in radians. */
  roll: number;
};

const degree = Math.PI / 180;
export const globeRest = { elevation: 16 * degree, roll: 12 * degree } as const;
/** One full turn of the resting globe, in seconds. */
export const globeTurnSeconds = 80;
/** How far a drag may tip the globe: never onto its head. */
export const globeElevationLimits = [-18 * degree, 58 * degree] as const;

export type Vector = readonly [number, number, number];

export function globeVector(latitude: number, longitude: number): Vector {
  const phi = latitude * degree;
  const lambda = longitude * degree;
  return [Math.cos(phi) * Math.sin(lambda), Math.sin(phi), Math.cos(phi) * Math.cos(lambda)];
}

/**
 * The three turns of a view as one table of nine numbers, worked out once for a frame and then
 * applied to every dot: [xx, xy, xz, yx, yy, yz, zx, zy, zz].
 */
export function globeTurn(view: GlobeView): Float64Array {
  const cs = Math.cos(view.spin);
  const ss = Math.sin(view.spin);
  const ce = Math.cos(view.elevation);
  const se = Math.sin(view.elevation);
  const cr = Math.cos(view.roll);
  const sr = Math.sin(view.roll);
  // Spin about the axis, then lean towards the viewer, then lean on the screen.
  return Float64Array.of(
    cs * cr - ss * se * sr,
    -ce * sr,
    ss * cr + cs * se * sr,
    cs * sr + ss * se * cr,
    ce * cr,
    ss * sr - cs * se * cr,
    -ss * ce,
    se,
    cs * ce,
  );
}

/**
 * A point of the unit ball on the screen: x to the right and y up, both from -1 to 1, and z
 * towards the viewer, so a point is on the visible half while z is positive.
 */
export function globeProject([x, y, z]: Vector, view: GlobeView) {
  const t = globeTurn(view);
  return {
    x: (t[0] ?? 0) * x + (t[1] ?? 0) * y + (t[2] ?? 0) * z,
    y: (t[3] ?? 0) * x + (t[4] ?? 0) * y + (t[5] ?? 0) * z,
    z: (t[6] ?? 0) * x + (t[7] ?? 0) * y + (t[8] ?? 0) * z,
  };
}

/** The place under a point of the visible half, or null beside the ball. */
export function globePlaceAt(x: number, y: number, view: GlobeView) {
  const rest = 1 - x * x - y * y;
  if (rest < 0) return null;
  const z2 = Math.sqrt(rest);
  const cr = Math.cos(view.roll);
  const sr = Math.sin(view.roll);
  const x1 = x * cr + y * sr;
  const y2 = -x * sr + y * cr;
  const ce = Math.cos(view.elevation);
  const se = Math.sin(view.elevation);
  const py = y2 * ce + z2 * se;
  const z1 = -y2 * se + z2 * ce;
  const cs = Math.cos(view.spin);
  const ss = Math.sin(view.spin);
  const px = x1 * cs - z1 * ss;
  const pz = x1 * ss + z1 * cs;
  return {
    latitude: Math.asin(Math.min(1, Math.max(-1, py))) / degree,
    longitude: Math.atan2(px, pz) / degree,
  };
}

/** The view that brings a place to the middle of the ball, without tipping the ball over. */
export function globeFacing(
  latitude: number,
  longitude: number,
): Pick<GlobeView, "spin" | "elevation"> {
  const [low, high] = globeElevationLimits;
  return {
    spin: -longitude * degree,
    elevation: Math.min(high, Math.max(low, latitude * degree * 0.72)),
  };
}

/** The same angle as `to`, written as the nearest one to `from`, so a turn takes the short way. */
export function nearestTurn(from: number, to: number): number {
  const full = Math.PI * 2;
  return from + ((((to - from + Math.PI) % full) + full) % full) - Math.PI;
}

export type LandMask = { width: number; height: number; data: Uint8ClampedArray };

/**
 * The dots of the land: a point every `step` degrees in rows that keep the same distance all the
 * way to the poles, every second row shifted by half a step. `mask` is a flat map of the world
 * (longitude across from -180, latitude down from 90) whose alpha says where land is. Returns
 * [x, y, z, x, y, z, …] on the unit ball.
 */
export function landDots(mask: LandMask, step: number): Float32Array {
  const dots: number[] = [];
  const rows = Math.max(1, Math.round(180 / step));
  for (let row = 0; row < rows; row++) {
    const latitude = -90 + (row + 0.5) * (180 / rows);
    const around = Math.max(1, Math.round((360 * Math.cos(latitude * degree)) / step));
    const shift = row % 2 ? 0.5 : 0;
    for (let index = 0; index < around; index++) {
      const longitude = -180 + ((index + shift) * 360) / around;
      const column = Math.min(mask.width - 1, Math.floor(((longitude + 180) / 360) * mask.width));
      const line = Math.min(mask.height - 1, Math.floor(((90 - latitude) / 180) * mask.height));
      if ((mask.data[(line * mask.width + column) * 4 + 3] ?? 0) < 128) continue;
      dots.push(...globeVector(latitude, longitude));
    }
  }
  return Float32Array.from(dots);
}

/** How big a light is for the number of businesses at its place: three sizes, as drawn. */
export function lightSize(count: number): { core: number; glow: number } {
  if (count >= 10) return { core: 2.8, glow: 11.65 };
  if (count >= 3) return { core: 2.3, glow: 9.5 };
  return { core: 1.8, glow: 7.35 };
}
