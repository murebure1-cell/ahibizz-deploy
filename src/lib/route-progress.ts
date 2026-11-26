/**
 * A route as the directions screen needs it, and where a person is along it. All of it is plain
 * geometry on the points Google returns, so the line can draw itself and the next turn can be
 * told without asking Google again while a person walks.
 */
export type RoutePoint = { lat: number; lng: number };
export type RouteStep = {
  /** What to do, in the person's language, as Google words it. */
  instruction: string;
  /** Google's name for the turn, e.g. TURN_LEFT; empty when it gives none. */
  maneuver: string;
  metres: number;
};
export type AppRoute = {
  path: RoutePoint[];
  metres: number;
  seconds: number;
  steps: RouteStep[];
};

const radians = Math.PI / 180;
const earthMetres = 6_371_000;

export function metresBetween(a: RoutePoint, b: RoutePoint): number {
  const h =
    Math.sin(((b.lat - a.lat) * radians) / 2) ** 2 +
    Math.cos(a.lat * radians) *
      Math.cos(b.lat * radians) *
      Math.sin(((b.lng - a.lng) * radians) / 2) ** 2;
  return 2 * earthMetres * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

/** How far each point of a path is from its start, in metres; the last entry is the whole length. */
export function pathLengths(path: readonly RoutePoint[]): number[] {
  const lengths: number[] = [];
  let total = 0;
  path.forEach((point, index) => {
    const before = path[index - 1];
    if (before) total += metresBetween(before, point);
    lengths.push(total);
  });
  return lengths;
}

/**
 * The beginning of a path, as far as `metres` along it. The last point lies between two of the
 * path's own, so a line drawn through the result grows smoothly as `metres` grows.
 */
export function pathUntil(
  path: readonly RoutePoint[],
  lengths: readonly number[],
  metres: number,
): RoutePoint[] {
  const [first] = path;
  if (!first) return [];
  const total = lengths[lengths.length - 1] ?? 0;
  if (metres >= total) return [...path];
  if (metres <= 0) return [first];
  const part: RoutePoint[] = [first];
  for (let index = 1; index < path.length; index++) {
    const point = path[index];
    const before = path[index - 1];
    const reached = lengths[index] ?? 0;
    const start = lengths[index - 1] ?? 0;
    if (!point || !before) break;
    if (reached <= metres) {
      part.push(point);
      continue;
    }
    const share = reached > start ? (metres - start) / (reached - start) : 0;
    part.push({
      lat: before.lat + (point.lat - before.lat) * share,
      lng: before.lng + (point.lng - before.lng) * share,
    });
    break;
  }
  return part;
}

/** The point `metres` along a path; its ends for a distance before or past them. */
export function pathPoint(
  path: readonly RoutePoint[],
  lengths: readonly number[],
  metres: number,
): RoutePoint | null {
  const [first] = path;
  if (!first) return null;
  if (metres <= 0) return first;
  for (let index = 1; index < path.length; index++) {
    const reached = lengths[index] ?? 0;
    if (reached < metres) continue;
    const before = path[index - 1];
    const point = path[index];
    if (!before || !point) break;
    const start = lengths[index - 1] ?? 0;
    const share = reached > start ? (metres - start) / (reached - start) : 1;
    return {
      lat: before.lat + (point.lat - before.lat) * share,
      lng: before.lng + (point.lng - before.lng) * share,
    };
  }
  return path[path.length - 1] ?? first;
}

/**
 * Where a person is on a path: the point of the path nearest to them, how far along the path that
 * point is and how far from it they stand. Distances this short are flat enough to measure on a
 * plane laid at the person's latitude.
 */
export function pathProgress(
  path: readonly RoutePoint[],
  lengths: readonly number[],
  person: RoutePoint,
): { along: number; off: number; point: RoutePoint } | null {
  const [first] = path;
  if (!first) return null;
  const east = Math.cos(person.lat * radians) * radians * earthMetres;
  const north = radians * earthMetres;
  const flat = (point: RoutePoint) => ({
    x: (point.lng - person.lng) * east,
    y: (point.lat - person.lat) * north,
  });
  let best = { along: 0, off: metresBetween(first, person), point: first };
  for (let index = 1; index < path.length; index++) {
    const a = path[index - 1];
    const b = path[index];
    if (!a || !b) continue;
    const from = flat(a);
    const to = flat(b);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = dx * dx + dy * dy;
    // The person is the origin of the plane, so the nearest point is the foot of the origin.
    const share = length ? Math.min(1, Math.max(0, -(from.x * dx + from.y * dy) / length)) : 0;
    const off = Math.hypot(from.x + dx * share, from.y + dy * share);
    if (off >= best.off) continue;
    const start = lengths[index - 1] ?? 0;
    best = {
      along: start + ((lengths[index] ?? start) - start) * share,
      off,
      point: { lat: a.lat + (b.lat - a.lat) * share, lng: a.lng + (b.lng - a.lng) * share },
    };
  }
  return best;
}

/**
 * The step a person is on for a distance along the route, and how far it is to where that step
 * ends and the next instruction begins. Past the last step it stays on the last one.
 */
export function stepAt(
  steps: readonly RouteStep[],
  along: number,
): { index: number; toNext: number } | null {
  if (!steps.length) return null;
  let end = 0;
  for (let index = 0; index < steps.length; index++) {
    end += steps[index]?.metres ?? 0;
    if (along < end || index === steps.length - 1)
      return { index, toNext: Math.max(0, end - along) };
  }
  return null;
}

/** The arrow for a turn. Google's list of turns grows; anything unknown reads as "keep going". */
export function maneuverSign(maneuver: string): "left" | "right" | "straight" {
  const name = maneuver.toUpperCase();
  if (name.includes("LEFT")) return "left";
  if (name.includes("RIGHT")) return "right";
  return "straight";
}

/** A person within this many metres of the end has arrived. */
export const arrivedWithin = 25;
/** Further than this from the line, a person has left the route and it is worked out again. */
export const offRouteBeyond = 60;

/** Google breaks an instruction into lines; on one line they read as sentences. */
function oneLine(value: string): string {
  return value
    .split(/\n+/)
    .map((line) => line.trim().replace(/[.\s]+$/, ""))
    .filter(Boolean)
    .join(". ");
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function point(value: unknown): RoutePoint | null {
  if (!value || typeof value !== "object") return null;
  const { lat, lng } = value as { lat?: unknown; lng?: unknown };
  // Google hands out points with numbers in some places and with functions in others.
  const latitude = number(typeof lat === "function" ? (lat as () => unknown).call(value) : lat);
  const longitude = number(typeof lng === "function" ? (lng as () => unknown).call(value) : lng);
  return latitude === null ||
    longitude === null ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
    ? null
    : { lat: latitude, lng: longitude };
}

/** A route from Google's answer, or null when the answer has no usable line. */
export function readRoute(value: unknown): AppRoute | null {
  if (!value || typeof value !== "object") return null;
  const route = value as {
    path?: unknown;
    distanceMeters?: unknown;
    durationMillis?: unknown;
    legs?: unknown;
  };
  const path = Array.isArray(route.path)
    ? route.path.flatMap((entry) => {
        const read = point(entry);
        return read ? [read] : [];
      })
    : [];
  if (path.length < 2) return null;
  const lengths = pathLengths(path);
  const steps: RouteStep[] = [];
  for (const leg of Array.isArray(route.legs) ? route.legs : []) {
    const entries = (leg as { steps?: unknown } | null)?.steps;
    for (const entry of Array.isArray(entries) ? entries : []) {
      const step = entry as {
        instructions?: unknown;
        maneuver?: unknown;
        distanceMeters?: unknown;
      };
      const instruction = typeof step.instructions === "string" ? oneLine(step.instructions) : "";
      const metres = number(step.distanceMeters);
      if (!instruction || metres === null || metres < 0) continue;
      steps.push({
        instruction,
        maneuver: typeof step.maneuver === "string" ? step.maneuver : "",
        metres,
      });
    }
  }
  const millis = number(route.durationMillis);
  return {
    path,
    metres: number(route.distanceMeters) ?? lengths[lengths.length - 1] ?? 0,
    seconds: millis === null ? 0 : Math.max(0, millis / 1000),
    steps,
  };
}

/** "6 min" under an hour, "1 h 5 min" from there on; never less than a minute. */
export function durationLabel(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} h ${rest} min` : `${Math.floor(minutes / 60)} h`;
}

/** The time of day `seconds` from `now`, as the clock of the person's place shows it. */
export function arrivalLabel(now: Date, seconds: number, locale = "bs"): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(now.getTime() + seconds * 1000));
}

/** The box around a line, for framing it on the map; null for an empty line. */
export function routeBounds(path: readonly RoutePoint[]) {
  if (!path.length) return null;
  let south = 90;
  let north = -90;
  let west = 180;
  let east = -180;
  for (const point of path) {
    south = Math.min(south, point.lat);
    north = Math.max(north, point.lat);
    west = Math.min(west, point.lng);
    east = Math.max(east, point.lng);
  }
  return { south, west, north, east };
}

/** Slow at both ends, for the half second in which the line draws itself. */
export function easeInOut(k: number): number {
  return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
}
