"use client";

import { logoHasTransparency, readBusinessLogoSurface } from "./business-logo";
import { googleMapsKeyMeta, readGoogleMapsKey } from "./google-maps";

// Minimal shapes of the Google Maps JavaScript API used in the app, so no extra type package is needed.
export type LatLng = { lat(): number; lng(): number };
export type MapsEvent = { latLng?: LatLng | null };
export type MapsListener = { remove(): void };
export type GoogleMap = {
  setOptions(options: Record<string, unknown>): void;
  setCenter(point: { lat: number; lng: number }): void;
  getZoom(): number | undefined;
  setZoom(zoom: number): void;
  addListener(event: string, handler: (event: MapsEvent) => void): MapsListener;
};
export type GoogleMarker = {
  setPosition(point: { lat: number; lng: number }): void;
  setDraggable(draggable: boolean): void;
  setMap(map: GoogleMap | null): void;
  getPosition(): LatLng | null | undefined;
  addListener(event: string, handler: () => void): MapsListener;
};
export type OverlayProjection = {
  fromLatLngToDivPixel(point: unknown): { x: number; y: number } | null;
};
export type OverlayBase = {
  setMap(map: GoogleMap | null): void;
  getPanes(): { overlayMouseTarget: HTMLElement } | null;
  getProjection(): OverlayProjection | null;
};
export type GoogleMapsApi = {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMap;
  Marker: new (options: Record<string, unknown>) => GoogleMarker;
  LatLng: new (lat: number, lng: number) => unknown;
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

export function loadGoogleMaps(key: string): Promise<GoogleMapsApi> {
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
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&language=bs&region=BA&callback=__ahibizzMapsReady`;
    script.async = true;
    script.onerror = () => {
      loader = null;
      reject(new Error("Google Maps script failed"));
    };
    document.head.appendChild(script);
  });
  return loader;
}

/** Navy with a white rim: strong contrast for white logos on light and dark maps alike. */
export const mapPinColour = "#1b3a57";
const pinWidth = 46;
const pinHeight = 58;

function pinCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = pinWidth;
  canvas.height = pinHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No canvas");
  const radius = pinWidth / 2 - 2;
  const centre = pinWidth / 2;
  // Drop shape: a circle with a point at the bottom, the tip is the business location.
  context.beginPath();
  context.arc(centre, radius + 2, radius, Math.PI * 0.82, Math.PI * 0.18);
  context.lineTo(centre, pinHeight - 2);
  context.closePath();
  context.fillStyle = mapPinColour;
  context.fill();
  context.lineWidth = 2.5;
  context.strokeStyle = "#ffffff";
  context.stroke();
  return { canvas, context, centre, cy: radius + 2, inner: radius - 7 };
}

/** Plain pin with a white shop symbol, used while a logo loads or when there is none. */
export function plainMapPin(): string {
  const { canvas, context, centre, cy } = pinCanvas();
  context.strokeStyle = "#ffffff";
  context.lineWidth = 1.8;
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(centre - 7, cy + 8);
  context.lineTo(centre - 7, cy - 3);
  context.lineTo(centre, cy - 8);
  context.lineTo(centre + 7, cy - 3);
  context.lineTo(centre + 7, cy + 8);
  context.moveTo(centre - 3, cy + 8);
  context.lineTo(centre - 3, cy + 3);
  context.lineTo(centre + 3, cy + 3);
  context.lineTo(centre + 3, cy + 8);
  context.stroke();
  return canvas.toDataURL("image/png");
}

/**
 * Map pin with the business logo. Logos with transparency are drawn as a white silhouette on the
 * navy pin; logos with their own background keep their colours inside a white circle.
 * Logos are same-origin, so the canvas stays readable; on failure the caller keeps the plain pin.
 */
export function logoMapPin(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      try {
        if (readBusinessLogoSurface(image, src) === "empty") throw new Error("Empty logo");
        const transparent = logoHasTransparency(image);
        const { canvas, context, centre, cy, inner } = pinCanvas();
        const box = inner * 2 - (transparent ? 4 : 0);
        const ratio = Math.min(box / image.naturalWidth, box / image.naturalHeight);
        const width = image.naturalWidth * ratio,
          height = image.naturalHeight * ratio;
        if (transparent) {
          // Paint the logo shape white on a scratch canvas, then place it on the pin.
          const mark = document.createElement("canvas");
          mark.width = Math.ceil(width);
          mark.height = Math.ceil(height);
          const markContext = mark.getContext("2d");
          if (!markContext) throw new Error("No canvas");
          markContext.drawImage(image, 0, 0, width, height);
          markContext.globalCompositeOperation = "source-in";
          markContext.fillStyle = "#ffffff";
          markContext.fillRect(0, 0, mark.width, mark.height);
          context.drawImage(mark, centre - width / 2, cy - height / 2);
        } else {
          context.save();
          context.beginPath();
          context.arc(centre, cy, inner, 0, Math.PI * 2);
          context.fillStyle = "#ffffff";
          context.fill();
          context.clip();
          context.drawImage(image, centre - width / 2, cy - height / 2, width, height);
          context.restore();
        }
        resolve(canvas.toDataURL("image/png"));
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => reject(new Error("Logo failed"));
    image.src = src;
  });
}
