"use client";

import { useEffect, useRef, useState } from "react";
import type { LocationPoint } from "../../lib/business-location";
import type { GoogleMarker, MapsListener } from "../../lib/google-maps-loader";
import { categoryIcon } from "../../lib/home";
import { Icon } from "../Icon";
import { useT } from "../i18n/LocaleProvider";
import { OnMap } from "../map/OnMap";
import { useStyledMap } from "../map/useStyledMap";
import styles from "./location.module.css";

type MapProps = {
  point: LocationPoint | null;
  disabled: boolean;
  readOnly?: boolean;
  /** The category of the business, for the sign in the pin of a public profile. */
  category?: string | null;
  onPoint: (point: LocationPoint) => void;
};

/**
 * The pin an owner drags to the right place, drawn in the theme's own colours: the accent in a
 * ring, a dot in its middle and a tip that stands on the point.
 */
function editPin() {
  const style = getComputedStyle(document.documentElement);
  const colour = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;
  const accent = colour("--ui-accent", "#0e7a6d");
  const dot = colour("--ui-on-accent", "#ffffff");
  const ring =
    document.documentElement.dataset.theme === "dark" ? colour("--ui-page", "#0b0d10") : "#ffffff";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="46" height="58" viewBox="0 0 46 58"><rect x="16" y="35" width="14" height="14" rx="3" transform="rotate(45 23 42)" fill="${accent}"/><circle cx="23" cy="23" r="18.5" fill="${accent}" stroke="${ring}" stroke-width="3"/><circle cx="23" cy="23" r="6" fill="${dot}"/></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

/**
 * The place of a business on a Google map in the app's colours. On a public profile it is a still
 * map with the business's pin; in the editor a touch or a drag of the pin moves the place.
 */
export function LocationMap({ point, disabled, readOnly = false, category, onPoint }: MapProps) {
  const t = useT();
  const target = useRef<HTMLElement>(null);
  const [start] = useState(() => ({
    centre: point ? { lat: point.latitude, lng: point.longitude } : { lat: 44.1, lng: 17.8 },
    zoom: point ? 15 : 7,
  }));
  const { state, map, maps } = useStyledMap(target, {
    ...start,
    kind: "streets",
    gesture: "cooperative",
  });
  const marker = useRef<GoogleMarker | null>(null);
  const moved = useRef(onPoint);
  moved.current = onPoint;
  const locked = useRef(disabled);
  locked.current = disabled;
  const title = useRef("");
  title.current = t("Odabrana lokacija");
  const latitude = point?.latitude;
  const longitude = point?.longitude;

  useEffect(() => {
    if (!map || readOnly) return;
    const listener = map.addListener("click", (event) => {
      if (locked.current || !event.latLng) return;
      moved.current({ latitude: event.latLng.lat(), longitude: event.latLng.lng() });
    });
    return () => listener.remove();
  }, [map, readOnly]);

  // The pin of the editor: Google's own marker, because it can be dragged with a finger.
  useEffect(() => {
    if (!map || !maps || readOnly) return;
    const pin = new maps.Marker({
      icon: { url: editPin(), anchor: new maps.Point(23, 52), scaledSize: new maps.Size(46, 58) },
      title: title.current,
    });
    marker.current = pin;
    const listeners: MapsListener[] = [
      pin.addListener("dragend", () => {
        const next = pin.getPosition();
        if (next && !locked.current) moved.current({ latitude: next.lat(), longitude: next.lng() });
      }),
    ];
    const theme = new MutationObserver(() =>
      pin.setIcon({
        url: editPin(),
        anchor: new maps.Point(23, 52),
        scaledSize: new maps.Size(46, 58),
      }),
    );
    theme.observe(document.documentElement, { attributeFilter: ["data-theme"] });
    return () => {
      theme.disconnect();
      for (const listener of listeners) listener.remove();
      pin.setMap(null);
      marker.current = null;
    };
  }, [map, maps, readOnly]);

  useEffect(() => {
    if (!map) return;
    const pin = marker.current;
    if (latitude === undefined || longitude === undefined) {
      pin?.setMap(null);
      return;
    }
    const position = { lat: latitude, lng: longitude };
    if (pin) {
      pin.setPosition(position);
      pin.setDraggable(!disabled);
      pin.setMap(map);
    }
    map.setCenter(position);
    if ((map.getZoom() ?? 0) < 14) map.setZoom(15);
  }, [map, latitude, longitude, disabled]);

  return (
    <div className={styles.mapWrap}>
      <section ref={target} className={styles.map} aria-label={t("Karta lokacije djelatnosti")} />
      {state === "unavailable" && (
        <p className={styles.mapError} role="status">
          {t("Mapa trenutno nije dostupna.")}
        </p>
      )}
      {map && maps && readOnly && point && (
        <OnMap map={map} maps={maps} latitude={point.latitude} longitude={point.longitude}>
          <span className={styles.placePin} aria-hidden="true">
            <span>
              <Icon name={categoryIcon(category ?? "")} />
            </span>
          </span>
        </OnMap>
      )}
    </div>
  );
}
