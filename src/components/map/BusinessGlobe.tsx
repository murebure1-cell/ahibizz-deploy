"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { MapCity, MapPin } from "../../lib/business-map";
import {
  loadGoogleMaps,
  logoBadge,
  onGoogleMapsAuthFailure,
  pageGoogleMapsKey,
} from "../../lib/google-maps-loader";
import styles from "./globe.module.css";

type Camera = {
  center: { lat: number; lng: number; altitude: number };
  range: number;
  tilt: number;
  heading: number;
};
type GlobeElement = HTMLElement & {
  flyCameraTo(options: { endCamera: Camera; durationMillis?: number }): void;
};
type Maps3d = {
  Map3DElement: new (options: Record<string, unknown>) => GlobeElement;
  Marker3DInteractiveElement: new (options: Record<string, unknown>) => HTMLElement;
  MapMode?: { HYBRID?: string };
  AltitudeMode?: { CLAMP_TO_GROUND?: string };
};

const world: Camera = {
  center: { lat: 30, lng: 17.8, altitude: 0 },
  range: 18_000_000,
  tilt: 0,
  heading: 0,
};
const region: Camera = {
  center: { lat: 44.2, lng: 17.9, altitude: 0 },
  range: 650_000,
  tilt: 0,
  heading: 0,
};
const defaultPin = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="50" viewBox="0 0 42 52"><path d="M21 50S4 33.6 4 20.5a17 17 0 0 1 34 0C38 33.6 21 50 21 50z" fill="#3a3f45" stroke="#fff" stroke-width="2"/><path d="M14 30V18l7-4 7 4v12m-10 0v-5h6v5" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>',
)}`;

/** 3D globe with every business that has a location; city buttons fly the camera to a city. */
export function BusinessGlobe({ pins, cities }: { pins: MapPin[]; cities: MapCity[] }) {
  const holder = useRef<HTMLElement>(null);
  const globe = useRef<GlobeElement | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [selected, setSelected] = useState<MapPin | null>(null);

  useEffect(() => {
    const key = pageGoogleMapsKey();
    if (!key) {
      setState("unavailable");
      return;
    }
    let cancelled = false;
    const stopAuth = onGoogleMapsAuthFailure(() => {
      if (!cancelled) setState("unavailable");
    });
    void (async () => {
      try {
        const maps = await loadGoogleMaps(key);
        const lib = (await maps.importLibrary("maps3d")) as unknown as Maps3d;
        if (cancelled || !holder.current) return;
        const map = new lib.Map3DElement({
          ...world,
          mode: lib.MapMode?.HYBRID ?? "HYBRID",
          defaultUIHidden: false,
        });
        map.className = styles.globe ?? "";
        holder.current.replaceChildren(map);
        globe.current = map;
        for (const pin of pins) {
          const marker = new lib.Marker3DInteractiveElement({
            position: { lat: pin.latitude, lng: pin.longitude },
            altitudeMode: lib.AltitudeMode?.CLAMP_TO_GROUND ?? "CLAMP_TO_GROUND",
            title: pin.title,
          });
          const template = document.createElement("template");
          const image = document.createElement("img");
          image.alt = "";
          image.src = defaultPin;
          template.content.append(image);
          marker.append(template);
          marker.addEventListener("gmp-click", () => {
            setSelected(pin);
            map.flyCameraTo({
              endCamera: {
                center: { lat: pin.latitude, lng: pin.longitude, altitude: 0 },
                range: 1500,
                tilt: 55,
                heading: 0,
              },
              durationMillis: 1800,
            });
          });
          map.append(marker);
          if (pin.logo)
            void logoBadge(pin.logo, 48)
              .then((badge) => {
                // Markers read their template when added, so swap in a fresh template with the logo.
                const next = document.createElement("template");
                const logo = document.createElement("img");
                logo.alt = "";
                logo.src = badge;
                next.content.append(logo);
                marker.replaceChildren(next);
              })
              .catch(() => {});
        }
        setState("ready");
        window.setTimeout(() => {
          if (!cancelled) map.flyCameraTo({ endCamera: region, durationMillis: 3500 });
        }, 700);
      } catch {
        if (!cancelled) setState("unavailable");
      }
    })();
    return () => {
      cancelled = true;
      stopAuth();
      globe.current = null;
    };
  }, [pins]);

  function fly(camera: Camera, durationMillis = 2500) {
    globe.current?.flyCameraTo({ endCamera: camera, durationMillis });
  }

  return (
    <div className={styles.layout}>
      <nav className={styles.cities} aria-label="Gradovi s djelatnostima">
        <button type="button" onClick={() => fly(world, 3000)} disabled={state !== "ready"}>
          Cijeli svijet
        </button>
        <button type="button" onClick={() => fly(region)} disabled={state !== "ready"}>
          BiH i regija
        </button>
        {cities.map((city) =>
          state === "unavailable" ? (
            <Link key={city.name} href={`/?${new URLSearchParams({ mjesto: city.name })}`}>
              {city.name} <span>{city.count}</span>
            </Link>
          ) : (
            <button
              key={city.name}
              type="button"
              disabled={state !== "ready"}
              onClick={() => {
                setSelected(null);
                fly({
                  center: { lat: city.latitude, lng: city.longitude, altitude: 0 },
                  range: 12_000,
                  tilt: 45,
                  heading: 0,
                });
              }}
            >
              {city.name} <span>{city.count}</span>
            </button>
          ),
        )}
      </nav>
      {state === "unavailable" ? (
        <p className={styles.notice} role="status">
          Mapa trenutno nije dostupna. Odaberi grad iznad.
        </p>
      ) : (
        <div className={styles.frame}>
          <section ref={holder} className={styles.holder} aria-label="3D mapa djelatnosti" />
          {state === "loading" && (
            <p className={styles.loading} role="status">
              Učitavam mapu…
            </p>
          )}
          {selected && (
            <div className={styles.card} role="dialog" aria-label={selected.title}>
              <div>
                <strong>{selected.title}</strong>
                {selected.city && <span>{selected.city}</span>}
              </div>
              <Link href={`/djelatnosti/${selected.id}`}>Otvori</Link>
              <button type="button" aria-label="Zatvori" onClick={() => setSelected(null)}>
                ×
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
