import { createHash } from "node:crypto";
import { subscribe } from "node:diagnostics_channel";
import { BlockList, isIP } from "node:net";

const probePath =
  /^\/api\/health\/live\?ingressProbe=([a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[1-8][a-fA-F0-9]{3}-[89abAB][a-fA-F0-9]{3}-[a-fA-F0-9]{12})$/;
const privateNetworks = new BlockList();
privateNetworks.addSubnet("10.0.0.0", 8, "ipv4");
privateNetworks.addSubnet("172.16.0.0", 12, "ipv4");
privateNetworks.addSubnet("192.168.0.0", 16, "ipv4");
privateNetworks.addSubnet("fc00::", 7, "ipv6");

/** Canonical exact addresses for observation, not BetterAuth identity or a trust decision. */
export function normalizeIngressAddress(value) {
  if (typeof value !== "string" || value.length > 64 || value.includes("%")) return null;
  const family = isIP(value);
  if (family === 4) return value;
  if (family !== 6) return null;
  const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(canonical);
  if (!mapped) return canonical;
  const high = Number.parseInt(mapped[1], 16);
  const low = Number.parseInt(mapped[2], 16);
  return [high >>> 8, high & 255, low >>> 8, low & 255].join(".");
}

function describeAddress(address, nonce, allowPrivateAddress = false) {
  const normalized = normalizeIngressAddress(address);
  if (!normalized) return { valid: false };
  const family = isIP(normalized);
  const scope =
    normalized === "::1" || (family === 4 && normalized.startsWith("127."))
      ? "loopback"
      : privateNetworks.check(normalized, family === 4 ? "ipv4" : "ipv6")
        ? "private"
        : "public_or_other";
  return {
    valid: true,
    family,
    scope,
    fingerprint: createHash("sha256")
      .update(nonce + normalized)
      .digest("hex"),
    ...(allowPrivateAddress && scope !== "public_or_other" ? { address: normalized } : {}),
  };
}

function describeHeader(rawHeaders, name, nonce, single) {
  let fieldCount = 0;
  let value;
  for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
    if (typeof rawHeaders[index] !== "string" || rawHeaders[index].toLowerCase() !== name) continue;
    fieldCount++;
    value = rawHeaders[index + 1];
  }
  const base = { fieldCount, tokenCount: 0, validCount: 0, fingerprints: [] };
  if (fieldCount === 0) return { ...base, status: "absent" };
  if (fieldCount !== 1) return { ...base, status: "duplicate_fields" };
  if (typeof value !== "string" || value.length > 2048)
    return { ...base, status: "too_long_or_invalid" };
  const tokens = value.split(",").map((token) => token.trim());
  if (tokens.length > 16) return { ...base, tokenCount: tokens.length, status: "too_many_values" };
  if (single && tokens.length !== 1)
    return { ...base, tokenCount: tokens.length, status: "multiple_values" };
  const addresses = tokens.map((token) => describeAddress(token, nonce));
  if (addresses.some((address) => !address.valid))
    return { ...base, tokenCount: tokens.length, status: "malformed_value" };
  return {
    fieldCount,
    tokenCount: tokens.length,
    validCount: addresses.length,
    fingerprints: addresses,
    status: "valid_untrusted_observation",
  };
}

/** Observation errors must never affect the HTTP handler, stream or response. */
export function createIngressObserver({
  enabled = false,
  emit = (entry) => console.info(JSON.stringify(entry)),
  now = Date.now,
} = {}) {
  let windowStarted = -Infinity;
  let windowCount = 0;
  let totalCount = 0;
  return (message) => {
    try {
      if (!enabled || !message?.request || message.request.method !== "GET") return;
      const request = message.request;
      const match = typeof request.url === "string" ? probePath.exec(request.url) : null;
      if (!match || match[0] !== request.url) return;
      const timestamp = now();
      if (!Number.isFinite(timestamp) || totalCount >= 96) return;
      if (timestamp - windowStarted >= 60_000) {
        windowStarted = timestamp;
        windowCount = 0;
      }
      if (windowCount >= 24) return;
      windowCount++;
      totalCount++;
      const nonce = match[1].toLowerCase();
      const rawHeaders = request.rawHeaders;
      const boundedHeaders = Array.isArray(rawHeaders) && rawHeaders.length <= 512;
      emit({
        event: "ahibizz_ingress_observe",
        version: 1,
        observedAt: new Date(timestamp).toISOString(),
        pid: process.pid,
        nonce,
        observationOnly: true,
        trustedForAuthentication: false,
        fingerprintScheme: "sha256(nonce + normalizedIp)",
        peer: describeAddress(request.socket?.remoteAddress, nonce, true),
        headers: boundedHeaders
          ? {
              realIp: describeHeader(rawHeaders, "x-real-ip", nonce, true),
              forwardedFor: describeHeader(rawHeaders, "x-forwarded-for", nonce, false),
            }
          : { status: "raw_headers_unavailable_or_over_limit" },
      });
    } catch {
      // Do not log the error: it could contain request data or break diagnostic subscribers.
    }
  };
}

// Node24 documents this channel as { request, response, socket, server }.
// Read IncomingMessage properties only; never attach listeners or change request/response state.
if (process.env.AHIBIZZ_INGRESS_OBSERVE === "true")
  subscribe("http.server.request.start", createIngressObserver({ enabled: true }));
