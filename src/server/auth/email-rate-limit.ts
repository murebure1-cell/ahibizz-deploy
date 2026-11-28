import { createHmac } from "node:crypto";
import { type AttemptRule, countAttempt, pruneAttemptLimits } from "./attempt-limit";

type Queryable = {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
};

/**
 * Attempts per email address, whatever the client IP. Production cannot trust a client IP yet
 * (AHIBIZZ_INGRESS_TRUST_CLIENT_IP is off), so Better Auth's IP buckets fall back to one shared
 * counter per path. These per-address limits keep guessing one account's password slow without
 * letting anyone lock everybody out.
 */
export const emailRateRules: Readonly<Record<string, AttemptRule>> = {
  "/sign-in/email": { windowSeconds: 15 * 60, max: 8 },
  "/sign-up/email": { windowSeconds: 60 * 60, max: 3 },
  "/request-password-reset": { windowSeconds: 60 * 60, max: 3 },
  "/send-verification-email": { windowSeconds: 60 * 60, max: 3 },
};

export type EmailRateDecision = { allowed: true } | { allowed: false; retryAfter: number };
export type EmailRateLimiter = (path: string, email: unknown) => Promise<EmailRateDecision>;

/**
 * Counters live in auth_attempt_limit (see attempt-limit.ts) under their own key prefix. The key
 * holds an HMAC of the normalized address, never the address itself.
 */
export function createEmailRateLimiter(
  pool: Queryable,
  secret: string,
  now: () => number = Date.now,
): EmailRateLimiter {
  return async (path, email) => {
    const rule = emailRateRules[path];
    if (!rule || typeof email !== "string") return { allowed: true };
    const address = email.trim().toLowerCase();
    if (!address || address.length > 254) return { allowed: true };
    const digest = createHmac("sha256", secret).update(address).digest("hex");
    const decision = await countAttempt(pool, `ahibizz-email:${path}:${digest}`, rule, now);
    // This is the busiest counter and runs on the pool, so old windows are cleared from here.
    if (Math.random() < 0.02) await pruneAttemptLimits(pool).catch(() => undefined);
    return decision;
  };
}
