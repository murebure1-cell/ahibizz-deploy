import { initialLocationPoint } from "./business-location";
import type { BusinessMediaSummary } from "./business-media";
import { publicBusinessImages } from "./public-business";

export type MapPin = {
  id: string;
  title: string;
  city: string | null;
  latitude: number;
  longitude: number;
  logo: string | null;
};
export type MapCity = { name: string; count: number; latitude: number; longitude: number };

type PinSource = {
  id: string;
  title: string;
  city: string | null;
  latitude: number | string;
  longitude: number | string;
  media?: unknown;
};

/** Public map pins: only valid coordinates, the title, city and the public logo URL. */
export function mapPins(rows: PinSource[]): MapPin[] {
  return rows.flatMap((row) => {
    const point = initialLocationPoint(Number(row.latitude), Number(row.longitude));
    if (!point) return [];
    // publicBusinessImages validates the media summary and returns nothing for bad data.
    const logo =
      publicBusinessImages(row.id, row.media as BusinessMediaSummary | undefined).logo?.src ?? null;
    return [
      {
        id: row.id,
        title: row.title,
        city: row.city?.trim() || null,
        latitude: point.latitude,
        longitude: point.longitude,
        logo,
      },
    ];
  });
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
    .map(({ name, pins: members }) => ({
      name,
      count: members.length,
      latitude: members.reduce((sum, pin) => sum + pin.latitude, 0) / members.length,
      longitude: members.reduce((sum, pin) => sum + pin.longitude, 0) / members.length,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "bs"));
}
