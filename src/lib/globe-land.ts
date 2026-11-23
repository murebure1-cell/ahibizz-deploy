/**
 * Land outlines for the home banner globe, from Natural Earth 50m land (public domain, world-atlas
 * 2.0.2), packed in public/globe/land-50m.bin: Uint32 ring count, Uint32 points per ring, then Int16
 * [longitude, latitude] pairs in 1/50 degree, delta encoded per ring. Rings crossing the antimeridian are
 * unwrapped (longitudes may run past ±180) and Antarctica closes through the south pole.
 */
export const landOutlineUrl = "/globe/land-50m.bin";

/** Each ring as [longitude, latitude, longitude, latitude, ...] in degrees. */
export function decodeLand(buffer: ArrayBuffer): Float32Array[] {
  const header = new Uint32Array(buffer, 0, 1);
  const count = header[0] ?? 0;
  const lengths = new Uint32Array(buffer, 4, count);
  const body = new Int16Array(buffer, 4 * (count + 1));
  const rings: Float32Array[] = [];
  let k = 0;
  for (const length of lengths) {
    const ring = new Float32Array(length * 2);
    let x = 0;
    let y = 0;
    for (let i = 0; i < length; i++) {
      x += body[k++] ?? 0;
      y += body[k++] ?? 0;
      ring[i * 2] = x / 50;
      ring[i * 2 + 1] = y / 50;
    }
    rings.push(ring);
  }
  return rings;
}

/** Even-odd test against all rings, also one turn east and west for unwrapped rings. */
export function isLand(rings: Float32Array[], latitude: number, longitude: number) {
  for (const offset of [0, -360, 360]) {
    const lng = longitude + offset;
    let odd = false;
    for (const ring of rings)
      for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
        const xi = ring[i] ?? 0;
        const yi = ring[i + 1] ?? 0;
        const xj = ring[j] ?? 0;
        const yj = ring[j + 1] ?? 0;
        if (yi > latitude !== yj > latitude && lng < ((xj - xi) * (latitude - yi)) / (yj - yi) + xi)
          odd = !odd;
      }
    if (odd) return true;
  }
  return false;
}

export function unitVector(latitude: number, longitude: number): [number, number, number] {
  const phi = (latitude * Math.PI) / 180;
  const lambda = (longitude * Math.PI) / 180;
  return [Math.cos(phi) * Math.sin(lambda), Math.sin(phi), Math.cos(phi) * Math.cos(lambda)];
}
