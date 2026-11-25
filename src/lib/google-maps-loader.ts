"use client";

import { googleMapsKeyMeta, readGoogleMapsKey } from "./google-maps";

// Minimal shapes of the Google Maps JavaScript API used in the app, so no extra type package is needed.
export type LatLngLiteral = { lat: number; lng: number };
export type LatLng = { lat(): number; lng(): number };
export type MapsEvent = { latLng?: LatLng | null };
export type MapsListener = { remove(): void };
export type BoundsLiteral = { south: number; west: number; north: number; east: number };
export type MapPadding = { top: number; right: number; bottom: number; left: number };
export type GoogleMap = {
  setOptions(options: Record<string, unknown>): void;
  setCenter(point: LatLngLiteral): void;
  getCenter(): LatLng | undefined;
  getBounds(): { getNorthEast(): LatLng; getSouthWest(): LatLng } | undefined;
  panTo(point: LatLngLiteral): void;
  getZoom(): number | undefined;
  setZoom(zoom: number): void;
  fitBounds(bounds: BoundsLiteral, padding?: number | MapPadding): void;
  addListener(event: string, handler: (event: MapsEvent) => void): MapsListener;
};
export type GoogleMarker = {
  setPosition(point: LatLngLiteral): void;
  setDraggable(draggable: boolean): void;
  setIcon(icon: unknown): void;
  setMap(map: GoogleMap | null): void;
  getPosition(): LatLng | null | undefined;
  addListener(event: string, handler: () => void): MapsListener;
};
export type GooglePolyline = {
  setPath(path: LatLngLiteral[]): void;
  setOptions(options: Record<string, unknown>): void;
  setMap(map: GoogleMap | null): void;
};
export type OverlayProjection = {
  fromLatLngToDivPixel(point: unknown): { x: number; y: number } | null;
};
export type OverlayBase = {
  setMap(map: GoogleMap | null): void;
  getPanes(): { overlayMouseTarget: HTMLElement; floatPane: HTMLElement } | null;
  getProjection(): OverlayProjection | null;
};
export type GoogleMapsApi = {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMap;
  Marker: new (options: Record<string, unknown>) => GoogleMarker;
  Polyline: new (options: Record<string, unknown>) => GooglePolyline;
  LatLng: new (lat: number, lng: number) => unknown;
  Point: new (x: number, y: number) => unknown;
  Size: new (width: number, height: number) => unknown;
  OverlayView: new () => OverlayBase;
  importLibrary(name: string): Promise<Record<string, unknown>>;
};
type MapsWindow = Window & {
  google?: { maps?: GoogleMapsApi };
  gm_authFailure?: () => void;
  __ahibizzMapsReady?: () => void;
};

let loader: Promise<GoogleMapsApi> | null = null;
let authFailed = false;
const authListeners = new Set<() => void>();

/** The key the server published for this page, or null when Google Maps is off. */
export function pageGoogleMapsKey(): string | null {
  const meta = document.querySelector<HTMLMetaElement>(`meta[name="${googleMapsKeyMeta}"]`);
  return readGoogleMapsKey(meta?.content);
}

/** Called when Google rejects the key (wrong domain, API not enabled); returns an unsubscribe. */
export function onGoogleMapsAuthFailure(listener: () => void) {
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}

/** The languages Google's map labels are asked for; anything else gets Bosnian. */
const mapLanguages = new Set(["bs", "en", "de", "ar", "tr"]);

/**
 * Loads Google Maps once for the page. The language of the labels is fixed by the first load,
 * so it follows the language the page was opened in.
 */
export function loadGoogleMaps(key: string, language = "bs"): Promise<GoogleMapsApi> {
  const host = window as MapsWindow;
  if (authFailed) return Promise.reject(new Error("Google Maps key rejected"));
  if (host.google?.maps?.Map) return Promise.resolve(host.google.maps);
  loader ??= new Promise<GoogleMapsApi>((resolve, reject) => {
    host.__ahibizzMapsReady = () => {
      if (host.google?.maps?.Map) resolve(host.google.maps);
      else reject(new Error("Google Maps did not load"));
    };
    host.gm_authFailure = () => {
      authFailed = true;
      for (const listener of authListeners) listener();
    };
    const script = document.createElement("script");
    const parameters = new URLSearchParams({
      key,
      v: "weekly",
      language: mapLanguages.has(language) ? language : "bs",
      region: "BA",
      callback: "__ahibizzMapsReady",
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${parameters}`;
    script.async = true;
    script.onerror = () => {
      loader = null;
      reject(new Error("Google Maps script failed"));
    };
    document.head.appendChild(script);
  });
  return loader;
}

export type HtmlMarker = {
  element: HTMLElement;
  setPosition(point: LatLngLiteral): void;
  setMap(map: GoogleMap | null): void;
};

/**
 * Something drawn in HTML at a place on the map, so a pin can be the app's own button with the
 * app's own styles. The element is put at the point itself; its styles decide which part of it
 * sits there (the tip of a pin, the middle of a dot). "float" lies above the ordinary pins.
 */
export function htmlMarker(
  maps: GoogleMapsApi,
  element: HTMLElement,
  point: LatLngLiteral,
  layer: "pins" | "float" = "pins",
): HtmlMarker {
  let position = new maps.LatLng(point.lat, point.lng);
  const Overlay = maps.OverlayView as unknown as new () => OverlayBase & {
    onAdd?: () => void;
    draw?: () => void;
    onRemove?: () => void;
  };
  const overlay = new Overlay();
  element.style.position = "absolute";
  const place = () => {
    const pixel = overlay.getProjection()?.fromLatLngToDivPixel(position);
    if (!pixel) return;
    element.style.left = `${pixel.x}px`;
    element.style.top = `${pixel.y}px`;
  };
  overlay.onAdd = () => {
    const panes = overlay.getPanes();
    (layer === "float" ? panes?.floatPane : panes?.overlayMouseTarget)?.appendChild(element);
  };
  overlay.draw = place;
  overlay.onRemove = () => element.remove();
  return {
    element,
    setPosition(next) {
      position = new maps.LatLng(next.lat, next.lng);
      place();
    },
    setMap: (map) => overlay.setMap(map),
  };
}
