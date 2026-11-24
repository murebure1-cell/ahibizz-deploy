"use client";

import { useEffect, useRef } from "react";
import type { LocationPoint } from "../../lib/business-location";
import {
  loadGoogleMaps,
  logoMapPin,
  onGoogleMapsAuthFailure,
  pageGoogleMapId,
  plainMapPin,
} from "../../lib/google-maps-loader";
import { safeBusinessImage } from "../../lib/public-business";
import { useT } from "../i18n/LocaleProvider";
import styles from "./location.module.css";

type Map3D = HTMLElement & { colorScheme: string };
type Maps3d = {
  Map3DElement: new (options: Record<string, unknown>) => Map3D;
  Marker3DElement: new (options: Record<string, unknown>) => HTMLElement;
};

function mapScheme() {
  return document.documentElement.dataset.theme === "dark" ? "DARK" : "LIGHT";
}

/**
 * Public business location in the vector 3D map: light streets with pale buildings, or deep navy
 * in the dark theme, tilted so buildings stand out, with the business logo pin.
 */
export function ProfileMap3D({
  apiKey,
  point,
  logoUrl,
  onUnavailable,
}: {
  apiKey: string;
  point: LocationPoint;
  logoUrl?: string;
  onUnavailable: () => void;
}) {
  const t = useT();
  const holder = useRef<HTMLElement>(null);
  const unavailable = useRef(onUnavailable);
  unavailable.current = onUnavailable;
  useEffect(() => {
    let cancelled = false;
    let themeObserver: MutationObserver | undefined;
    const fail = () => {
      if (!cancelled) unavailable.current();
    };
    const stopAuth = onGoogleMapsAuthFailure(fail);
    void (async () => {
      try {
        const maps = await loadGoogleMaps(apiKey);
        const lib = (await maps.importLibrary("maps3d")) as unknown as Maps3d;
        if (cancelled || !holder.current) return;
        const mapId = pageGoogleMapId();
        const map = new lib.Map3DElement({
          center: { lat: point.latitude, lng: point.longitude, altitude: 0 },
          range: 650,
          tilt: 58,
          heading: 0,
          mode: "ROADMAP",
          colorScheme: mapScheme(),
          ...(mapId ? { mapId } : {}),
          // Inside a scrolling page, the map moves only with two fingers or ctrl+scroll.
          gestureHandling: "COOPERATIVE",
          defaultUIHidden: true,
        });
        map.className = styles.map3d ?? "";
        holder.current.replaceChildren(map);
        themeObserver = new MutationObserver(() => {
          map.colorScheme = mapScheme();
        });
        themeObserver.observe(document.documentElement, { attributeFilter: ["data-theme"] });
        const marker = new lib.Marker3DElement({
          position: { lat: point.latitude, lng: point.longitude },
          altitudeMode: "CLAMP_TO_GROUND",
        });
        const setImage = (src: string) => {
          const template = document.createElement("template");
          const image = document.createElement("img");
          image.alt = "";
          image.src = src;
          template.content.append(image);
          marker.replaceChildren(template);
        };
        setImage(plainMapPin());
        map.append(marker);
        const logo = safeBusinessImage(logoUrl ? { src: logoUrl, alt: "" } : undefined);
        if (logo)
          void logoMapPin(logo.src)
            .then(setImage)
            .catch(() => {});
      } catch {
        fail();
      }
    })();
    return () => {
      cancelled = true;
      stopAuth();
      themeObserver?.disconnect();
    };
  }, [apiKey, point.latitude, point.longitude, logoUrl]);
  return (
    <div className={styles.mapWrap}>
      <section ref={holder} className={styles.map} aria-label={t("Karta lokacije djelatnosti")} />
    </div>
  );
}
