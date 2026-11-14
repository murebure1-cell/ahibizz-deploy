/** Coordinates are never coerced from strings or completed with zero defaults. */
export type LocationPoint = Readonly<{
  latitude: number;
  longitude: number;
  /** Browser-reported horizontal accuracy in metres, when actually supplied. */
  accuracy?: number;
}>;

export type BusinessLocationResult = Readonly<{
  id: string;
  label: string;
  addressLine: string | null;
  city: string | null;
  countryCode: string | null;
  point: LocationPoint;
}>;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isLocationPoint(value: unknown): value is LocationPoint {
  return (
    record(value) &&
    typeof value.latitude === "number" &&
    Number.isFinite(value.latitude) &&
    value.latitude >= -90 &&
    value.latitude <= 90 &&
    typeof value.longitude === "number" &&
    Number.isFinite(value.longitude) &&
    value.longitude >= -180 &&
    value.longitude <= 180 &&
    (value.accuracy === undefined ||
      (typeof value.accuracy === "number" &&
        Number.isFinite(value.accuracy) &&
        value.accuracy >= 0))
  );
}

/** Read a stored pair or browser position; an unknown/incomplete pair remains null. */
export function initialLocationPoint(
  latitude: unknown,
  longitude: unknown,
  accuracy?: unknown,
): LocationPoint | null {
  const point = { latitude, longitude, ...(accuracy === undefined ? {} : { accuracy }) };
  if (!isLocationPoint(point)) return null;
  return { ...point };
}

/** Provider labels are bounded plain text, never HTML. Do not render them with innerHTML. */
function providerText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const bounded = Array.from(value).slice(0, 4096).join("");
  const plain = bounded.replace(/<[^>]*>/g, " ").replace(/[<>]/g, "");
  const safe = Array.from(plain)
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 ||
        (code >= 127 && code <= 159) ||
        (code >= 0x202a && code <= 0x202e) ||
        (code >= 0x2066 && code <= 0x2069)
        ? " "
        : character;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(safe).slice(0, max).join("").trim() || null;
}

function countryCode(value: unknown): string | null {
  if (typeof value !== "string" || !/^[a-z]{2}$/i.test(value.trim())) return null;
  return value.trim().toUpperCase();
}

function resultId(
  properties: Record<string, unknown>,
  point: LocationPoint,
  label: string,
): string {
  const type = typeof properties.osm_type === "string" ? properties.osm_type.toUpperCase() : "";
  const value = properties.osm_id;
  const id =
    typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : value;
  if (["N", "W", "R"].includes(type) && typeof id === "string" && /^[1-9][0-9]{0,19}$/.test(id))
    return `osm:${type}:${id}`;
  return `point:${point.longitude},${point.latitude}:${Array.from(label).slice(0, 80).join("")}`;
}

/** Photon GeoJSON positions are [longitude, latitude], not the UI's named pair. */
export function parsePhotonResults(input: unknown): BusinessLocationResult[] {
  if (!record(input) || input.type !== "FeatureCollection" || !Array.isArray(input.features))
    return [];
  const results: BusinessLocationResult[] = [];
  const seen = new Set<string>();
  // Bound both accepted results and malformed provider entries inspected.
  for (const feature of input.features.slice(0, 100)) {
    if (
      !record(feature) ||
      feature.type !== "Feature" ||
      !record(feature.geometry) ||
      feature.geometry.type !== "Point" ||
      !record(feature.properties)
    )
      continue;
    const coordinates = feature.geometry.coordinates;
    if (
      !Array.isArray(coordinates) ||
      coordinates.length < 2 ||
      coordinates.length > 3 ||
      coordinates.some((value) => typeof value !== "number" || !Number.isFinite(value))
    )
      continue;
    const point = initialLocationPoint(coordinates[1], coordinates[0]);
    if (!point) continue;
    const properties = feature.properties;
    const street = providerText(properties.street, 180);
    const house = providerText(properties.housenumber, 20);
    const addressLine = street
      ? providerText([street, house].filter(Boolean).join(" "), 200)
      : null;
    const settlement =
      properties.osm_key === "place" &&
      typeof properties.osm_value === "string" &&
      ["city", "town", "village", "hamlet"].includes(properties.osm_value);
    const city =
      providerText(properties.city, 100) ??
      (settlement ? providerText(properties.name, 100) : null);
    const parts = [
      providerText(properties.name, 160),
      addressLine,
      city,
      providerText(properties.state, 100),
      providerText(properties.country, 100),
    ];
    const unique = new Map<string, string>();
    for (const part of parts)
      if (part && !unique.has(part.toLowerCase())) unique.set(part.toLowerCase(), part);
    const label = providerText([...unique.values()].join(", "), 240);
    if (!label) continue;
    const id = resultId(properties, point, label);
    if (seen.has(id)) continue;
    seen.add(id);
    results.push({
      id,
      label,
      addressLine,
      city,
      countryCode: countryCode(properties.countrycode),
      point,
    });
    if (results.length === 10) break;
  }
  return results;
}
