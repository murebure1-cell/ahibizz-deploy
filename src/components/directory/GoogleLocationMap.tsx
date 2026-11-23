"use client";

import { useEffect, useRef } from "react";
import type { LocationPoint } from "../../lib/business-location";
import { googleMapsDark, googleMapsLight } from "../../lib/google-maps";
import styles from "./location.module.css";

// Minimal shapes of the Google Maps JavaScript API used here, so no extra type package is needed.
type LatLng = { lat(): number; lng(): number };
type MapsEvent = { latLng?: LatLng | null };
type Listener = { remove(): void };
type GoogleMap = {
  setOptions(options: Record<string, unknown>): void;
  setCenter(point: { lat: number; lng: number }): void;
  getZoom(): number | undefined;
  setZoom(zoom: number): void;
  addListener(event: string, handler: (event: MapsEvent) => void): Listener;
};
type GoogleMarker = {
  setPosition(point: { lat: number; lng: number }): void;
  setDraggable(draggable: boolean): void;
  setMap(map: GoogleMap | null): void;
  getPosition(): LatLng | null | undefined;
  addListener(event: string, handler: () => void): Listener;
};
type GoogleMapsApi = {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMap;
  Marker: new (options: Record<string, unknown>) => GoogleMarker;
};
type MapsWindow = Window & {
  google?: { maps?: GoogleMapsApi };
  gm_authFailure?: () => void;
  __ahibizzMapsReady?: () => void;
};

let loader: Promise<GoogleMapsApi> | null = null;
let authFailed = false;
const authListeners = new Set<() => void>();

function loadGoogleMaps(key: string): Promise<GoogleMapsApi> {
  const host = window as MapsWindow;
  if (authFailed) return Promise.reject(new Error("Google Maps key rejected"));
  if (host.google?.maps?.Map) return Promise.resolve(host.google.maps);
  loader ??= new Promise<GoogleMapsApi>((resolve, reject) => {
    host.__ahibizzMapsReady = () => {
      if (host.google?.maps?.Map) resolve(host.google.maps);
      else reject(new Error("Google Maps did not load"));
    };
    // Google calls this when the key is invalid or not allowed for this site.
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

const pinIcon = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="42" height="50" viewBox="0 0 42 50"><path d="M21 48s17-15.2 17-28A17 17 0 0 0 4 20c0 12.8 17 28 17 28z" fill="#173047" stroke="#e9ca8a" stroke-width="2.5"/><path d="M14 30V18l7-4 7 4v12m-10 0v-5h6v5" fill="none" stroke="#e9ca8a" stroke-width="1.8" stroke-linejoin="round"/></svg>',
)}`;

function darkTheme() {
  return document.documentElement.dataset.theme === "dark";
}

/** Google map in the app's grey-blue; reports failure so the caller can fall back to Leaflet. */
export function GoogleLocationMap({
  apiKey,
  point,
  disabled,
  readOnly,
  onPoint,
  onUnavailable,
}: {
  apiKey: string;
  point: LocationPoint | null;
  disabled: boolean;
  readOnly: boolean;
  onPoint: (point: LocationPoint) => void;
  onUnavailable: () => void;
}) {
  const element = useRef<HTMLElement>(null);
  const map = useRef<GoogleMap | null>(null);
  const marker = useRef<GoogleMarker | null>(null);
  const api = useRef<GoogleMapsApi | null>(null);
  const callback = useRef(onPoint);
  callback.current = onPoint;
  const unavailable = useRef(onUnavailable);
  unavailable.current = onUnavailable;
  const locked = useRef(disabled);
  locked.current = disabled;
  const latest = useRef(point);
  latest.current = point;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the map is created once per key; placeMarker reads refs.
  useEffect(() => {
    let cancelled = false;
    const listeners: Listener[] = [];
    const fail = () => {
      if (!cancelled) unavailable.current();
    };
    authListeners.add(fail);
    let themeObserver: MutationObserver | undefined;
    loadGoogleMaps(apiKey)
      .then((maps) => {
        if (cancelled || !element.current) return;
        api.current = maps;
        const selected = latest.current;
        const instance = new maps.Map(element.current, {
          center: selected
            ? { lat: selected.latitude, lng: selected.longitude }
            : { lat: 44.1, lng: 17.8 },
          zoom: selected ? 16 : 7,
          styles: darkTheme() ? googleMapsDark : googleMapsLight,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "cooperative",
          clickableIcons: false,
        });
        map.current = instance;
        listeners.push(
          instance.addListener("click", (event) => {
            if (locked.current || !event.latLng) return;
            callback.current({ latitude: event.latLng.lat(), longitude: event.latLng.lng() });
          }),
        );
        themeObserver = new MutationObserver(() =>
          instance.setOptions({ styles: darkTheme() ? googleMapsDark : googleMapsLight }),
        );
        themeObserver.observe(document.documentElement, { attributeFilter: ["data-theme"] });
        placeMarker();
      })
      .catch(fail);
    return () => {
      cancelled = true;
      authListeners.delete(fail);
      themeObserver?.disconnect();
      for (const listener of listeners) listener.remove();
      marker.current?.setMap(null);
      marker.current = null;
      map.current = null;
    };
  }, [apiKey]);

  function placeMarker() {
    const instance = map.current,
      maps = api.current,
      current = latest.current;
    if (!instance || !maps) return;
    if (!current) {
      marker.current?.setMap(null);
      marker.current = null;
      return;
    }
    const position = { lat: current.latitude, lng: current.longitude };
    if (!marker.current) {
      marker.current = new maps.Marker({
        map: instance,
        position,
        icon: pinIcon,
        title: "Odabrana lokacija",
        draggable: !locked.current && !readOnly,
        clickable: !readOnly,
      });
      marker.current.addListener("dragend", () => {
        const moved = marker.current?.getPosition();
        if (moved && !locked.current)
          callback.current({ latitude: moved.lat(), longitude: moved.lng() });
      });
    } else marker.current.setPosition(position);
    marker.current.setDraggable(!locked.current && !readOnly);
    instance.setCenter(position);
    if ((instance.getZoom() ?? 0) < 15) instance.setZoom(16);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: placeMarker reads the latest values from refs.
  useEffect(placeMarker, [point, disabled, readOnly]);

  return (
    <div className={styles.mapWrap}>
      <section ref={element} className={styles.map} aria-label="Karta lokacije djelatnosti" />
    </div>
  );
}
