"use client";

import { useEffect, useRef, useState } from "react";
import type { GoogleMap, GoogleMapsApi } from "../../lib/google-maps-loader";
import { pathPoint, pathProgress, type RoutePoint } from "../../lib/route-progress";
import { OnMap } from "./OnMap";
import mapStyles from "./world-map.module.css";

/** A person this close to the line is drawn on it; a phone is rarely more exact in a street. */
const onLineWithin = 30;
/** A glide lasts as long as the phone took between two fixes, within these bounds. */
const shortestGlide = 300;
const longestGlide = 1500;

export type PersonLine = { path: RoutePoint[]; lengths: number[] };

/**
 * The person's dot on the map. A phone reports a place about once a second; between two reports
 * the dot moves at an even pace instead of jumping. On the way it keeps to the line of the route,
 * round its corners, for as long as the person is near it.
 */
export function PersonDot({
  map,
  maps,
  point,
  line,
  label,
}: {
  map: GoogleMap;
  maps: GoogleMapsApi;
  /** Where the phone says the person is. */
  point: RoutePoint;
  /** The route they are on while on the way, otherwise null. */
  line: PersonLine | null;
  label: string;
}) {
  const [at, setAt] = useState(point);
  const drawn = useRef<{
    point: RoutePoint;
    along: number | null;
    line: PersonLine | null;
    time: number;
  }>({ point, along: null, line: null, time: 0 });

  useEffect(() => {
    const now = performance.now();
    const from = drawn.current;
    const progress = line ? pathProgress(line.path, line.lengths, point) : null;
    const along = line && progress && progress.off <= onLineWithin ? progress.along : null;
    const end =
      (line && along !== null ? pathPoint(line.path, line.lengths, along) : null) ?? point;
    // Along the line only when the dot already stands on this same line.
    const fromAlong = from.line === line ? from.along : null;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const glide =
      still || !from.time ? 0 : Math.min(longestGlide, Math.max(shortestGlide, now - from.time));
    let frame = 0;
    const step = (time: number) => {
      const k = glide ? Math.min(1, Math.max(0, (time - now) / glide)) : 1;
      const onLine = line && along !== null && fromAlong !== null;
      const reached = onLine ? fromAlong + (along - fromAlong) * k : null;
      const place =
        (onLine && reached !== null ? pathPoint(line.path, line.lengths, reached) : null) ??
        (k === 1
          ? end
          : {
              lat: from.point.lat + (end.lat - from.point.lat) * k,
              lng: from.point.lng + (end.lng - from.point.lng) * k,
            });
      drawn.current = { point: place, along: reached ?? (k === 1 ? along : null), line, time: now };
      setAt(place);
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [point, line]);

  return (
    <OnMap map={map} maps={maps} latitude={at.lat} longitude={at.lng} order={1}>
      <span className={mapStyles.me} role="img" aria-label={label}>
        <span />
      </span>
    </OnMap>
  );
}
