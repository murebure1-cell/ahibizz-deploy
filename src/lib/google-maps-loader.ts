"use client";

import { readBusinessLogoSurface } from "./business-logo";
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

/**
 * Draws a business logo into a round badge as a data URL, so map markers show it at a fixed size.
 * Logos are same-origin, so the canvas stays readable; on any failure the caller uses a plain pin.
 */
export function logoBadge(src: string, size = 56): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      try {
        // Light (e.g. white) logos get the navy surface used on cards; empty images use a plain pin.
        const surface = readBusinessLogoSurface(image, src);
        if (surface === "empty") throw new Error("Empty logo");
        const fill = surface === "dark" ? "#173047" : "#ffffff";
        const scale = window.devicePixelRatio > 1 ? 2 : 1;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size * scale;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("No canvas");
        context.scale(scale, scale);
        const radius = size / 2;
        context.beginPath();
        context.arc(radius, radius, radius - 1, 0, Math.PI * 2);
        context.fillStyle = fill;
        context.fill();
        context.lineWidth = 3;
        context.strokeStyle = "#173047";
        context.stroke();
        context.save();
        context.beginPath();
        context.arc(radius, radius, radius - 6, 0, Math.PI * 2);
        context.clip();
        const inner = size - 12;
        const ratio = Math.min(inner / image.naturalWidth, inner / image.naturalHeight);
        const width = image.naturalWidth * ratio,
          height = image.naturalHeight * ratio;
        context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
        context.restore();
        resolve(canvas.toDataURL("image/png"));
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => reject(new Error("Logo failed"));
    image.src = src;
  });
}
