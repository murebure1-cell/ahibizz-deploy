"use client";

import { useEffect, useRef } from "react";
import { decodeLand, landOutlineUrl, unitVector } from "../../lib/globe-land";

const turnSeconds = 48;
/** Axis tilted like a desk globe, seen a little from above. */
const view = { elevation: 0.32, tilt: -0.36 };
/** Europe and Bosnia face the viewer first. */
const startLongitude = -18;
/** Share of the canvas the ball fills, leaving room for the smooth edge. */
const ballScale = 0.96;

const vertexShader = `#version 300 es
in vec2 corner;
out vec2 spot;
void main() {
  spot = corner;
  gl_Position = vec4(corner, 0.0, 1.0);
}`;

// Every pixel of the ball looks up its latitude and longitude in the land texture, then gets lit:
// lacquered deep blue sea, smooth polished gold land, a soft highlight and a thin blue rim.
const fragmentShader = `#version 300 es
precision highp float;
in vec2 spot;
out vec4 colour;
uniform sampler2D land;
uniform float spin;
uniform float elevation;
uniform float tilt;
uniform float pixel;
const float PI = 3.141592653589793;
void main() {
  vec2 p = spot / ${ballScale.toFixed(2)};
  float r = length(p);
  float edge = 1.0 - smoothstep(1.0 - 1.5 * pixel, 1.0, r);
  if (edge <= 0.0) discard;
  vec3 n = vec3(p, sqrt(max(0.0, 1.0 - r * r)));

  float ct = cos(tilt), st = sin(tilt);
  vec3 a = vec3(n.x * ct + n.y * st, -n.x * st + n.y * ct, n.z);
  float ce = cos(elevation), se = sin(elevation);
  vec3 b = vec3(a.x, a.y * ce + a.z * se, -a.y * se + a.z * ce);
  float cs = cos(spin), ss = sin(spin);
  vec3 w = vec3(b.x * cs - b.z * ss, b.y, b.x * ss + b.z * cs);

  float u = atan(w.x, w.z) / (2.0 * PI) + 0.5;
  float v = 0.5 - asin(clamp(w.y, -1.0, 1.0)) / PI;
  // Pick the smaller derivative across the date line so no seam appears there.
  float u2 = fract(u + 0.5) - 0.5;
  float dx = abs(dFdx(u)) < abs(dFdx(u2)) ? dFdx(u) : dFdx(u2);
  float dy = abs(dFdy(u)) < abs(dFdy(u2)) ? dFdy(u) : dFdy(u2);
  float isLand = textureGrad(land, vec2(u, v), vec2(dx, dFdx(v)), vec2(dy, dFdy(v))).a;

  vec3 light = normalize(vec3(-0.45, 0.55, 0.7));
  vec3 half_ = normalize(light + vec3(0.0, 0.0, 1.0));
  float diffuse = max(dot(n, light), 0.0);
  float facing = max(dot(n, half_), 0.0);

  // AhiBizz palette: navy sea (#0b1a2b to #2f5a85) and the brand gold #e9ca8a.
  vec3 sea = mix(vec3(0.043, 0.102, 0.169), vec3(0.184, 0.353, 0.522), diffuse);
  sea += vec3(0.72, 0.8, 0.9) * pow(facing, 120.0) * 0.22;
  vec3 gold = mix(vec3(0.42, 0.33, 0.17), vec3(0.914, 0.792, 0.541), diffuse);
  gold += vec3(1.0, 0.95, 0.82) * pow(facing, 24.0) * 0.2;
  vec3 c = mix(sea, gold, isLand);
  c += vec3(0.48, 0.6, 0.74) * pow(1.0 - n.z, 2.8) * (0.08 + 0.16 * diffuse);
  colour = vec4(c * edge, edge);
}`;

/** Equirectangular land mask: white land on a transparent sea, 2048 × 1024. */
function landTexture(rings: Float32Array[]) {
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 1024;
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  const sx = canvas.width / 360;
  const sy = canvas.height / 180;
  context.fillStyle = "#fff";
  context.beginPath();
  for (const offset of [-360, 0, 360])
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i += 2) {
        const x = ((ring[i] ?? 0) + 180 + offset) * sx;
        const y = (90 - (ring[i + 1] ?? 0)) * sy;
        if (i === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.closePath();
    }
  context.fill("evenodd");
  return canvas;
}

function compile(gl: WebGL2RenderingContext) {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertexShader],
    [gl.FRAGMENT_SHADER, fragmentShader],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return null;
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
}

/** Same rotation as the shader, for the location lights drawn on top. */
function project([vx, vy, vz]: [number, number, number], spin: number) {
  const x1 = vx * Math.cos(spin) + vz * Math.sin(spin);
  const z1 = vz * Math.cos(spin) - vx * Math.sin(spin);
  const y2 = vy * Math.cos(view.elevation) - z1 * Math.sin(view.elevation);
  const z2 = vy * Math.sin(view.elevation) + z1 * Math.cos(view.elevation);
  return {
    x: x1 * Math.cos(view.tilt) - y2 * Math.sin(view.tilt),
    y: x1 * Math.sin(view.tilt) + y2 * Math.cos(view.tilt),
    z: z2,
  };
}

/**
 * Clean, sharp blue globe with smooth gold continents that turns slowly; AhiBizz locations glow softly in
 * gold while they face the viewer.
 */
export function GoldGlobe({
  places,
  className,
}: {
  places: [number, number][];
  className?: string;
}) {
  const ball = useRef<HTMLCanvasElement>(null);
  const lights = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ballCanvas = ball.current;
    const lightCanvas = lights.current;
    const gl = ballCanvas?.getContext("webgl2", { antialias: true, premultipliedAlpha: true });
    const overlay = lightCanvas?.getContext("2d");
    if (!ballCanvas || !lightCanvas || !overlay) return;
    const program = gl ? compile(gl) : null;
    const spots = places.map(([lat, lng]) => unitVector(lat, lng));
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let visible = true;
    let cancelled = false;
    const started = performance.now();

    if (gl && program) {
      // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram is not a React hook.
      gl.useProgram(program);
      const corners = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, corners);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        gl.STATIC_DRAW,
      );
      const corner = gl.getAttribLocation(program, "corner");
      gl.enableVertexAttribArray(corner);
      gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      // Sea only until the outlines arrive.
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array(4),
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      void fetch(landOutlineUrl)
        .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject()))
        .then((buffer) => {
          if (cancelled) return;
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            landTexture(decodeLand(buffer)),
          );
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          // Keeps coasts near the poles sharp where the flat map is stretched sideways.
          const anisotropic = gl.getExtension("EXT_texture_filter_anisotropic");
          if (anisotropic)
            gl.texParameterf(
              gl.TEXTURE_2D,
              anisotropic.TEXTURE_MAX_ANISOTROPY_EXT,
              Math.min(16, gl.getParameter(anisotropic.MAX_TEXTURE_MAX_ANISOTROPY_EXT)),
            );
          if (still) frame = requestAnimationFrame(draw);
        })
        .catch(() => {});
    }

    function size(canvas: HTMLCanvasElement) {
      const pixels = Math.round(canvas.clientWidth * Math.min(window.devicePixelRatio || 1, 3));
      if (canvas.width !== pixels) {
        canvas.width = pixels;
        canvas.height = pixels;
      }
      return pixels;
    }

    function draw(now: number) {
      if (!ballCanvas || !lightCanvas || !overlay) return;
      const t = still ? 0 : (now - started) / 1000;
      const spin = ((startLongitude + (t * 360) / turnSeconds) * Math.PI) / 180;
      const pixels = size(ballCanvas);
      size(lightCanvas);
      const radius = (pixels / 2) * ballScale;

      if (gl && program) {
        gl.viewport(0, 0, pixels, pixels);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform1f(gl.getUniformLocation(program, "spin"), spin);
        gl.uniform1f(gl.getUniformLocation(program, "elevation"), view.elevation);
        gl.uniform1f(gl.getUniformLocation(program, "tilt"), view.tilt);
        gl.uniform1f(gl.getUniformLocation(program, "pixel"), 1 / radius);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }

      overlay.setTransform(1, 0, 0, 1, 0, 0);
      overlay.clearRect(0, 0, pixels, pixels);
      const centre = pixels / 2;
      if (!gl || !program) {
        // No WebGL 2: a plain lacquered blue ball, still with the lights.
        const sea = overlay.createRadialGradient(
          centre - radius * 0.4,
          centre - radius * 0.45,
          radius * 0.05,
          centre,
          centre,
          radius,
        );
        sea.addColorStop(0, "#2f5a85");
        sea.addColorStop(0.6, "#173047");
        sea.addColorStop(1, "#0b1a2b");
        overlay.fillStyle = sea;
        overlay.beginPath();
        overlay.arc(centre, centre, radius, 0, Math.PI * 2);
        overlay.fill();
      }
      const unit = Math.max(1, pixels / 230);
      const breath = still ? 1 : 0.8 + 0.2 * Math.sin(t * 2.1);
      for (const spot of spots) {
        const p = project(spot, spin);
        if (p.z <= 0.08) continue;
        const light = Math.min(1, (p.z - 0.08) / 0.3);
        const x = centre + p.x * radius;
        const y = centre - p.y * radius;
        const halo = overlay.createRadialGradient(x, y, 0, x, y, unit * 6);
        halo.addColorStop(0, `rgba(255, 226, 150, ${0.55 * light * breath})`);
        halo.addColorStop(1, "rgba(255, 226, 150, 0)");
        overlay.fillStyle = halo;
        overlay.beginPath();
        overlay.arc(x, y, unit * 6, 0, Math.PI * 2);
        overlay.fill();
        overlay.fillStyle = `rgba(255, 248, 225, ${light})`;
        overlay.beginPath();
        overlay.arc(x, y, unit * 1.5, 0, Math.PI * 2);
        overlay.fill();
      }

      if (!still && visible) frame = requestAnimationFrame(draw);
    }

    const observer = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting) && document.visibilityState === "visible";
      cancelAnimationFrame(frame);
      if (visible || still) frame = requestAnimationFrame(draw);
    });
    observer.observe(ballCanvas);
    const onVisibility = () => {
      visible = document.visibilityState === "visible";
      cancelAnimationFrame(frame);
      if (visible) frame = requestAnimationFrame(draw);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [places]);

  // Decorative: the banner wraps it in an aria-hidden stage.
  return (
    <div className={className}>
      <canvas ref={ball} />
      <canvas ref={lights} />
    </div>
  );
}
