"use client";

import { useEffect, useRef } from "react";
import { landPoints, unitVector } from "../../lib/globe-land";

const gold = ["#f2c45a", "#e8b444", "#ffd978", "#d39a2c", "#fff1c2", "#f5cd6a"];
const turnSeconds = 48;
/** Axis tilted like a desk globe, seen a little from above. */
const view = { elevation: 0.32, tilt: -0.36 };
/** Europe and Bosnia face the viewer first. */
const startLongitude = -18;

type Projected = { x: number; y: number; z: number };

function project(vx: number, vy: number, vz: number, spin: number): Projected {
  const sin = Math.sin(spin);
  const cos = Math.cos(spin);
  // Spin around the north axis.
  const x1 = vx * cos + vz * sin;
  const z1 = vz * cos - vx * sin;
  // Look a little from above.
  const se = Math.sin(view.elevation);
  const ce = Math.cos(view.elevation);
  const y2 = vy * ce - z1 * se;
  const z2 = vy * se + z1 * ce;
  // Lean the axis like a globe on a stand.
  const st = Math.sin(view.tilt);
  const ct = Math.cos(view.tilt);
  return { x: x1 * ct - y2 * st, y: x1 * st + y2 * ct, z: z2 };
}

/** Cheap stable noise so every dot keeps its own colour and glitter rhythm. */
function noise(index: number) {
  const value = Math.sin(index * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * Deep blue globe with glittering gold land that turns slowly; AhiBizz locations light up in gold as
 * they come round to the front.
 */
export function GoldGlobe({
  places,
  className,
}: {
  places: [number, number][];
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    const land = landPoints();
    const spots = places.map(([lat, lng]) => unitVector(lat, lng));
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let visible = true;
    const started = performance.now();

    function draw(now: number) {
      if (!element || !context) return;
      const size = element.clientWidth;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      if (element.width !== Math.round(size * ratio)) {
        element.width = Math.round(size * ratio);
        element.height = Math.round(size * ratio);
      }
      const t = still ? 0 : (now - started) / 1000;
      const spin = ((startLongitude + (t * 360) / turnSeconds) * Math.PI) / 180;
      const centre = (size * ratio) / 2;
      const radius = centre * 0.84;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, element.width, element.height);

      // Ocean: deep lacquered blue with a light from the upper left.
      const ocean = context.createRadialGradient(
        centre - radius * 0.38,
        centre - radius * 0.42,
        radius * 0.05,
        centre,
        centre,
        radius,
      );
      ocean.addColorStop(0, "#5aa2ec");
      ocean.addColorStop(0.35, "#1f5fb4");
      ocean.addColorStop(0.75, "#0e3478");
      ocean.addColorStop(1, "#061a44");
      context.beginPath();
      context.arc(centre, centre, radius, 0, Math.PI * 2);
      context.fillStyle = ocean;
      context.fill();

      // Glittering gold land, darker towards the edge of the sphere.
      const dot = Math.max(1, radius / 95);
      // Grains overlap a little so the continents read as solid glittering gold.
      const grain = Math.max(1.3, radius / 58);
      for (let i = 0, n = 0; i < land.length; i += 3, n++) {
        const p = project(land[i] ?? 0, land[i + 1] ?? 0, land[i + 2] ?? 0, spin);
        if (p.z <= 0) continue;
        const shade = 0.5 + 0.5 * p.z;
        const glitter = still ? 1 : 0.78 + 0.22 * Math.sin(t * (1.5 + noise(n) * 3) + n);
        context.globalAlpha = Math.min(1, shade * glitter);
        context.fillStyle = gold[Math.floor(noise(n + 7) * gold.length)] ?? "#e9ca8a";
        const s = grain * (0.7 + noise(n + 3) * 0.6);
        context.fillRect(centre + p.x * radius - s / 2, centre - p.y * radius - s / 2, s, s);
      }
      context.globalAlpha = 1;

      // Shadow on the far side and a glossy highlight, like the varnish of a real globe.
      const shadow = context.createRadialGradient(
        centre - radius * 0.3,
        centre - radius * 0.3,
        radius * 0.55,
        centre,
        centre,
        radius * 1.02,
      );
      shadow.addColorStop(0, "#00000000");
      shadow.addColorStop(1, "#020b1fb0");
      context.beginPath();
      context.arc(centre, centre, radius, 0, Math.PI * 2);
      context.fillStyle = shadow;
      context.fill();
      const shine = context.createRadialGradient(
        centre - radius * 0.42,
        centre - radius * 0.48,
        0,
        centre - radius * 0.42,
        centre - radius * 0.48,
        radius * 0.5,
      );
      shine.addColorStop(0, "#ffffff40");
      shine.addColorStop(1, "#ffffff00");
      context.fillStyle = shine;
      context.fill();

      // AhiBizz locations: they light up as they turn towards the viewer and pulse while in front.
      spots.forEach(([x, y, z], index) => {
        const p = project(x, y, z, spin);
        if (p.z <= 0.05) return;
        const light = Math.min(1, (p.z - 0.05) / 0.3);
        const px = centre + p.x * radius;
        const py = centre - p.y * radius;
        const pulse = still ? 0.5 : (t * 0.6 + noise(index + 11)) % 1;
        const glow = context.createRadialGradient(px, py, 0, px, py, dot * 7);
        glow.addColorStop(0, `rgba(255, 236, 180, ${0.95 * light})`);
        glow.addColorStop(0.35, `rgba(233, 202, 138, ${0.5 * light})`);
        glow.addColorStop(1, "rgba(233, 202, 138, 0)");
        context.fillStyle = glow;
        context.beginPath();
        context.arc(px, py, dot * 7, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = `rgba(255, 228, 160, ${(1 - pulse) * 0.8 * light})`;
        context.lineWidth = ratio;
        context.beginPath();
        context.arc(px, py, dot * (2 + pulse * 8), 0, Math.PI * 2);
        context.stroke();
        context.fillStyle = `rgba(255, 255, 255, ${light})`;
        context.beginPath();
        context.arc(px, py, dot * 1.3, 0, Math.PI * 2);
        context.fill();
      });

      ring(context, centre, radius);

      if (!still && visible) frame = requestAnimationFrame(draw);
    }

    const observer = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting) && document.visibilityState === "visible";
      cancelAnimationFrame(frame);
      if (visible || still) frame = requestAnimationFrame(draw);
    });
    observer.observe(element);
    const onVisibility = () => {
      visible = document.visibilityState === "visible";
      cancelAnimationFrame(frame);
      if (visible) frame = requestAnimationFrame(draw);
    };
    document.addEventListener("visibilitychange", onVisibility);
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [places]);

  // Decorative: the banner wraps it in an aria-hidden stage.
  return <canvas ref={canvas} className={className} />;
}

/** The brass half ring of a desk globe on the left, holding the tilted axis at both poles. */
function ring(context: CanvasRenderingContext2D, centre: number, radius: number) {
  context.save();
  context.translate(centre, centre);
  context.rotate(view.tilt);
  const brass = context.createLinearGradient(-radius, -radius, radius * 0.2, radius);
  brass.addColorStop(0, "#fff0c4");
  brass.addColorStop(0.45, "#d9b26a");
  brass.addColorStop(1, "#8a6526");
  context.strokeStyle = brass;
  context.fillStyle = brass;
  context.lineWidth = Math.max(2, radius * 0.05);
  context.lineCap = "round";
  context.beginPath();
  context.arc(0, 0, radius * 1.1, Math.PI * 0.5, Math.PI * 1.5);
  context.stroke();
  // Axis caps where the ring holds the globe.
  for (const y of [-1, 1]) {
    context.beginPath();
    context.arc(0, y * radius * 1.04, radius * 0.045, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}
