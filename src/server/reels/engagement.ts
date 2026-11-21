import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { businessUuid } from "../../lib/business-today";
import type { ReelEngagement } from "../../lib/reels";
import { AccountAccessError, accountTransaction, createAccountAccess } from "../auth/accounts";
import { type AuthService, getAuthDatabasePool, getAuthService } from "../auth/service";
import { publicReels } from "./service";

const cookieName = "ahi_reel_viewer";
const signaturePattern = /^[A-Za-z0-9_-]{43}$/;
const dayMillis = 86_400_000;
type EngagementCommand = { action: "view" } | { action: "like"; liked: boolean };

const notFound = () => new AccountAccessError(404, "REEL_NOT_FOUND");
const invalid = () => new AccountAccessError(400, "REEL_INPUT");

export function parseReelEngagement(input: unknown): EngagementCommand {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid();
  const value = input as Record<string, unknown>;
  if (value.action === "view" && Object.keys(value).length === 1) return { action: "view" };
  if (
    value.action === "like" &&
    Object.keys(value).length === 2 &&
    typeof value.liked === "boolean"
  )
    return { action: "like", liked: value.liked };
  throw invalid();
}

function signBrowser(secret: string, claim: string) {
  return createHmac("sha256", secret)
    .update("ahibizz:reel-browser:v1:")
    .update(claim)
    .digest("base64url");
}

export function reelBrowser(headers: Headers, secret: string, secure: boolean, now = Date.now()) {
  const token = headers
    .get("cookie")
    ?.split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
  const [id, expiry, mac, extra] = token?.split(".") ?? [];
  if (
    extra === undefined &&
    businessUuid(id) &&
    expiry &&
    /^\d{10,11}$/.test(expiry) &&
    Number(expiry) > Math.floor(now / 1000) &&
    mac &&
    signaturePattern.test(mac) &&
    timingSafeEqual(Buffer.from(mac), Buffer.from(signBrowser(secret, `${id}.${expiry}`)))
  ) {
    return { id, cookie: null };
  }
  const browser = randomUUID();
  // Rotate at a UTC day boundary so a browser doesn't acquire two viewer keys in the same day.
  const expirySeconds = ((Math.floor(now / dayMillis) + 2) * dayMillis) / 1000;
  const maxAge = expirySeconds - Math.floor(now / 1000);
  const issued = `${browser}.${expirySeconds}`;
  return {
    id: null,
    cookie: `${cookieName}=${issued}.${signBrowser(secret, issued)}; Path=/api/reels/engagement/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`,
  };
}

function viewKey(secret: string, reelId: string, day: string, viewer: string) {
  return createHmac("sha256", secret)
    .update(JSON.stringify(["ahibizz:reel-view:v1", reelId, day, viewer]))
    .digest();
}

type Query = Pick<PoolClient, "query">;
async function state(
  client: Query,
  id: string,
  accountId: string | null,
  lock = false,
): Promise<ReelEngagement> {
  const { rows } = await client.query<Omit<ReelEngagement, "accountId">>(
    `SELECT r.view_count::double precision AS views,
       (SELECT count(*)::double precision FROM business_reel_like l WHERE l.reel_id=r.id) AS likes,
       EXISTS (SELECT 1 FROM business_reel_like l WHERE l.reel_id=r.id AND l.user_id=$2) AS liked,
       ($2::text IS NOT NULL AND NOT people_contact_blocked($2,r.submitted_by)) AS "canLike"
     ${publicReels} AND r.id=$1 ${lock ? "FOR NO KEY UPDATE OF r" : ""}`,
    [id, accountId],
  );
  if (!rows[0]) throw notFound();
  return { ...rows[0], accountId };
}

async function recordView(client: Query, id: string, viewer: string, secret: string, now: number) {
  const day = new Date(now).toISOString().slice(0, 10);
  const oldDay = new Date(now - dayMillis).toISOString().slice(0, 10);
  const counted = await client.query(
    `WITH fresh AS (
       INSERT INTO business_reel_view(reel_id,day,viewer_key) VALUES($1,$2::date,$3)
       ON CONFLICT DO NOTHING RETURNING reel_id
     )
     UPDATE business_reel SET view_count=view_count+1 WHERE id=(SELECT reel_id FROM fresh)`,
    [id, day, viewKey(secret, id, day, viewer)],
  );
  if (!counted.rowCount) return;
  await client.query(
    `DELETE FROM business_reel_view WHERE (reel_id,day,viewer_key) IN (
       SELECT reel_id,day,viewer_key FROM business_reel_view
       WHERE reel_id=$1 AND day<$2::date ORDER BY day,viewer_key LIMIT 128
     )`,
    [id, oldDay],
  );
}

export function createReelEngagementService(auth: AuthService, pool: Pool, secret: string) {
  const access = createAccountAccess(auth);
  const isGuestError = (error: unknown) =>
    error instanceof AccountAccessError && (error.status === 401 || error.status === 403);

  async function viewerSession(headers: Headers, requireAccount: boolean) {
    if (requireAccount && !headers.has("X-AhiBizz-Account-ID"))
      throw new AccountAccessError(401, "AUTHENTICATION_REQUIRED");
    if (!requireAccount && !headers.get("cookie")) return null;
    try {
      return await access.session(headers);
    } catch (error) {
      if (!requireAccount && isGuestError(error)) return null;
      throw error;
    }
  }
  async function readOrWrite(
    headers: Headers,
    id: string,
    command: EngagementCommand | null,
    secure: boolean,
    now = Date.now(),
  ) {
    if (!businessUuid(id)) throw notFound();
    const requireAccount = command?.action === "like";
    const session = await viewerSession(headers, requireAccount);
    const browser = requireAccount ? null : reelBrowser(headers, secret, secure, now);
    if (!session && (!command || !browser?.id))
      return { stats: await state(pool, id, null), cookie: browser?.cookie ?? null };

    return accountTransaction(pool, async (client) => {
      let accountId: string | null = null;
      if (session) {
        try {
          accountId = (await access.authority(client, session, false, "read")).id;
        } catch (error) {
          if (requireAccount || !isGuestError(error)) throw error;
        }
      }
      const cookie = accountId ? null : (browser?.cookie ?? null);
      const viewer = accountId
        ? `account:${accountId}`
        : browser?.id
          ? `guest:${browser.id}`
          : null;
      if (!command || (command.action === "view" && !viewer))
        return { stats: await state(client, id, accountId), cookie };

      const before = await state(client, id, accountId, true);
      if (command.action === "like") {
        if (!accountId) throw new AccountAccessError(401, "AUTHENTICATION_REQUIRED");
        if (!before.canLike) throw new AccountAccessError(403, "REEL_LIKE_UNAVAILABLE");
        await client.query(
          command.liked
            ? "INSERT INTO business_reel_like(reel_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING"
            : "DELETE FROM business_reel_like WHERE reel_id=$1 AND user_id=$2",
          [id, accountId],
        );
      } else if (viewer) {
        await recordView(client, id, viewer, secret, now);
      }
      return { stats: await state(client, id, accountId), cookie };
    });
  }
  return { readOrWrite };
}

export function readReelEngagement(
  headers: Headers,
  id: string,
  command: EngagementCommand | null,
  config: { secret: string; baseURL: string },
) {
  const auth = getAuthService();
  const pool = getAuthDatabasePool();
  if (!auth || !pool) throw new AccountAccessError(503, "REEL_UNAVAILABLE");
  return createReelEngagementService(auth, pool, config.secret).readOrWrite(
    headers,
    id,
    command,
    config.baseURL.startsWith("https:"),
  );
}
