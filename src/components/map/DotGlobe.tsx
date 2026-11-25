"use client";

import { useEffect, useRef } from "react";
import {
  type GlobeView,
  globeElevationLimits,
  globeFacing,
  globeRest,
  globeTurn,
  globeTurnSeconds,
  globeVector,
  type LandMask,
  landDots,
  lightSize,
  nearestTurn,
  type Vector,
} from "../../lib/dot-globe";
import { decodeLand, landOutlineUrl } from "../../lib/globe-land";
import styles from "./dot-globe.module.css";

export type GlobeLight = { latitude: number; longitude: number; count: number };

const fullTurn = Math.PI * 2;
/** The size the globe was drawn at; dot and light sizes scale from it. */
const drawnSize = 328;
/** A tap this close to a light, in screen pixels, opens it. */
const tapReach = 30;
/** After a drag the globe waits this long before it turns by itself again. */
const restMs = 2200;
const turnMs = 700;
/** Many more lights than this stop being places and become a smear. */
const mostLights = 400;

let mask: Promise<LandMask> | null = null;
/** The land of the world as a small flat picture, drawn once from the outlines the app ships. */
function loadLandMask(): Promise<LandMask> {
  mask ??= fetch(landOutlineUrl)
    .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error("land"))))
    .then((buffer) => {
      const canvas = document.createElement("canvas");
      canvas.width = 720;
      canvas.height = 360;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("canvas");
      const sx = canvas.width / 360;
      const sy = canvas.height / 180;
      context.fillStyle = "#fff";
      context.beginPath();
      // Rings that cross the date line run past ±180, so each is also drawn one turn east and west.
      for (const offset of [-360, 0, 360])
        for (const ring of decodeLand(buffer)) {
          for (let i = 0; i < ring.length; i += 2) {
            const x = ((ring[i] ?? 0) + 180 + offset) * sx;
            const y = (90 - (ring[i + 1] ?? 0)) * sy;
            if (i === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
          }
          context.closePath();
        }
      context.fill("evenodd");
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      return { width: canvas.width, height: canvas.height, data };
    })
    .catch((error: unknown) => {
      mask = null;
      throw error;
    });
  return mask;
}

function easeInOut(k: number) {
  return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
}

/**
 * The globe as drawn: a graphite ball whose land is made of dots, with a light at every place
 * that has an AhiBizz business. It turns slowly by itself. With `interactive` a finger turns it
 * and a tap on a light reports that light; with `focus` it turns to bring a place to the front.
 */
export function DotGlobe({
  lights,
  className,
  label,
  step = 3,
  interactive = false,
  focus = null,
  onArrive,
  onPick,
  paused = false,
}: {
  lights: readonly GlobeLight[];
  className?: string;
  /** Said by screen readers; without it the globe is decoration. */
  label?: string;
  /** Degrees between two dots; a small globe takes fewer, larger steps. */
  step?: number;
  interactive?: boolean;
  focus?: { latitude: number; longitude: number } | null;
  onArrive?: () => void;
  onPick?: (index: number) => void;
  /** True while something covers the globe: it then stands still and draws nothing. */
  paused?: boolean;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const places = useRef<{ vector: Vector; count: number }[]>([]);
  const wake = useRef<() => void>(() => {});
  const turnTo = useRef<(target: { latitude: number; longitude: number } | null) => void>(() => {});
  const arrive = useRef(onArrive);
  arrive.current = onArrive;
  const pick = useRef(onPick);
  pick.current = onPick;
  const resting = useRef(paused);

  useEffect(() => {
    places.current = lights.slice(0, mostLights).map((light) => ({
      vector: globeVector(light.latitude, light.longitude),
      count: light.count,
    }));
    wake.current();
  }, [lights]);

  // The globe is set up once; lights, focus and the callbacks reach it through refs.
  useEffect(() => {
    const element = holder.current;
    const surface = canvas.current;
    const context = surface?.getContext("2d");
    if (!element || !surface || !context) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const view: GlobeView = { spin: -18 * (Math.PI / 180), ...globeRest };
    let dots: Float32Array = new Float32Array(0);
    let colours = { dot: "", light: "", glow: "", clear: "" };
    let frame = 0;
    let last = 0;
    let visible = true;
    let cancelled = false;
    let velocity = 0;
    let touched = -restMs;
    let held = false;
    let drag: {
      x: number;
      y: number;
      fromX: number;
      fromY: number;
      at: number;
      moved: boolean;
    } | null = null;
    let turn: {
      from: GlobeView;
      spin: number;
      elevation: number;
      start: number;
      length: number;
    } | null = null;

    function readColours() {
      const style = getComputedStyle(element as HTMLElement);
      colours = {
        dot: style.getPropertyValue("--globe-dot").trim(),
        light: style.getPropertyValue("--globe-light").trim(),
        glow: style.getPropertyValue("--globe-glow").trim(),
        clear: style.getPropertyValue("--globe-glow-clear").trim(),
      };
    }

    function draw() {
      if (!surface || !context) return;
      const size = surface.clientWidth;
      if (!size) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 3);
      const pixels = Math.round(size * ratio);
      if (surface.width !== pixels) {
        surface.width = pixels;
        surface.height = pixels;
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, size, size);
      const radius = size / 2;
      const unit = size / drawnSize;
      const t = globeTurn(view);
      const [xx = 0, xy = 0, xz = 0, yx = 0, yy = 0, yz = 0, zx = 0, zy = 0, zz = 0] = t;

      // A dot is about a sixth of the way to its neighbour, whatever the size of the globe. Dots
      // get smaller towards the rim, as round marks on a ball do when seen from the side.
      const dotSize = Math.max(0.9, 0.18 * step * (Math.PI / 180) * radius);
      context.fillStyle = colours.dot;
      context.beginPath();
      for (let i = 0; i < dots.length; i += 3) {
        const x = dots[i] ?? 0;
        const y = dots[i + 1] ?? 0;
        const z = dots[i + 2] ?? 0;
        const depth = zx * x + zy * y + zz * z;
        if (depth <= 0.03) continue;
        const px = radius + (xx * x + xy * y + xz * z) * radius;
        const py = radius - (yx * x + yy * y + yz * z) * radius;
        const r = dotSize * (0.4 + 0.6 * depth);
        context.moveTo(px + r, py);
        context.arc(px, py, r, 0, fullTurn);
      }
      context.fill();

      for (const place of places.current) {
        const [x, y, z] = place.vector;
        const depth = zx * x + zy * y + zz * z;
        if (depth <= 0.05) continue;
        const px = radius + (xx * x + xy * y + xz * z) * radius;
        const py = radius - (yx * x + yy * y + yz * z) * radius;
        const { core, glow } = lightSize(place.count);
        const reach = Math.max(4, glow * unit);
        const centre = Math.max(1.2, core * unit);
        const halo = context.createRadialGradient(px, py, 0, px, py, reach);
        halo.addColorStop(0, colours.light);
        halo.addColorStop(Math.min(0.9, centre / reach), colours.light);
        halo.addColorStop(Math.min(0.95, (centre + unit) / reach), colours.glow);
        halo.addColorStop(1, colours.clear);
        context.globalAlpha = Math.min(1, (depth - 0.05) / 0.25);
        context.fillStyle = halo;
        context.beginPath();
        context.arc(px, py, reach, 0, fullTurn);
        context.fill();
      }
      context.globalAlpha = 1;
    }

    function tick(now: number) {
      frame = 0;
      const elapsed = Math.min(64, now - (last || now));
      last = now;
      let moving = false;
      if (turn) {
        const k = turn.length ? Math.min(1, (now - turn.start) / turn.length) : 1;
        const eased = easeInOut(k);
        view.spin = turn.from.spin + (turn.spin - turn.from.spin) * eased;
        view.elevation = turn.from.elevation + (turn.elevation - turn.from.elevation) * eased;
        if (k >= 1) {
          turn = null;
          arrive.current?.();
        }
        moving = true;
      } else if (drag) moving = true;
      else if (Math.abs(velocity) > 0.00002) {
        view.spin += velocity * elapsed;
        velocity *= Math.exp(-elapsed / 320);
        touched = now;
        moving = true;
      } else if (!still && !held) {
        if (now - touched > restMs) {
          view.spin += (fullTurn / (globeTurnSeconds * 1000)) * elapsed;
          // A globe someone tipped slowly stands back up.
          view.elevation += (globeRest.elevation - view.elevation) * (1 - Math.exp(-elapsed / 900));
        }
        moving = true;
      }
      draw();
      if (moving && visible && !cancelled && !resting.current) frame = requestAnimationFrame(tick);
    }
    function run() {
      if (!frame && !cancelled) {
        last = 0;
        frame = requestAnimationFrame(tick);
      }
    }
    wake.current = run;
    turnTo.current = (target) => {
      held = Boolean(target);
      if (!target) {
        touched = performance.now() - restMs;
        run();
        return;
      }
      const facing = globeFacing(target.latitude, target.longitude);
      velocity = 0;
      drag = null;
      turn = {
        from: { ...view },
        spin: nearestTurn(view.spin, facing.spin),
        elevation: facing.elevation,
        start: performance.now(),
        length: still ? 0 : turnMs,
      };
      run();
    };

    readColours();
    const theme = new MutationObserver(() => {
      readColours();
      run();
    });
    theme.observe(document.documentElement, { attributeFilter: ["data-theme"] });
    const resized = new ResizeObserver(run);
    resized.observe(surface);
    const seen = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting) && document.visibilityState === "visible";
      if (visible) run();
    });
    seen.observe(surface);
    const shown = () => {
      visible = document.visibilityState === "visible";
      if (visible) run();
    };
    document.addEventListener("visibilitychange", shown);

    void loadLandMask()
      .then((land) => {
        if (cancelled) return;
        dots = landDots(land, step);
        run();
      })
      .catch(() => {});

    function radiusNow() {
      return Math.max(1, (surface?.clientWidth ?? 0) / 2);
    }
    function down(event: PointerEvent) {
      if (!event.isPrimary || turn || held) return;
      element?.setPointerCapture(event.pointerId);
      drag = {
        x: event.clientX,
        y: event.clientY,
        fromX: event.clientX,
        fromY: event.clientY,
        at: event.timeStamp,
        moved: false,
      };
      velocity = 0;
      run();
    }
    function move(event: PointerEvent) {
      if (!drag || !event.isPrimary) return;
      if (!drag.moved && Math.hypot(event.clientX - drag.fromX, event.clientY - drag.fromY) > 6)
        drag.moved = true;
      if (drag.moved) {
        const radius = radiusNow();
        const turned = (event.clientX - drag.x) / radius;
        const [low, high] = globeElevationLimits;
        view.spin += turned;
        view.elevation = Math.min(
          high,
          Math.max(low, view.elevation + (event.clientY - drag.y) / radius),
        );
        velocity = still ? 0 : turned / Math.max(8, event.timeStamp - drag.at);
      }
      drag.x = event.clientX;
      drag.y = event.clientY;
      drag.at = event.timeStamp;
    }
    function up(event: PointerEvent) {
      if (!drag || !event.isPrimary) return;
      const tapped = !drag.moved;
      // A finger that rested before lifting leaves the globe where it is.
      if (event.timeStamp - drag.at > 90) velocity = 0;
      drag = null;
      touched = performance.now();
      if (tapped && surface) {
        const box = surface.getBoundingClientRect();
        const radius = box.width / 2;
        const x = event.clientX - box.left - radius;
        const y = radius - (event.clientY - box.top);
        const t = globeTurn(view);
        let best = -1;
        let bestDistance = tapReach;
        places.current.forEach((place, index) => {
          const [vx, vy, vz] = place.vector;
          if ((t[6] ?? 0) * vx + (t[7] ?? 0) * vy + (t[8] ?? 0) * vz <= 0.05) return;
          const px = ((t[0] ?? 0) * vx + (t[1] ?? 0) * vy + (t[2] ?? 0) * vz) * radius;
          const py = ((t[3] ?? 0) * vx + (t[4] ?? 0) * vy + (t[5] ?? 0) * vz) * radius;
          const distance = Math.hypot(px - x, py - y);
          if (distance < bestDistance) {
            best = index;
            bestDistance = distance;
          }
        });
        if (best >= 0) pick.current?.(best);
      }
      run();
    }
    function cancel() {
      drag = null;
      touched = performance.now();
    }
    if (interactive) {
      element.addEventListener("pointerdown", down);
      element.addEventListener("pointermove", move);
      element.addEventListener("pointerup", up);
      element.addEventListener("pointercancel", cancel);
    }
    run();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      theme.disconnect();
      resized.disconnect();
      seen.disconnect();
      document.removeEventListener("visibilitychange", shown);
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", cancel);
      wake.current = () => {};
      turnTo.current = () => {};
    };
  }, [step, interactive]);

  useEffect(() => {
    resting.current = paused;
    if (!paused) wake.current();
  }, [paused]);

  const latitude = focus?.latitude;
  const longitude = focus?.longitude;
  useEffect(() => {
    turnTo.current(
      latitude === undefined || longitude === undefined ? null : { latitude, longitude },
    );
  }, [latitude, longitude]);

  return (
    <div
      ref={holder}
      className={`${styles.globe} ${className ?? ""}`}
      data-interactive={interactive || undefined}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <span className={styles.ball} />
      <canvas ref={canvas} />
      <span className={styles.rim} />
    </div>
  );
}
