import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { AdDevice } from "../../lib/ad-catalog";

const validity = 2 * 60 * 60_000;
export function adPlatform(userAgent: string): "android" | "ios" | "desktop" | "other" {
  if (/android/i.test(userAgent)) return "android";
  if (/iphone|ipad|ipod/i.test(userAgent) || /macintosh.+mobile\//i.test(userAgent)) return "ios";
  if (/windows nt|macintosh|x11|cros/i.test(userAgent)) return "desktop";
  return "other";
}
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const syntax = new RegExp(
  `^(${uuid})\\.(${uuid})\\.(mobile|desktop)\\.(\\d{13})\\.([A-Za-z0-9_-]{43})$`,
);
function signature(claim: string, secret: string) {
  return createHmac("sha256", secret)
    .update("ahibizz:ad-view:v1:")
    .update(claim)
    .digest("base64url");
}
export function signAdToken(
  campaignId: string,
  device: AdDevice,
  secret: string,
  now = Date.now(),
) {
  const claim = [randomUUID(), campaignId, device, now].join(".");
  return `${claim}.${signature(claim, secret)}`;
}
export function readAdToken(token: unknown, secret: string, now = Date.now()) {
  if (typeof token !== "string" || token.length > 160) return null;
  const match = syntax.exec(token);
  if (!match) return null;
  const [, renderId, campaignId, device, timestamp, mac] = match;
  if (!renderId || !campaignId || !mac) return null;
  if (Number(timestamp) > now || Number(timestamp) + validity < now) return null;
  const expected = signature(token.slice(0, -44), secret);
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  return { renderId, campaignId, device: device as AdDevice, issuedAt: Number(timestamp) };
}

// One campaign, device and minute. The database never receives the tab identifier or address.
export function adFrequencyKey(
  secret: string,
  campaignId: string,
  device: AdDevice,
  scope: "tab" | "network",
  id: string,
  issuedAt: number,
) {
  return createHmac("sha256", secret)
    .update(
      JSON.stringify([
        "ahi-ad-frequency",
        scope,
        campaignId,
        device,
        Math.floor(issuedAt / 60000),
        id,
      ]),
    )
    .digest("base64url");
}
