"use client";

import { useEffect, useRef } from "react";
import type { LocationPoint } from "../../lib/business-location";
import { logoHasTransparency, readBusinessLogoSurface } from "../../lib/business-logo";
import { googleMapsDark, googleMapsLight } from "../../lib/google-maps";
import {
  type GoogleMap,
  type GoogleMapsApi,
  type GoogleMarker,
  loadGoogleMaps,
  type MapsListener,
  type OverlayBase,
  onGoogleMapsAuthFailure,
} from "../../lib/google-maps-loader";
import { safeBusinessImage } from "../../lib/public-business";
import { useT } from "../i18n/LocaleProvider";
import styles from "./location.module.css";

const editPin = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="42" height="52" viewBox="0 0 42 52"><path d="M21 50S4 33.6 4 20.5a17 17 0 0 1 34 0C38 33.6 21 50 21 50z" fill="#3a3f45" stroke="#fff" stroke-width="2"/><circle cx="21" cy="20.5" r="7" fill="#fff"/></svg>',
)}`;
const shopIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 21V7l7-4 7 4v14M9 21v-5h6v5M9 8h1m4 0h1m-6 4h1m4 0h1"/></svg>';

function darkTheme() {
  return document.documentElement.dataset.theme === "dark";
}

/** A pin drawn in HTML so it can carry the business logo, anchored at its tip. */
function createLogoPin(maps: GoogleMapsApi, point: LocationPoint, logoUrl?: string) {
  const element = document.createElement("div");
  element.className = styles.googlePin ?? "";
  element.setAttribute("aria-hidden", "true");
  const badge = document.createElement("span");
  const logo = safeBusinessImage(logoUrl ? { src: logoUrl, alt: "" } : undefined);
  if (logo) {
    const image = document.createElement("img");
    image.alt = "";
    image.addEventListener("error", () => {
      badge.innerHTML = shopIcon;
    });
    image.addEventListener("load", () => {
      // Transparent logos become a white mark on the navy pin; opaque ones sit in a white circle.
      if (readBusinessLogoSurface(image, logo.src) === "empty") {
        badge.innerHTML = shopIcon;
        return;
      }
      if (logoHasTransparency(image)) image.dataset.white = "true";
      else image.dataset.opaque = "true";
    });
    image.src = logo.src;
    badge.appendChild(image);
  } else badge.innerHTML = shopIcon;
  element.appendChild(badge);
  const position = new maps.LatLng(point.latitude, point.longitude);
  const Overlay = maps.OverlayView as unknown as new () => OverlayBase & {
    onAdd?: () => void;
    draw?: () => void;
    onRemove?: () => void;
  };
  const overlay = new Overlay();
  overlay.onAdd = () => overlay.getPanes()?.overlayMouseTarget.appendChild(element);
  overlay.draw = () => {
    const pixel = overlay.getProjection()?.fromLatLngToDivPixel(position);
    if (!pixel) return;
    element.style.left = `${pixel.x}px`;
    element.style.top = `${pixel.y}px`;
  };
  overlay.onRemove = () => element.remove();
  return overlay;
}

/** Google map in the app's palette; reports failure so the caller can fall back to Leaflet. */
export function GoogleLocationMap({
  apiKey,
  point,
  disabled,
  readOnly,
  logoUrl,
  onPoint,
  onUnavailable,
}: {
  apiKey: string;
  point: LocationPoint | null;
  disabled: boolean;
  readOnly: boolean;
  logoUrl?: string;
  onPoint: (point: LocationPoint) => void;
  onUnavailable: () => void;
}) {
  const t = useT();
  const element = useRef<HTMLElement>(null);
  const map = useRef<GoogleMap | null>(null);
  const marker = useRef<GoogleMarker | null>(null);
  const logoPin = useRef<OverlayBase | null>(null);
  const api = useRef<GoogleMapsApi | null>(null);
  const callback = useRef(onPoint);
  callback.current = onPoint;
  const unavailable = useRef(onUnavailable);
  unavailable.current = onUnavailable;
  const locked = useRef(disabled);
  locked.current = disabled;
  const latest = useRef(point);
  latest.current = point;
  const logo = useRef(logoUrl);
  logo.current = logoUrl;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the map is created once per key; placeMarker reads refs.
  useEffect(() => {
    let cancelled = false;
    const listeners: MapsListener[] = [];
    const fail = () => {
      if (!cancelled) unavailable.current();
    };
    const stopAuth = onGoogleMapsAuthFailure(fail);
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
          zoom: selected ? 15 : 7,
          styles: darkTheme() ? googleMapsDark : googleMapsLight,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "cooperative",
          clickableIcons: false,
        });
        map.current = instance;
        listeners.push(
          instance.addListener("click", (event) => {
            if (locked.current || readOnly || !event.latLng) return;
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
      stopAuth();
      themeObserver?.disconnect();
      for (const listener of listeners) listener.remove();
      marker.current?.setMap(null);
      marker.current = null;
      logoPin.current?.setMap(null);
      logoPin.current = null;
      map.current = null;
    };
  }, [apiKey]);

  function placeMarker() {
    const instance = map.current,
      maps = api.current,
      current = latest.current;
    if (!instance || !maps) return;
    marker.current?.setMap(null);
    marker.current = null;
    logoPin.current?.setMap(null);
    logoPin.current = null;
    if (!current) return;
    const position = { lat: current.latitude, lng: current.longitude };
    if (readOnly) {
      // Public profiles show the business logo inside the pin.
      logoPin.current = createLogoPin(maps, current, logo.current);
      logoPin.current.setMap(instance);
    } else {
      marker.current = new maps.Marker({
        map: instance,
        position,
        icon: editPin,
        title: t("Odabrana lokacija"),
        draggable: !locked.current,
      });
      marker.current.addListener("dragend", () => {
        const moved = marker.current?.getPosition();
        if (moved && !locked.current)
          callback.current({ latitude: moved.lat(), longitude: moved.lng() });
      });
    }
    instance.setCenter(position);
    if ((instance.getZoom() ?? 0) < 14) instance.setZoom(15);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: placeMarker reads the latest values from refs.
  useEffect(placeMarker, [point, disabled, readOnly, logoUrl]);

  return (
    <div className={styles.mapWrap}>
      <section ref={element} className={styles.map} aria-label={t("Karta lokacije djelatnosti")} />
    </div>
  );
}
