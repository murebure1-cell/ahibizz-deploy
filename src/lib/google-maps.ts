/** Google Maps JavaScript API keys are public by design; they are restricted by HTTP referrer. */
export function readGoogleMapsKey(value: string | undefined): string | null {
  const key = value?.trim() ?? "";
  return /^AIza[0-9A-Za-z_-]{35}$/.test(key) ? key : null;
}

export const googleMapsKeyMeta = "ahibizz-google-maps-key";

type Style = { featureType?: string; elementType?: string; stylers: Record<string, string>[] };

/** Light silver map: neutral grey ground, white streets, grey labels, business clutter (POI) hidden. */
export const googleMapsLight: Style[] = [
  { elementType: "geometry", stylers: [{ color: "#f2f2f2" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#7a7a7a" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#f5f5f5" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#dadada" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#e4e4e4" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#d6d6d6" }] },
  { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#ececec" }] },
  {
    featureType: "administrative.neighborhood",
    elementType: "labels.text.fill",
    stylers: [{ color: "#5c5c5c" }],
  },
  {
    featureType: "administrative.locality",
    elementType: "labels.text.fill",
    stylers: [{ color: "#4a4a4a" }],
  },
  {
    featureType: "administrative",
    elementType: "geometry.stroke",
    stylers: [{ color: "#c9c9c9" }],
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
