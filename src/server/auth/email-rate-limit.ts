import { createHmac, randomUUID } from "node:crypto";

type Queryable = {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
};

/**
 * Attempts per email address, whatever the client IP. Production cannot trust a client IP yet
 * (AHIBIZZ_INGRESS_TRUST_CLIENT_IP is off), so Better Auth's IP buckets fall back to one shared
 * counter per path. These per-address limits keep guessing one account's password slow without
 * letting anyone lock everybody out.
 */
export const emailRateRules: Readonly<Record<string, { windowSeconds: number; max: number }>> = {
  "/sign-in/email": { windowSeconds: 15 * 60, max: 8 },
  "/sign-up/email": { windowSeconds: 60 * 60, max: 3 },
  "/request-password-reset": { windowSeconds: 60 * 60, max: 3 },
  "/send-verification-email": { windowSeconds: 60 * 60, max: 3 },
};

export type EmailRateDecision = { allowed: true } | { allowed: false; retryAfter: number };
export type EmailRateLimiter = (path: string, email: unknown) => Promise<EmailRateDecision>;

/**
 * Counters share Better Auth's auth_rate_limit table under their own key prefix. The key holds an
 * HMAC of the normalized address, never the address itself. One atomic upsert per attempt: a
 * fixed window that restarts once it has fully passed.
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
    const key = `ahibizz-email:${path}:${digest}`;
    const at = now();
    const windowMs = rule.windowSeconds * 1000;
    const { rows } = await pool.query(
      `INSERT INTO auth_rate_limit(id,key,count,"lastRequest") VALUES($1,$2,1,$3)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN $3 - auth_rate_limit."lastRequest" >= $4 THEN 1
                      ELSE auth_rate_limit.count + 1 END,
         "lastRequest" = CASE WHEN $3 - auth_rate_limit."lastRequest" >= $4 THEN $3
                              ELSE auth_rate_limit."lastRequest" END
       RETURNING count, "lastRequest"`,
      [randomUUID(), key, at, windowMs],
    );
    const row = rows[0] as { count: number; lastRequest: string | number } | undefined;
    if (!row || row.count <= rule.max) return { allowed: true };
    const retryAfter = Math.ceil((Number(row.lastRequest) + windowMs - at) / 1000);
    return { allowed: false, retryAfter: Math.max(1, retryAfter) };
  };
}
