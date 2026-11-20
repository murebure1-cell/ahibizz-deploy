import type { PoolClient } from "pg";
import {
  type AudienceChoice,
  type AudienceRegion,
  audienceRegions,
  isAudienceChoice,
} from "../lib/ad-audience-sample";
import { AccountAccessError, accountTransaction, createAccountAccess } from "./auth/accounts";
import { getAuthDatabasePool, getAuthService } from "./auth/service";

async function asMember<T>(
  h: Headers,
  write: boolean,
  fn: (client: PoolClient, id: string) => Promise<T>,
) {
  if (!h.get("X-AhiBizz-Account-ID")) throw new AccountAccessError(401, "AUTHENTICATION_REQUIRED");
  const pool = getAuthDatabasePool(),
    auth = getAuthService();
  if (!pool || !auth) throw new AccountAccessError(503, "ACCOUNT_UNAVAILABLE");
  const access = createAccountAccess(auth),
    scope = await access.session(h);
  return accountTransaction(pool, async (client) => {
    const member = await access.authority(client, scope, false, write ? "write" : "read");
    return fn(client, member.id);
  });
}
export async function measurementChoice(
  h: Headers,
  change?: { choice: AudienceChoice; expected: AudienceChoice },
) {
  return asMember(h, change !== undefined, async (client, id) => {
    const row = (
      await client.query<{ region: AudienceRegion | null }>(
        "SELECT region FROM ad_measurement_consent WHERE account_id=$1",
        [id],
      )
    ).rows[0];
    const current: AudienceChoice = row ? (row.region ?? "general") : "off";
    if (!change || current === change.choice) return current;
    if (!isAudienceChoice(change.choice) || !isAudienceChoice(change.expected))
      throw new AccountAccessError(400, "INVALID_CHOICE");
    if (current !== change.expected) throw new AccountAccessError(409, "PREFERENCE_CHANGED");
    if (change.choice === "off") {
      await client.query("DELETE FROM ad_measurement_consent WHERE account_id=$1", [id]);
    } else {
      await client.query(
        "INSERT INTO ad_measurement_consent(account_id,region) VALUES($1,$2) ON CONFLICT(account_id) DO UPDATE SET region=excluded.region,updated_at=now()",
        [id, change.choice === "general" ? null : change.choice],
      );
    }
    return change.choice;
  });
}
export async function countAudienceNavigation(client: PoolClient, id: string, eventId: string) {
  const consent = await client.query(
    "SELECT 1 FROM ad_measurement_consent WHERE account_id=$1 FOR UPDATE",
    [id],
  );
  if (!consent.rowCount) return false;
  await client.query(
    `WITH last_seen AS (SELECT MAX(seen_at) AS at FROM ad_audience_navigation WHERE account_id=$1)
      INSERT INTO ad_audience_navigation(account_id,event_id,starts_visit)
      SELECT $1,$2,(at IS NULL OR at <= now()-interval '30 minutes') FROM last_seen
      WHERE at IS NULL OR at < now()-interval '1 second'
      ON CONFLICT(account_id,event_id) DO NOTHING`,
    [id, eventId],
  );
  // Bound cleanup work even after a quiet period.
  await client.query(`DELETE FROM ad_audience_navigation WHERE ctid IN
    (SELECT ctid FROM ad_audience_navigation WHERE seen_at < current_date-30 ORDER BY seen_at LIMIT 100)`);
  return true;
}
export function recordAudienceNavigation(h: Headers, id: string) {
  return asMember(h, false, (client, account) => countAudienceNavigation(client, account, id));
}
export async function publicOptInAudience(pool = getAuthDatabasePool()) {
  if (!pool) return null;
  try {
    const { rows } = await pool.query<{
      region: AudienceRegion | null;
      total: boolean;
      users: number;
      visits: number;
      views: number;
    }>(
      `WITH participants AS (
        SELECT c.account_id,c.region,count(n.event_id) AS views,count(*) FILTER(WHERE n.starts_visit) AS visits
        FROM ad_measurement_consent c JOIN ad_audience_navigation n USING(account_id)
        JOIN auth_user u ON u.id=c.account_id AND u.approval='approved' AND u."emailVerified" AND u.role IN('member','owner')
        WHERE n.seen_at >= current_date-29 GROUP BY c.account_id,c.region)
       SELECT region,GROUPING(region)=1 AS total,count(*)::int AS users,sum(visits)::int AS visits,sum(views)::int AS views
       FROM participants GROUP BY GROUPING SETS ((),(region)) HAVING count(*) >= 10 ORDER BY users DESC`,
    );
    const all = rows.find((r) => r.total);
    return all
      ? {
          users: all.users,
          visits: all.visits,
          views: all.views,
          regions: rows.flatMap((r) =>
            !r.total && r.region ? [{ region: audienceRegions[r.region], users: r.users }] : [],
          ),
        }
      : null;
  } catch {
    return null;
  }
}
