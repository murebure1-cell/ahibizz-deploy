import { initialLocationPoint } from "./business-location";
import type { BusinessMediaSummary } from "./business-media";
import { publicBusinessImages } from "./public-business";

export type MapPin = {
  id: string;
  title: string;
  city: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  logo: string | null;
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
};

/** Public map pins: only valid coordinates, the title, city, country and the public logo URL. */
export function mapPins(rows: PinSource[]): MapPin[] {
  return rows.flatMap((row) => {
    const point = initialLocationPoint(Number(row.latitude), Number(row.longitude));
    if (!point) return [];
    // publicBusinessImages validates the media summary and returns nothing for bad data.
    const logo =
      publicBusinessImages(row.id, row.media as BusinessMediaSummary | undefined).logo?.src ?? null;
    const country = row.countryCode?.trim().toUpperCase() ?? "";
    return [
      {
        id: row.id,
        title: row.title,
        city: row.city?.trim() || null,
        country: /^[A-Z]{2}$/.test(country) ? country : null,
        latitude: point.latitude,
        longitude: point.longitude,
        logo,
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

/** Cities with their business count and the average point, for "fly to city" buttons. */
export function mapCities(pins: MapPin[]): MapCity[] {
  const groups = new Map<string, { name: string; pins: MapPin[] }>();
  for (const pin of pins) {
    if (!pin.city) continue;
    const key = pin.city.toLocaleLowerCase("bs");
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
