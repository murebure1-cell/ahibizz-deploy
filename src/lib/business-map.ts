import { type BusinessDetails, readBusinessDetails } from "./business-details";
import { initialLocationPoint, type LocationPoint } from "./business-location";
import type { BusinessMediaSummary } from "./business-media";
import { distanceMetres } from "./device-location";
import type { Locale } from "./i18n/locales";
import { localNumber } from "./number-format";
import { publicBusinessImages } from "./public-business";

export type MapPin = {
  id: string;
  title: string;
  city: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  logo: string | null;
  /** The photograph for the card and the lists: the cover, or the logo when there is none. */
  image: string | null;
  /** The main category; it picks the icon of the pin and the filter it answers to. */
  category: string | null;
  /** What the business is, as narrowly as it says: the subcategory, or the category. */
  kind: string | null;
  verified: boolean;
  details: BusinessDetails | null;
  /** The average of the visible reviews, or null when there are none. */
  rating: number | null;
};
export type MapCity = { name: string; count: number; latitude: number; longitude: number };
export type MapCountry = MapCity & { code: string | null; cities: MapCity[] };

type PinSource = {
  id: string;
  title: string;
  city: string | null;
  countryCode?: string | null;
  latitude: number | string;
  longitude: number | string;
  media?: unknown;
  categoryName?: string | null;
  subcategoryName?: string | null;
  verified?: boolean | null;
  details?: unknown;
  reviews?: unknown;
};

function pinDetails(value: unknown): BusinessDetails | null {
  if (!value || typeof value !== "object") return null;
  try {
    return readBusinessDetails(value);
  } catch {
    return null;
  }
}

function pinRating(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const { count, sum } = value as { count?: unknown; sum?: unknown };
  if (
    typeof count !== "number" ||
    typeof sum !== "number" ||
    !Number.isInteger(count) ||
    !Number.isInteger(sum) ||
    count < 1 ||
    sum < count ||
    sum > count * 5
  )
    return null;
  return sum / count;
}

function pinText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Public map pins: only valid coordinates and what a public card of the business shows. */
export function mapPins(rows: PinSource[]): MapPin[] {
  return rows.flatMap((row) => {
    const point = initialLocationPoint(Number(row.latitude), Number(row.longitude));
    if (!point) return [];
    // publicBusinessImages validates the media summary and returns nothing for bad data.
    const images = publicBusinessImages(row.id, row.media as BusinessMediaSummary | undefined);
    const logo = images.logo?.src ?? null;
    const country = row.countryCode?.trim().toUpperCase() ?? "";
    const category = pinText(row.categoryName);
    return [
      {
        id: row.id,
        title: row.title,
        city: row.city?.trim() || null,
        country: /^[A-Z]{2}$/.test(country) ? country : null,
        latitude: point.latitude,
        longitude: point.longitude,
        logo,
        image: images.image?.src ?? logo,
        category,
        kind: pinText(row.subcategoryName) ?? category,
        verified: row.verified === true,
        details: pinDetails(row.details),
        rating: pinRating(row.reviews),
      },
    ];
  });
}

function centre(pins: MapPin[]) {
  return {
    latitude: pins.reduce((sum, pin) => sum + pin.latitude, 0) / pins.length,
    longitude: pins.reduce((sum, pin) => sum + pin.longitude, 0) / pins.length,
  };
}

function cityKey(name: string) {
  return name.toLocaleLowerCase("bs");
}

/** Cities with their business count and the average point, for "fly to city" buttons. */
export function mapCities(pins: MapPin[]): MapCity[] {
  const groups = new Map<string, { name: string; pins: MapPin[] }>();
  for (const pin of pins) {
    if (!pin.city) continue;
    const key = cityKey(pin.city);
    const group = groups.get(key) ?? { name: pin.city, pins: [] };
    group.pins.push(pin);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map(({ name, pins: members }) => ({ name, count: members.length, ...centre(members) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "bs"));
}

/** Bosnian country name for an ISO code; unknown countries are grouped as "Ostalo". */
export function countryName(code: string | null): string {
  if (!code) return "Ostalo";
  try {
    return new Intl.DisplayNames(["bs"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Countries with their business count and their cities, largest first. */
export function mapCountries(pins: MapPin[]): MapCountry[] {
  const groups = new Map<string, MapPin[]>();
  for (const pin of pins) {
    const key = pin.country ?? "";
    groups.set(key, [...(groups.get(key) ?? []), pin]);
  }
  return [...groups.entries()]
    .map(([code, members]) => ({
      code: code || null,
      name: countryName(code || null),
      count: members.length,
      ...centre(members),
      cities: mapCities(members),
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "bs"));
}

/** The address of a country in the map's link: its code, or "ostalo" for businesses without one. */
export const otherCountries = "ostalo";
export function countryKey(code: string | null): string {
  return code ?? otherCountries;
}
export function countryPins(pins: MapPin[], key: string): MapPin[] {
  const code = key === otherCountries ? null : key.toUpperCase();
  return pins.filter((pin) => pin.country === code);
}
export function cityPins(pins: MapPin[], city: string): MapPin[] {
  const key = cityKey(city.trim());
  return pins.filter((pin) => pin.city && cityKey(pin.city) === key);
}

/** How many businesses, countries and cities the map holds, for the line under the logo. */
export function mapTotals(pins: MapPin[], countries: MapCountry[]) {
  return {
    businesses: pins.length,
    countries: countries.filter((country) => country.code).length,
    cities: countries.reduce((sum, country) => sum + country.cities.length, 0),
  };
}

export type MapPlace = { latitude: number; longitude: number; count: number; country: string };
/**
 * The lights of the globe: one for each place of about ten kilometres, so a city is one light and
 * not a smear, with the number of businesses there and the country a tap on it opens.
 */
export function mapPlaces(pins: MapPin[]): MapPlace[] {
  const places = new Map<string, { pins: MapPin[] }>();
  for (const pin of pins) {
    const key = `${Math.round(pin.latitude * 10)},${Math.round(pin.longitude * 10)}`;
    const place = places.get(key) ?? { pins: [] };
    place.pins.push(pin);
    places.set(key, place);
  }
  return [...places.values()]
    .map(({ pins: members }) => ({
      ...centre(members),
      count: members.length,
      country: countryKey(members[0]?.country ?? null),
    }))
    .sort((a, b) => b.count - a.count);
}

export type MapBounds = { south: number; west: number; north: number; east: number };
/** The box around a group of points. A single point gets a small box so the map can frame it. */
export function pointBounds(
  points: readonly { latitude: number; longitude: number }[],
): MapBounds | null {
  if (!points.length) return null;
  let south = 90,
    north = -90,
    west = 180,
    east = -180;
  for (const point of points) {
    south = Math.min(south, point.latitude);
    north = Math.max(north, point.latitude);
    west = Math.min(west, point.longitude);
    east = Math.max(east, point.longitude);
  }
  const margin = 0.004;
  if (north - south < margin) {
    south -= margin;
    north += margin;
  }
  if (east - west < margin) {
    west -= margin;
    east += margin;
  }
  return { south, west, north, east };
}

/** The city a person stands in or next to, when it is one of the cities on the map. */
export function nearestCity(
  cities: readonly MapCity[],
  point: LocationPoint,
  withinMetres = 30_000,
): MapCity | null {
  let best: MapCity | null = null;
  let bestDistance = withinMetres;
  for (const city of cities) {
    const distance = distanceMetres(point, city);
    if (distance <= bestDistance) {
      best = city;
      bestDistance = distance;
    }
  }
  return best;
}

/** A point's place on the flat world of the map at a zoom, in pixels (Web Mercator, 256 px tiles). */
export function worldPixel(latitude: number, longitude: number, zoom: number) {
  const size = 256 * 2 ** zoom;
  const sine = Math.min(0.9999, Math.max(-0.9999, Math.sin((latitude * Math.PI) / 180)));
  return {
    x: ((longitude + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * size,
  };
}

/** From this zoom and closer nothing is grouped, so two businesses at one address can be told apart. */
export const ungroupedFromZoom = 19;

export type MapMarker =
  | { type: "pin"; pin: MapPin }
  | {
      type: "group";
      id: string;
      count: number;
      latitude: number;
      longitude: number;
      ids: string[];
    };

/**
 * What the map draws at a zoom: businesses closer together on the screen than `reach` pixels
 * become one group with their number. The chosen business always stays a pin of its own, and at
 * `splitFromZoom` and closer nothing is grouped.
 */
export function mapMarkers(
  pins: readonly MapPin[],
  zoom: number,
  {
    keep,
    reach = 56,
    splitFromZoom = ungroupedFromZoom,
  }: { keep?: string; reach?: number; splitFromZoom?: number } = {},
): MapMarker[] {
  const level = Math.round(zoom);
  if (level >= splitFromZoom) return pins.map((pin) => ({ type: "pin", pin }));
  type Spot = { pin: MapPin; x: number; y: number; column: number; row: number; taken: boolean };
  // A grid of `reach`-sized cells only finds the neighbours; the distance decides the group, so
  // two businesses a step apart are never split by a cell's edge.
  const cells = new Map<string, Spot[]>();
  const spots: Spot[] = [];
  const markers: MapMarker[] = [];
  for (const pin of pins) {
    if (pin.id === keep) {
      markers.push({ type: "pin", pin });
      continue;
    }
    const { x, y } = worldPixel(pin.latitude, pin.longitude, level);
    const spot = {
      pin,
      x,
      y,
      column: Math.floor(x / reach),
      row: Math.floor(y / reach),
      taken: false,
    };
    spots.push(spot);
    const key = `${spot.column}:${spot.row}`;
    cells.set(key, [...(cells.get(key) ?? []), spot]);
  }
  for (const spot of spots) {
    if (spot.taken) continue;
    spot.taken = true;
    const members = [spot.pin];
    for (let column = spot.column - 1; column <= spot.column + 1; column++)
      for (let row = spot.row - 1; row <= spot.row + 1; row++)
        for (const other of cells.get(`${column}:${row}`) ?? []) {
          if (other.taken || Math.hypot(other.x - spot.x, other.y - spot.y) > reach) continue;
          other.taken = true;
          members.push(other.pin);
        }
    if (members.length === 1) markers.push({ type: "pin", pin: spot.pin });
    else
      markers.push({
        type: "group",
        id: `${level}:${spot.pin.id}`,
        count: members.length,
        ...centre(members),
        ids: members.map((pin) => pin.id),
      });
  }
  return markers;
}

/**
 * The zoom a press on a group leads to: the nearest one, closer than `from`, at which its
 * businesses are no longer one mark.
 */
export function groupSplitZoom(members: readonly MapPin[], from: number): number {
  for (let level = Math.round(from) + 1; level < ungroupedFromZoom; level++)
    if (mapMarkers(members, level).length > 1) return level;
  return Math.max(ungroupedFromZoom, Math.round(from));
}

/**
 * How far a view has to move, in pixels, for a point in it to come inside the room its bars
 * leave clear. Nothing when the point is already there.
 */
export function moveIntoRoom(
  point: { x: number; y: number },
  size: { width: number; height: number },
  room: { top: number; right: number; bottom: number; left: number },
): { x: number; y: number } {
  const over = (value: number, low: number, high: number) =>
    value < low ? value - low : value > high ? value - high : 0;
  return {
    x: over(point.x, room.left, Math.max(room.left, size.width - room.right)),
    y: over(point.y, room.top, Math.max(room.top, size.height - room.bottom)),
  };
}

/** Whether a pin answers to what was typed in the map's search field. */
export function pinMatches(pin: MapPin, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = fold([pin.title, pin.kind, pin.category, pin.city].filter(Boolean).join(" "));
  return words.every((word) => text.includes(word));
}

/** The same folding as the directory search: no diacritics, đ as dj, lower case. */
function fold(value: string) {
  return value
    .normalize("NFC")
    .replace(/[đĐ]/g, "dj")
    .replace(/[čćČĆ]/g, "c")
    .replace(/[šŠ]/g, "s")
    .replace(/[žŽ]/g, "z")
    .toLocaleLowerCase("bs");
}

/** "450 m" under a kilometre, "1,2 km" under ten, whole kilometres beyond. */
export function distanceLabel(metres: number, locale: Locale = "bs"): string {
  if (!Number.isFinite(metres) || metres < 0) return "";
  if (metres < 995) return `${Math.max(10, Math.round(metres / 10) * 10)} m`;
  const km = metres / 1000;
  const digits = km < 9.95 ? 1 : 0;
  return `${localNumber(locale, km, { minimumFractionDigits: digits, maximumFractionDigits: digits })} km`;
}
