"use client";

import type * as Leaflet from "leaflet";
import { useEffect, useRef, useState } from "react";
import type { LocationPoint } from "../../lib/business-location";
import { isCurrentBusinessLogoImage, readBusinessLogoSurface } from "../../lib/business-logo";
import { safeBusinessImage } from "../../lib/public-business";
import "leaflet/dist/leaflet.css";
import { pageGoogleMapsKey } from "../../lib/google-maps-loader";
import { useT } from "../i18n/LocaleProvider";
import { GoogleLocationMap } from "./GoogleLocationMap";
import styles from "./location.module.css";
import { ProfileMap3D } from "./ProfileMap3D";

type MapProps = {
  point: LocationPoint | null;
  disabled: boolean;
  readOnly?: boolean;
  logoUrl?: string;
  onPoint: (point: LocationPoint) => void;
};

/**
 * Uses Google Maps when the server publishes a key, and the OpenStreetMap (Leaflet) map otherwise
 * or whenever Google refuses the key or cannot load.
 */
export function LocationMap(props: MapProps) {
  const t = useT();
  const [googleKey, setGoogleKey] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    setGoogleKey(pageGoogleMapsKey());
  }, []);
  if (googleKey === undefined)
    return (
      <div className={styles.mapWrap}>
        <section className={styles.map} aria-label={t("Karta lokacije djelatnosti")} />
      </div>
    );
  // Public profiles use the tilted 3D map; the editor keeps the flat map with a draggable pin.
  if (googleKey && props.readOnly && props.point)
    return (
      <ProfileMap3D
        apiKey={googleKey}
        point={props.point}
        logoUrl={props.logoUrl}
        onUnavailable={() => setGoogleKey(null)}
      />
    );
  if (googleKey)
    return (
      <GoogleLocationMap
        apiKey={googleKey}
        point={props.point}
        disabled={props.disabled}
        readOnly={props.readOnly ?? false}
        logoUrl={props.logoUrl}
        onPoint={props.onPoint}
        onUnavailable={() => setGoogleKey(null)}
      />
    );
  return <LeafletLocationMap {...props} />;
}

function LeafletLocationMap({ point, disabled, readOnly = false, logoUrl, onPoint }: MapProps) {
  const t = useT();
  const element = useRef<HTMLElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const marker = useRef<Leaflet.Marker | null>(null);
  const library = useRef<typeof Leaflet | null>(null);
  const callback = useRef(onPoint);
  callback.current = onPoint;
  const locked = useRef(disabled);
  locked.current = disabled;
  const latest = useRef(point);
  latest.current = point;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | undefined;
    void import("leaflet")
      .then((L) => {
        if (cancelled || !element.current) return;
        library.current = L;
        const selected = latest.current;
        const instance = L.map(element.current, {
          scrollWheelZoom: false,
          attributionControl: true,
        }).setView(
          selected ? [selected.latitude, selected.longitude] : [44.1, 17.8],
          selected ? 16 : 7,
        );
        map.current = instance;
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
          referrerPolicy: "strict-origin-when-cross-origin",
        })
          .on("tileerror", () => {
            if (!cancelled) setFailed(true);
          })
          .on("tileload", () => {
            if (!cancelled) setFailed(false);
          })
          .addTo(instance);
        instance.on("click", (event: Leaflet.LeafletMouseEvent) => {
          const p = event.latlng.wrap();
          if (!locked.current) callback.current({ latitude: p.lat, longitude: p.lng });
        });
        observer = new ResizeObserver(() => instance.invalidateSize({ pan: false }));
        observer.observe(element.current);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      observer?.disconnect();
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
  }, []);
  useEffect(() => {
    const instance = map.current,
      L = library.current;
    if (!ready || !instance || !L) return;
    if (!point) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    const latlng: Leaflet.LatLngExpression = [point.latitude, point.longitude];
    const safeLogo = safeBusinessImage(logoUrl ? { src: logoUrl, alt: "" } : undefined, true);
    const content = document.createElement("span");
    content.setAttribute("aria-hidden", "true");
    const showDefaultIcon = () => {
      content.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 21V7l7-4 7 4v14M9 21v-5h6v5M9 8h1m4 0h1m-6 4h1m4 0h1"/></svg>';
    };
    let clearLogoListeners: (() => void) | undefined;
    if (safeLogo) {
      const image = document.createElement("img");
      image.alt = "";
      image.dataset.logoSurface = "neutral";
      let active = true;
      const inspect = () => {
        if (!active) return;
        const surface = readBusinessLogoSurface(image, safeLogo.src);
        if (surface === "empty") showDefaultIcon();
        else image.dataset.logoSurface = surface ?? "neutral";
      };
      const unavailable = () => {
        if (active && isCurrentBusinessLogoImage(image, safeLogo.src)) showDefaultIcon();
      };
      image.addEventListener("load", inspect);
      image.addEventListener("error", unavailable);
      image.src = safeLogo.src;
      content.appendChild(image);
      if (image.complete) inspect();
      clearLogoListeners = () => {
        active = false;
        image.removeEventListener("load", inspect);
        image.removeEventListener("error", unavailable);
      };
    } else showDefaultIcon();
    const icon = L.divIcon({
      className: styles.marker,
      html: content,
      iconSize: [42, 50],
      iconAnchor: [21, 48],
    });
    if (!marker.current) {
      marker.current = L.marker(latlng, {
        icon,
        draggable: !disabled,
        title: "Odabrana lokacija",
        keyboard: !readOnly,
        interactive: !readOnly,
      }).addTo(instance);
      marker.current.on("dragend", () => {
        const p = marker.current?.getLatLng().wrap();
        if (p && !locked.current) callback.current({ latitude: p.lat, longitude: p.lng });
      });
    } else {
      marker.current.setLatLng(latlng);
      marker.current.setIcon(icon);
    }
    if (disabled) marker.current.dragging?.disable();
    else marker.current.dragging?.enable();
    instance.setView(latlng, Math.max(instance.getZoom(), 15), { animate: false });
    return clearLogoListeners;
  }, [point, ready, disabled, readOnly, logoUrl]);
  return (
    <div className={styles.mapWrap}>
      <section ref={element} className={styles.map} aria-label={t("Karta lokacije djelatnosti")} />
      {failed && (
        <p className={styles.mapError}>
          {t("Karta trenutno nije dostupna. Pokušaj ponovo kasnije.")}
        </p>
      )}
    </div>
  );
}
