import type { PoolClient } from "pg";
import { businessMediaUrl } from "../../lib/business-media";
import { type Database, getDatabase } from "../db";
import { promotionSql } from "../paypal/store";

export function creditBalanceSql(account: string) {
  if (!/^(?:\$[1-9]\d*|[a-z_]\w*\.[a-z_]\w*)$/i.test(account))
    throw new Error("Invalid account expression");
  return `(ahi_wallet_available_minor(${account})::numeric/100)`;
}
// Directory callers have already constrained the business to its eligible public owner.
export function paidPlacementSql(kind: "featured" | "nearby") {
  if (kind !== "featured" && kind !== "nearby") throw new Error("Invalid placement");
  return `(paid_package_placement(b,'${kind}') OR EXISTS (SELECT 1 FROM marketing_order placement
    WHERE placement.business_id=b.id AND placement.account_id=b.owner_user_id AND placement.kind='${kind}'
      AND placement.status='paid' AND placement.revoked_at IS NULL AND placement.starts_at<=now() AND placement.ends_at>now()))`;
}
export async function packagePromotions(client: PoolClient, accountId: string) {
  return (
    await client.query<{ id: string; title: string; kind: "featured" | "nearby"; endsAt: string }>(
      `
    SELECT b.id,b.title,slot.kind,p.expires::text AS "endsAt"
    FROM directory_business b CROSS JOIN (VALUES ('featured'),('nearby')) AS slot(kind)
    CROSS JOIN LATERAL (SELECT paid_package_placement_until(b,slot.kind) expires) p
    WHERE b.owner_user_id=$1 AND b.status='published' AND package_allows_listing(b)
      AND (slot.kind<>'nearby' OR (b.latitude IS NOT NULL AND b.longitude IS NOT NULL))
      AND p.expires>now()
    ORDER BY p.expires,b.id,slot.kind`,
      [accountId],
    )
  ).rows;
}

export async function paidPromotions(client: PoolClient, accountId: string) {
  return (
    await client.query<{ id: string; title: string; endsAt: string }>(
      `
    SELECT b.id,b.title,max(p.ends_at)::text AS "endsAt" FROM directory_business b
    JOIN (
      SELECT pe.business_id,pe.category_id,pe.ends_at FROM paypal_promotion_entitlement pe
        JOIN paypal_checkout_order po ON po.id=pe.order_id
        WHERE pe.user_id=$1 AND pe.revoked_at IS NULL AND pe.starts_at<=now() AND pe.ends_at>now()
          AND po.environment='live' AND po.status='captured' AND po.refunded_minor=0 AND NOT po.refund_total_unknown
      UNION ALL
      SELECT w.business_id,w.category_id,w.ends_at FROM wallet_category_promotion w
        WHERE w.account_id=$1 AND w.revoked_at IS NULL AND w.starts_at<=now() AND w.ends_at>now()
    ) p ON p.business_id=b.id AND p.category_id=b.category_id
    WHERE b.owner_user_id=$1 AND ${promotionSql("b")}
    GROUP BY b.id,b.title ORDER BY max(p.ends_at),b.id LIMIT 200`,
      [accountId],
    )
  ).rows;
}

export type PublicBanner = { id: string; title: string; city: string; image: string | null };
export async function readActiveBanner(
  database: Pick<Database, "query">,
): Promise<PublicBanner | null> {
  const { rows } = await database.query(`
      WITH active AS (
        SELECT b.id,b.title,b.city,i.version,row_number() OVER (ORDER BY o.id)-1 AS pos,count(*) OVER () AS total
        FROM marketing_order o JOIN directory_business b ON b.id=o.business_id AND b.owner_user_id=o.account_id
        JOIN auth_user u ON u.id=o.account_id
        LEFT JOIN directory_business_image i ON i.business_id=b.id AND i.kind='cover' AND i.slot=0
        WHERE o.kind='banner' AND o.status='paid' AND o.revoked_at IS NULL AND o.starts_at<=now() AND o.ends_at>now()
          AND NOT EXISTS (SELECT 1 FROM marketing_campaign_brief brief WHERE brief.order_id=o.id)
          AND b.status='published' AND package_allows_listing(b) AND u.approval='approved' AND u."emailVerified" AND u.role IN ('member','owner')
      )
      SELECT id,title,city,version FROM active WHERE pos=mod(floor(extract(epoch FROM now())/60)::bigint, total) LIMIT 1`);
  const row = rows[0];
  return row
    ? {
        id: String(row.id),
        title: String(row.title),
        city: String(row.city ?? ""),
        image: row.version
          ? businessMediaUrl(String(row.id), {
              kind: "cover",
              slot: 0,
              version: Number(row.version),
              width: 1600,
              height: 600,
            })
          : null,
      }
    : null;
}
export async function publicMarketingBanner(): Promise<PublicBanner | null> {
  const database = getDatabase();
  if (!database.configured()) return null;
  try {
    return await readActiveBanner(database);
  } catch {
    return null;
  }
}
