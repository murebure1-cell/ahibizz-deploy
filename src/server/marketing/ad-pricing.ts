import type { Pool, PoolClient } from "pg";
import { type AdPricing, type AdPricingChange, parseAdPricingChange } from "../../lib/ad-pricing";
import { AccountAccessError, accountTransaction, createAccountAccess } from "../auth/accounts";
import { getAuthDatabasePool, getAuthService } from "../auth/service";

export async function readAdPricing(
  db: Pick<PoolClient, "query"> | Pool,
  lock = false,
): Promise<AdPricing> {
  // The catalog and its overrides must use the same committed revision.
  if (lock) await db.query("SELECT revision FROM ad_rate_card WHERE singleton FOR SHARE");
  const result = await db.query<AdPricing>(`SELECT c.revision AS version,
    jsonb_build_object('minimumMinor',c.minimum_minor,'volumePercent',c.volume_percent,'advancePercent',c.advance_percent,'welcomePercent',c.welcome_percent) AS terms,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('formatId',format_id,'page',page,'device',device,'available',available,'cpmMinor',cpm_minor) ORDER BY format_id,page,device) FROM ad_placement_rate),'[]'::jsonb) AS overrides
    , c.contact_phone AS "contactPhone" FROM ad_rate_card c WHERE singleton`);
  if (!result.rows[0]) throw new AccountAccessError(503, "RATE_CARD_UNAVAILABLE");
  return result.rows[0];
}
export async function getPublicAdPricing(): Promise<AdPricing | null> {
  const pool = getAuthDatabasePool();
  if (!pool) return null;
  try {
    return await readAdPricing(pool);
  } catch {
    return null;
  }
}
export async function updateAdPricing(
  client: PoolClient,
  owner: string,
  change: AdPricingChange,
): Promise<AdPricing> {
  const updated = await client.query(
    "UPDATE ad_rate_card SET revision=revision+1,updated_at=now(),updated_by=$2 WHERE singleton AND revision=$1 RETURNING revision",
    [change.version, owner],
  );
  if (!updated.rowCount) throw new AccountAccessError(409, "RATE_CARD_CHANGED");
  if (change.action === "contact") {
    await client.query("UPDATE ad_rate_card SET contact_phone=$1 WHERE singleton", [
      change.contactPhone,
    ]);
  } else if (change.action === "terms") {
    await client.query(
      "UPDATE ad_rate_card SET minimum_minor=$1,volume_percent=$2,advance_percent=$3,welcome_percent=$4 WHERE singleton",
      [change.minimumMinor, change.volumePercent, change.advancePercent, change.welcomePercent],
    );
  } else {
    await client.query(
      "INSERT INTO ad_placement_rate(format_id,page,device,available,cpm_minor) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(format_id,page,device) DO UPDATE SET available=excluded.available,cpm_minor=excluded.cpm_minor",
      [change.formatId, change.page, change.device, change.available, change.cpmMinor],
    );
  }
  return readAdPricing(client);
}
export async function adminAdPricing(headers: Headers, input?: unknown): Promise<AdPricing> {
  const auth = getAuthService(),
    pool = getAuthDatabasePool();
  if (!auth || !pool) throw new AccountAccessError(503, "RATE_CARD_UNAVAILABLE");
  if (!headers.get("X-AhiBizz-Account-ID"))
    throw new AccountAccessError(401, "ACCOUNT_IDENTITY_CHANGED");
  const access = createAccountAccess(auth);
  const scope = await access.session(headers);
  return accountTransaction(pool, async (client) => {
    const actor = await access.authority(
      client,
      scope,
      true,
      input === undefined ? "read" : "write",
    );
    if (input === undefined) return readAdPricing(client);
    const change = parseAdPricingChange(input);
    if (!change) throw new AccountAccessError(400, "INVALID_RATE_CARD");
    return updateAdPricing(client, actor.id, change);
  });
}
