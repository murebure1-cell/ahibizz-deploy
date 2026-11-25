/** Google Maps JavaScript API keys are public by design; they are restricted by HTTP referrer. */
export function readGoogleMapsKey(value: string | undefined): string | null {
  const key = value?.trim() ?? "";
  return /^AIza[0-9A-Za-z_-]{35}$/.test(key) ? key : null;
}

export const googleMapsKeyMeta = "ahibizz-google-maps-key";
export const googleMapIdMeta = "ahibizz-google-map-id";

/** A Google Cloud Map ID (map style); only letters, digits, dash and underscore. */
export function readGoogleMapId(value: string | undefined): string | null {
  const id = value?.trim() ?? "";
  return /^[A-Za-z0-9_-]{4,64}$/.test(id) ? id : null;
}

export type MapStyle = {
  featureType?: string;
  elementType?: string;
  stylers: Record<string, string | number>[];
};
/** "streets" is the city map with its roads; "country" is the quiet outline of countries. */
export type MapStyleKind = "streets" | "country";

/**
 * The map colours of the two themes, as drawn: graphite ground with darker water at night, a grey
 * ground with white streets by day. Google's styling takes no transparency, so the hairlines of
 * the drawings are given here as the solid colour they make on their ground.
 */
export const mapPalette = {
  dark: {
    land: "#11151a",
    water: "#0c1a23",
    road: "#1e252d",
    mainRoad: "#2a323c",
    park: "#11211a",
    label: "#77828f",
    sea: "#090e13",
    country: "#1a2029",
    border: "#3f454e",
  },
  light: {
    land: "#e7eaee",
    water: "#c5dcea",
    road: "#ffffff",
    mainRoad: "#ffffff",
    park: "#d3e6d8",
    label: "#5c6672",
    sea: "#cfdfea",
    country: "#f7f8fa",
    border: "#c9cdd3",
  },
} as const;

/** What the map shows before its first tiles arrive, so a slow load is not a flash of white. */
export function mapGround(dark: boolean, kind: MapStyleKind): string {
  const colours = dark ? mapPalette.dark : mapPalette.light;
  return kind === "country" ? colours.sea : colours.land;
}

export function mapStyles(dark: boolean, kind: MapStyleKind): MapStyle[] {
  const c = dark ? mapPalette.dark : mapPalette.light;
  if (kind === "country")
    return [
      { elementType: "geometry", stylers: [{ color: c.country }] },
      { elementType: "labels", stylers: [{ visibility: "off" }] },
      { featureType: "water", elementType: "geometry", stylers: [{ color: c.sea }] },
      { featureType: "road", stylers: [{ visibility: "off" }] },
      { featureType: "poi", stylers: [{ visibility: "off" }] },
      { featureType: "transit", stylers: [{ visibility: "off" }] },
      { featureType: "administrative", elementType: "geometry", stylers: [{ visibility: "off" }] },
      {
        featureType: "administrative.country",
        elementType: "geometry.stroke",
        stylers: [{ visibility: "on" }, { color: c.border }, { weight: 1 }],
      },
      {
        featureType: "administrative.country",
        elementType: "labels.text",
        stylers: [{ visibility: "on" }],
      },
      {
        featureType: "administrative.country",
        elementType: "labels.text.fill",
        stylers: [{ color: c.label }],
      },
      {
        featureType: "administrative.country",
        elementType: "labels.text.stroke",
        stylers: [{ color: c.country }],
      },
      { featureType: "water", elementType: "labels.text", stylers: [{ visibility: "on" }] },
      { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: c.label }] },
      { featureType: "water", elementType: "labels.text.stroke", stylers: [{ color: c.sea }] },
    ];
  return [
    { elementType: "geometry", stylers: [{ color: c.land }] },
    { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
    { elementType: "labels.text.fill", stylers: [{ color: c.label }] },
    { elementType: "labels.text.stroke", stylers: [{ color: c.land }] },
    // Other businesses' places stay off the map; the parks stay as ground.
    { featureType: "poi", stylers: [{ visibility: "off" }] },
    {
      featureType: "poi.park",
      elementType: "geometry",
      stylers: [{ visibility: "on" }, { color: c.park }],
    },
    { featureType: "transit", stylers: [{ visibility: "off" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: c.road }] },
    { featureType: "road", elementType: "geometry.stroke", stylers: [{ visibility: "off" }] },
    { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: c.mainRoad }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: c.mainRoad }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: c.water }] },
    { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: c.land }] },
    {
      featureType: "administrative",
      elementType: "geometry.stroke",
      stylers: [{ color: c.border }],
    },
    { featureType: "administrative.land_parcel", stylers: [{ visibility: "off" }] },
  ];
}

/** Below this zoom the map is a map of countries, from it on a map of streets. */
export const streetsFromZoom = 10;
export function mapStyleKind(zoom: number | undefined): MapStyleKind {
  return (zoom ?? 0) >= streetsFromZoom ? "streets" : "country";
}
