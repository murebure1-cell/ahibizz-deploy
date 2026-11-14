import {
  type BusinessLocationResult,
  isLocationPoint,
  type LocationPoint,
  parsePhotonResults,
} from "./business-location";

export const GEOCODING_ORIGIN = "https://photon.komoot.io";
const cache = new Map<string, { expires: number; items: BusinessLocationResult[] }>();
async function fetchResults(path: string, signal: AbortSignal): Promise<BusinessLocationResult[]> {
  signal.throwIfAborted();
  const hit = cache.get(path);
  if (hit && hit.expires > Date.now()) return hit.items;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();
  const timer = setTimeout(abort, 8000);
  try {
    const response = await fetch(`${GEOCODING_ORIGIN}${path}`, {
      signal: controller.signal,
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "strict-origin-when-cross-origin",
    });
    if (!response.ok) throw new Error("geocoding_unavailable");
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > 250000) throw new Error("geocoding_response_too_large");
    if (!response.body) throw new Error("geocoding_empty_response");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 250000) throw new Error("geocoding_response_too_large");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    controller.signal.throwIfAborted();
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const items = parsePhotonResults(JSON.parse(new TextDecoder().decode(bytes)));
    if (!signal.aborted) {
      if (cache.size >= 30) cache.delete(cache.keys().next().value ?? "");
      cache.set(path, { items, expires: Date.now() + 600000 });
    }
    return items;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
export function searchLocations(value: string, signal: AbortSignal) {
  const q = value.trim();
  if (q.length < 3 || q.length > 160) throw new Error("invalid_search");
  return fetchResults(`/api/?${new URLSearchParams({ q, limit: "5" })}`, signal);
}
export async function addressAtPoint(point: LocationPoint, signal: AbortSignal) {
  if (!isLocationPoint(point)) throw new Error("invalid_point");
  const parameters = new URLSearchParams({
    lat: String(point.latitude),
    lon: String(point.longitude),
    limit: "1",
  });
  return (await fetchResults(`/reverse?${parameters}`, signal))[0] ?? null;
}
