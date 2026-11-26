"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { distanceLabel } from "../../lib/business-map";
import type { GooglePolyline } from "../../lib/google-maps-loader";
import { categoryIcon } from "../../lib/home";
import {
  type AppRoute,
  arrivalLabel,
  arrivedWithin,
  durationLabel,
  easeInOut,
  maneuverSign,
  metresBetween,
  offRouteBeyond,
  pathLengths,
  pathProgress,
  pathUntil,
  type RoutePoint,
  readRoute,
  routeBounds,
  stepAt,
} from "../../lib/route-progress";
import { Icon } from "../Icon";
import { useI18n } from "../i18n/LocaleProvider";
import styles from "./directions.module.css";
import { OnMap } from "./OnMap";
import { PersonDot } from "./PersonDot";
import { useStyledMap } from "./useStyledMap";
import mapStyles from "./world-map.module.css";

export type DirectionsPlace = {
  id: string;
  title: string;
  latitude: number;
  longitude: number;
  category: string | null;
  /** Street and city, as the business gave them. */
  address: string;
};
type Mode = "WALKING" | "DRIVING";
type RoutesLibrary = {
  Route?: { computeRoutes(request: Record<string, unknown>): Promise<{ routes?: unknown[] }> };
};

/** How long the line takes to draw itself, as drawn: half a second. */
const drawMs = 500;
/** This many fixes in a row away from the line before the route is worked out again. */
const strayFixes = 3;
/** How close the map comes to a person on the way. */
const wayZoom = { WALKING: 17, DRIVING: 16 } as const;

/** Room the line keeps clear of the bar at the top and the sheet at the foot. */
function frameRoom() {
  if (window.matchMedia("(min-width: 900px)").matches)
    return { top: 110, right: 64, bottom: 64, left: 448 };
  return {
    top: 110,
    right: 48,
    bottom: Math.min(400, Math.round(window.innerHeight * 0.52)),
    left: 48,
  };
}

function lineColours() {
  const style = getComputedStyle(document.documentElement);
  const dark = document.documentElement.dataset.theme === "dark";
  return {
    line: style.getPropertyValue("--ui-accent").trim() || "#0e7a6d",
    // The line lies on a rim in the colour of the page, so it reads on roads of any colour.
    rim: dark ? style.getPropertyValue("--ui-page").trim() || "#0b0d10" : "#ffffff",
  };
}

function TurnSign({ maneuver }: { maneuver: string }) {
  const sign = maneuverSign(maneuver);
  if (sign === "straight") return <Icon name="straight" />;
  return <Icon name="turn" data-turn={sign} />;
}

/**
 * The way to a business, inside the app: a Google map with the route from where the person stands,
 * drawn in half a second, the time and the distance, the first turns, and "Kreni", after which the
 * person's dot follows them along the line and the next turn is told at the top.
 */
export function Directions({ place, back }: { place: DirectionsPlace; back: string }) {
  const { t, locale } = useI18n();
  const target = useRef<HTMLDivElement>(null);
  const destination = useMemo(
    () => ({ lat: place.latitude, lng: place.longitude }),
    [place.latitude, place.longitude],
  );
  const { state, map, maps } = useStyledMap(target, {
    centre: destination,
    zoom: 15,
    kind: "streets",
    minZoom: 4,
    // Closer than this a street is a blank; two ends a few steps apart must not lead there.
    maxZoom: 19,
  });
  const [mode, setMode] = useState<Mode>("WALKING");
  const [where, setWhere] = useState<"asking" | "ready" | "denied" | "unavailable">("asking");
  const [me, setMe] = useState<RoutePoint | null>(null);
  const [origin, setOrigin] = useState<RoutePoint | null>(null);
  const [route, setRoute] = useState<AppRoute | null>(null);
  const [routing, setRouting] = useState<"idle" | "loading" | "ready" | "refused">("idle");
  const [drawn, setDrawn] = useState(false);
  const [going, setGoing] = useState(false);
  const [following, setFollowing] = useState(true);
  const [along, setAlong] = useState(0);
  const [arrived, setArrived] = useState(false);
  // What the answers of Google and of the phone's location need to know when they arrive.
  const onWay = useRef(false);
  onWay.current = going;
  const follows = useRef(true);
  follows.current = following;

  const locate = useCallback(() => {
    if (!window.isSecureContext || !navigator.geolocation) {
      setWhere("unavailable");
      return;
    }
    setWhere("asking");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = { lat: position.coords.latitude, lng: position.coords.longitude };
        setMe(point);
        setOrigin(point);
        setWhere("ready");
      },
      (failure) => setWhere(failure.code === 1 ? "denied" : "unavailable"),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }, []);
  useEffect(locate, [locate]);

  // The route, asked from Google whenever the start or the way of travelling changes.
  const fromLat = origin?.lat;
  const fromLng = origin?.lng;
  useEffect(() => {
    if (!maps || fromLat === undefined || fromLng === undefined) return;
    // At the door there is no way left to ask for.
    if (metresBetween({ lat: fromLat, lng: fromLng }, destination) <= arrivedWithin) {
      setRoute(null);
      setRouting("idle");
      return;
    }
    let cancelled = false;
    setRouting("loading");
    // On the way the sheet stays where it is while a new line is worked out.
    if (!onWay.current) setDrawn(false);
    void (async () => {
      try {
        const library = (await maps.importLibrary("routes")) as RoutesLibrary;
        if (!library.Route) throw new Error("routes unavailable");
        const answer = await library.Route.computeRoutes({
          origin: { lat: fromLat, lng: fromLng },
          destination,
          travelMode: mode,
          fields: ["path", "distanceMeters", "durationMillis", "legs"],
          // The line is drawn on the streets, so it needs every bend of them.
          polylineQuality: "HIGH_QUALITY",
          language: locale,
        });
        const read = readRoute(answer.routes?.[0]);
        if (cancelled) return;
        if (!read) throw new Error("no route");
        setAlong(0);
        setRoute(read);
        setRouting("ready");
      } catch {
        if (cancelled) return;
        // On the way a second answer that fails leaves the first line: it is better than none.
        if (onWay.current) {
          setRouting("ready");
          return;
        }
        setRoute(null);
        setRouting("refused");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [maps, fromLat, fromLng, mode, locale, destination]);

  // The line draws itself along the route; a theme change repaints it.
  useEffect(() => {
    if (!map || !maps || !route) return;
    const shared = { map, clickable: false, strokeOpacity: 1 };
    const rim: GooglePolyline = new maps.Polyline({ ...shared, strokeWeight: 12, zIndex: 1 });
    const line: GooglePolyline = new maps.Polyline({ ...shared, strokeWeight: 6, zIndex: 2 });
    const paint = () => {
      const colours = lineColours();
      rim.setOptions({ strokeColor: colours.rim });
      line.setOptions({ strokeColor: colours.line });
    };
    paint();
    const theme = new MutationObserver(paint);
    theme.observe(document.documentElement, { attributeFilter: ["data-theme"] });
    const lengths = pathLengths(route.path);
    const total = lengths[lengths.length - 1] ?? 0;
    // A line worked out again on the way must not pull the map back from the person.
    const bounds = routeBounds(route.path);
    if (bounds && !onWay.current) map.fitBounds(bounds, frameRoom());
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const started = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const k = still ? 1 : Math.min(1, (now - started) / drawMs);
      const part = pathUntil(route.path, lengths, total * easeInOut(k));
      rim.setPath(part);
      line.setPath(part);
      if (k < 1) frame = requestAnimationFrame(step);
      else setDrawn(true);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      theme.disconnect();
      rim.setMap(null);
      line.setMap(null);
    };
  }, [map, maps, route]);

  // Without a route the map still shows both ends.
  useEffect(() => {
    if (!map || route || !me) return;
    const bounds = routeBounds([me, destination]);
    if (bounds) map.fitBounds(bounds, frameRoom());
  }, [map, route, me, destination]);

  // A hand on the map lets it go from the person, until they ask for themselves again.
  useEffect(() => {
    if (!map) return;
    const listener = map.addListener("dragstart", () => setFollowing(false));
    return () => listener.remove();
  }, [map]);

  // The line the person's dot keeps to while they are on the way.
  const line = useMemo(
    () => (going && route ? { path: route.path, lengths: pathLengths(route.path) } : null),
    [going, route],
  );

  // On the way: the dot follows the person, and the route is asked again if they leave it.
  useEffect(() => {
    if (!line || !route) return;
    const { lengths } = line;
    let lock: { release(): Promise<void> } | null = null;
    let over = false;
    const wake = (
      navigator as Navigator & {
        wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> };
      }
    ).wakeLock;
    void wake
      ?.request("screen")
      .then((held) => {
        if (over) void held.release().catch(() => {});
        else lock = held;
      })
      .catch(() => {});
    let strayed = 0;
    const watch = navigator.geolocation.watchPosition(
      (position) => {
        const point = { lat: position.coords.latitude, lng: position.coords.longitude };
        setMe(point);
        if (follows.current) map?.panTo(point);
        const progress = pathProgress(route.path, lengths, point);
        if (!progress) return;
        setAlong(progress.along);
        if (
          route.metres - progress.along <= arrivedWithin ||
          metresBetween(point, destination) <= arrivedWithin
        ) {
          setArrived(true);
          return;
        }
        strayed = progress.off > offRouteBeyond ? strayed + 1 : 0;
        if (strayed >= strayFixes) {
          strayed = 0;
          setOrigin(point);
        }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20_000 },
    );
    return () => {
      over = true;
      navigator.geolocation.clearWatch(watch);
      void lock?.release().catch(() => {});
    };
  }, [line, route, map, destination]);

  const external = `https://www.google.com/maps/dir/?${new URLSearchParams({
    api: "1",
    destination: `${place.latitude},${place.longitude}`,
    travelmode: mode === "WALKING" ? "walking" : "driving",
  })}`;
  const left = route ? Math.max(0, route.metres - along) : 0;
  const secondsLeft = route?.metres ? route.seconds * (left / route.metres) : 0;
  const position = route ? stepAt(route.steps, along) : null;
  // Google words a step as what to do at its start, so the turn ahead is the next step's.
  const ahead = route && position ? route.steps[position.index + 1] : undefined;
  const first = route?.steps[0];
  const later = route ? route.steps.slice(1, 3) : [];
  const straight = me ? metresBetween(me, destination) : null;
  const here = !route && where === "ready" && straight !== null && straight <= arrivedWithin;
  const shown = route !== null && (going || (drawn && routing === "ready"));
  const travel = (next: Mode) => {
    if (next === mode) return;
    setGoing(false);
    setArrived(false);
    // The new way starts where the person is now, not where they first opened the screen.
    if (me) setOrigin(me);
    setMode(next);
  };
  const start = () => {
    setGoing(true);
    setFollowing(true);
    if (!map || !me) return;
    map.setZoom(Math.max(map.getZoom() ?? 0, wayZoom[mode]));
    map.panTo(me);
  };
  const stop = () => {
    setGoing(false);
    setArrived(false);
    const bounds = route ? routeBounds(route.path) : null;
    if (map && bounds) map.fitBounds(bounds, frameRoom());
  };

  return (
    <div className={styles.screen} data-going={going || undefined}>
      <div className={styles.map} data-state={state}>
        <div ref={target} className={styles.mapCanvas} />
        {state === "unavailable" && (
          <p className={styles.mapOff} role="status">
            {t("Mapa trenutno nije dostupna.")}
          </p>
        )}
      </div>

      {map && maps && (
        <OnMap
          map={map}
          maps={maps}
          latitude={place.latitude}
          longitude={place.longitude}
          order={2}
        >
          <span
            className={styles.destination}
            data-arrived={arrived || undefined}
            role="img"
            aria-label={t("Odredište: {title}", { title: place.title })}
          >
            <span className={mapStyles.pin} data-selected="">
              <span className={mapStyles.pinHead}>
                <Icon name={categoryIcon(place.category ?? "")} />
              </span>
              <span className={mapStyles.pinTip} />
            </span>
          </span>
        </OnMap>
      )}
      {map && maps && me && (
        <PersonDot map={map} maps={maps} point={me} line={line} label={t("Moja lokacija")} />
      )}

      <header className={styles.bar}>
        <Link href={back} className={styles.round} aria-label={t("Nazad na djelatnost")}>
          <Icon name="chevron" data-back="" />
        </Link>
        <div className={styles.title}>
          <span>{t("Uputstva do")}</span>
          <h1 dir="auto">{place.title}</h1>
        </div>
        <fieldset className={styles.modes}>
          <legend className={styles.srOnly}>{t("Način kretanja")}</legend>
          <button
            type="button"
            aria-label={t("Pješice")}
            aria-pressed={mode === "WALKING"}
            onClick={() => travel("WALKING")}
          >
            <Icon name="walk" />
          </button>
          <button
            type="button"
            aria-label={t("Automobilom")}
            aria-pressed={mode === "DRIVING"}
            onClick={() => travel("DRIVING")}
          >
            <Icon name="car" />
          </button>
        </fieldset>
      </header>

      {going && route && (
        <div className={styles.turn} role="status" aria-live="polite">
          <span className={styles.sign} aria-hidden="true">
            {arrived ? <Icon name="check" /> : <TurnSign maneuver={ahead?.maneuver ?? ""} />}
          </span>
          <span className={styles.turnText}>
            {arrived ? (
              <>
                <strong>{t("Na odredištu si")}</strong>
                <span dir="auto">{[place.title, place.address].filter(Boolean).join(", ")}</span>
              </>
            ) : (
              <>
                <strong dir="auto">{ahead?.instruction ?? t("Odredište je pred tobom")}</strong>
                <span>
                  {t("za {distance}", {
                    distance: distanceLabel(ahead ? (position?.toNext ?? left) : left, locale),
                  })}
                </span>
              </>
            )}
          </span>
        </div>
      )}

      <div className={styles.foot}>
        {going && !following && me && (
          <button
            type="button"
            className={styles.centre}
            aria-label={t("Moja lokacija")}
            onClick={() => {
              setFollowing(true);
              map?.panTo(me);
            }}
          >
            <Icon name="locate" />
          </button>
        )}
        {/* The sheet comes up once the line has drawn itself; its key replays the entrance. */}
        <section
          className={styles.sheet}
          aria-label={t("Uputstva")}
          key={route && shown ? "route" : "note"}
        >
          {route && shown ? (
            <>
              {!arrived && (
                <div className={styles.summary}>
                  <strong>{durationLabel(going ? secondsLeft : route.seconds)}</strong>
                  <span>
                    <span>{distanceLabel(going ? left : route.metres, locale)}</span>
                    <span>
                      {t("stižeš oko {time}", {
                        time: arrivalLabel(new Date(), going ? secondsLeft : route.seconds, locale),
                      })}
                    </span>
                  </span>
                </div>
              )}
              {!going && first && (
                <div className={styles.step}>
                  <span className={styles.sign} aria-hidden="true">
                    <TurnSign maneuver={first.maneuver} />
                  </span>
                  <span className={styles.turnText}>
                    <strong dir="auto">{first.instruction}</strong>
                    <span>{distanceLabel(first.metres, locale)}</span>
                  </span>
                </div>
              )}
              {!going && later.length > 0 && (
                <ol className={styles.steps} aria-label={t("Sljedeći koraci")}>
                  {later.map((step, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: the steps of one route never reorder.
                    <li key={index} dir="auto">
                      {step.instruction}
                    </li>
                  ))}
                </ol>
              )}
              {arrived ? (
                <>
                  <Link className={styles.go} href={back}>
                    {t("Otvori profil")}
                  </Link>
                  <button type="button" className={styles.stop} onClick={stop}>
                    {t("Završi")}
                  </button>
                </>
              ) : (
                <>
                  {going ? (
                    <button type="button" className={styles.stop} onClick={stop}>
                      {t("Zaustavi")}
                    </button>
                  ) : (
                    <button type="button" className={styles.go} onClick={start}>
                      {t("Kreni")}
                    </button>
                  )}
                  <a
                    className={styles.outside}
                    href={external}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("Otvori u Google Maps")}
                  </a>
                </>
              )}
            </>
          ) : (
            <>
              <p className={styles.note} role="status">
                {here
                  ? t("Na odredištu si")
                  : where === "asking"
                    ? t("Tražim tvoju lokaciju…")
                    : where !== "ready"
                      ? t("Uključi lokaciju da vidiš putanju od sebe do djelatnosti.")
                      : routing === "refused"
                        ? t("Putanju unutar aplikacije trenutno ne možemo izračunati.")
                        : t("Računam putanju…")}
              </p>
              {here && (
                <p className={styles.where} dir="auto">
                  {[place.title, place.address].filter(Boolean).join(", ")}
                </p>
              )}
              {where === "ready" && routing === "refused" && straight !== null && (
                <p className={styles.straight}>
                  {t("{distance} zračnom linijom", { distance: distanceLabel(straight, locale) })}
                </p>
              )}
              {where !== "asking" && where !== "ready" && (
                <button type="button" className={styles.stop} onClick={locate}>
                  {t("Pokušaj ponovo")}
                </button>
              )}
              {here ? (
                <Link className={styles.go} href={back}>
                  {t("Otvori profil")}
                </Link>
              ) : (
                <a className={styles.go} href={external} target="_blank" rel="noopener noreferrer">
                  {t("Otvori u Google Maps")}
                </a>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
