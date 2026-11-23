/** Google Maps JavaScript API keys are public by design; they are restricted by HTTP referrer. */
export function readGoogleMapsKey(value: string | undefined): string | null {
  const key = value?.trim() ?? "";
  return /^AIza[0-9A-Za-z_-]{35}$/.test(key) ? key : null;
}

export const googleMapsKeyMeta = "ahibizz-google-maps-key";

type Style = { featureType?: string; elementType?: string; stylers: Record<string, string>[] };

/** Light slate map in the app's grey-blue, with business clutter (POI) hidden. */
export const googleMapsLight: Style[] = [
  { elementType: "geometry", stylers: [{ color: "#e7ecf1" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#566b7d" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#f4f6f8" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#f8fafc" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#d3dce5" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#d5dee7" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#b8c9d8" }] },
  { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#dde5ec" }] },
  {
    featureType: "administrative",
    elementType: "geometry.stroke",
    stylers: [{ color: "#a9b8c6" }],
  },
];

/** Deep navy map for the dark theme. */
export const googleMapsDark: Style[] = [
  { elementType: "geometry", stylers: [{ color: "#142739" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8ea3b7" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0e1d2b" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1f3a55" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#2a4b6b" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#16304a" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0b1a29" }] },
  { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#173049" }] },
  {
    featureType: "administrative",
    elementType: "geometry.stroke",
    stylers: [{ color: "#2c4862" }],
  },
];
