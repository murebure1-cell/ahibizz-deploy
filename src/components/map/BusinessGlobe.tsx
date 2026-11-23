"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { MapCountry, MapPin } from "../../lib/business-map";
import {
  loadGoogleMaps,
  logoMapPin,
  onGoogleMapsAuthFailure,
  pageGoogleMapsKey,
  plainMapPin,
} from "../../lib/google-maps-loader";
import { Icon } from "../Icon";
import styles from "./globe.module.css";

type Camera = {
  center: { lat: number; lng: number; altitude: number };
  range: number;
  tilt: number;
  heading: number;
};
type GlobeElement = HTMLElement & {
  range: number;
  mode: string;
  flyCameraTo(options: { endCamera: Camera; durationMillis?: number }): void;
  flyCameraAround(options: { camera: Camera; durationMillis?: number; repeatCount?: number }): void;
  stopCameraAnimation(): void;
};
type Maps3d = {
  Map3DElement: new (options: Record<string, unknown>) => GlobeElement;
  Marker3DInteractiveElement: new (options: Record<string, unknown>) => HTMLElement;
};

const world: Camera = {
  center: { lat: 30, lng: 17.8, altitude: 0 },
  range: 17_000_000,
  tilt: 0,
  heading: 0,
};
// Far away the globe shows country names and borders; close up it switches to clean 3D imagery,
// so hospitals, shops and other Google places never appear, only AhiBizz markers.
const labelsAboveMetres = 250_000;

function camera(latitude: number, longitude: number, range: number, tilt = 0): Camera {
  return { center: { lat: latitude, lng: longitude, altitude: 0 }, range, tilt, heading: 0 };
}

/** Full-screen 3D globe of every business with a location, grouped by country and city. */
export function BusinessGlobe({ pins, countries }: { pins: MapPin[]; countries: MapCountry[] }) {
  const holder = useRef<HTMLElement>(null);
  const globe = useRef<GlobeElement | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [country, setCountry] = useState<MapCountry | null>(null);
  const [selected, setSelected] = useState<MapPin | null>(null);
  const [spinning, setSpinning] = useState(true);

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
          mode: "HYBRID",
          // One finger turns the globe, two fingers zoom, without a "use two fingers" overlay.
          gestureHandling: "GREEDY",
          defaultUIHidden: true,
        });
        map.className = styles.globe ?? "";
        holder.current.replaceChildren(map);
        globe.current = map;
        map.addEventListener("gmp-rangechange", () => {
          const mode = map.range > labelsAboveMetres ? "HYBRID" : "SATELLITE";
          if (map.mode !== mode) map.mode = mode;
        });
        // Any touch stops the slow spin so the person is in control.
        map.addEventListener("pointerdown", () => {
          map.stopCameraAnimation();
          setSpinning(false);
        });
        const plain = plainMapPin();
        for (const pin of pins) {
          const marker = new lib.Marker3DInteractiveElement({
            position: { lat: pin.latitude, lng: pin.longitude },
            altitudeMode: "CLAMP_TO_GROUND",
            title: pin.title,
          });
          const setImage = (src: string) => {
            const template = document.createElement("template");
            const image = document.createElement("img");
            image.alt = "";
            image.src = src;
            template.content.append(image);
            // Markers read their template when it is added, so replace it as a whole.
            marker.replaceChildren(template);
          };
          setImage(plain);
          marker.addEventListener("gmp-click", () => {
            map.stopCameraAnimation();
            setSpinning(false);
            setSelected(pin);
            map.flyCameraTo({
              endCamera: camera(pin.latitude, pin.longitude, 900, 60),
              durationMillis: 2200,
            });
          });
          map.append(marker);
          if (pin.logo)
            void logoMapPin(pin.logo)
              .then(setImage)
              .catch(() => {});
        }
        setState("ready");
        window.setTimeout(() => {
          if (!cancelled)
            map.flyCameraAround({ camera: world, durationMillis: 120_000, repeatCount: 50 });
        }, 600);
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

  function fly(target: Camera, durationMillis = 2600) {
    const map = globe.current;
    if (!map) return;
    map.stopCameraAnimation();
    setSpinning(false);
    map.flyCameraTo({ endCamera: target, durationMillis });
  }
  function spin() {
    const map = globe.current;
    if (!map) return;
    setSelected(null);
    setCountry(null);
    setSpinning(true);
    map.flyCameraTo({ endCamera: world, durationMillis: 2200 });
    window.setTimeout(
      () => map.flyCameraAround({ camera: world, durationMillis: 120_000, repeatCount: 50 }),
      2300,
    );
  }

  const total = pins.length;
  return (
    <div className={styles.screen}>
      <section ref={holder} className={styles.holder} aria-label="3D mapa djelatnosti" />
      <header className={styles.top}>
        <div>
          <strong>AhiBizz</strong>
          <span>Naša mreža, naša snaga</span>
        </div>
        <Link href="/" className={styles.close} aria-label="Zatvori mapu">
          <Icon name="close" />
        </Link>
      </header>
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
            <Icon name="close" />
          </button>
        </div>
      )}
      <section className={styles.sheet} aria-label="Djelatnosti po državama i gradovima">
        {country ? (
          <>
            <div className={styles.sheetHead}>
              <button type="button" className={styles.back} onClick={() => setCountry(null)}>
                <Icon name="chevron" /> Sve države
              </button>
              <h2>
                {country.name} <span>{country.count}</span>
              </h2>
            </div>
            <div className={styles.chips}>
              {country.cities.map((city) =>
                state === "ready" ? (
                  <button
                    key={city.name}
                    type="button"
                    onClick={() => {
                      setSelected(null);
                      fly(camera(city.latitude, city.longitude, 9000, 45));
                    }}
                  >
                    {city.name} <span>{city.count}</span>
                  </button>
                ) : (
                  <Link key={city.name} href={`/?${new URLSearchParams({ mjesto: city.name })}`}>
                    {city.name} <span>{city.count}</span>
                  </Link>
                ),
              )}
            </div>
          </>
        ) : (
          <>
            <div className={styles.sheetHead}>
              <h2>
                {total ? (
                  <>
                    Djelatnosti po državama <span>{total}</span>
                  </>
                ) : (
                  "Još nema djelatnosti s lokacijom"
                )}
              </h2>
              {state === "ready" && !spinning && (
                <button type="button" className={styles.back} onClick={spin}>
                  Cijeli svijet
                </button>
              )}
            </div>
            <div className={styles.chips}>
              {countries.map((item) => (
                <button
                  key={item.code ?? "other"}
                  type="button"
                  onClick={() => {
                    setCountry(item);
                    setSelected(null);
                    if (state === "ready")
                      fly(
                        camera(
                          item.latitude,
                          item.longitude,
                          item.cities.length > 1 ? 450_000 : 60_000,
                        ),
                      );
                  }}
                >
                  {item.name} <span>{item.count}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {state === "unavailable" && (
          <p className={styles.notice}>3D mapa trenutno nije dostupna. Odaberi državu i grad.</p>
        )}
      </section>
    </div>
  );
}
