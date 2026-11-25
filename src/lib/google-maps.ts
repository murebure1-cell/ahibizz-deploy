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

/** Graphite map for the dark theme. */
export const googleMapsDark: Style[] = [
  { elementType: "geometry", stylers: [{ color: "#14181d" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#98a1ad" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0b0d10" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#252b33" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#323a45" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#1b2027" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0b0d10" }] },
  { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#171c22" }] },
  {
    featureType: "administrative",
    elementType: "geometry.stroke",
    stylers: [{ color: "#3a424c" }],
  },
];
