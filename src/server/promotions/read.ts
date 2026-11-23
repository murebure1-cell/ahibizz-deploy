import { isPromotionKind, type PromotionKind } from "../../lib/promotions";
import { getDatabase } from "../db";

export function activePromotionSql(alias: string, kind: PromotionKind) {
  if (!/^[a-z][a-z0-9_]*$/.test(alias) || !isPromotionKind(kind))
    throw new Error("Invalid promotion query");
  return `EXISTS(SELECT 1 FROM promotion_order promotion WHERE promotion.business_id=${alias}.id AND promotion.owner_id=${alias}.owner_user_id
    AND promotion.kind='${kind}' AND promotion.status='active' AND promotion.starts_at<=now() AND promotion.ends_at>now()
    AND promotion.scope_key=${kind === "nearby" ? `lower(btrim(${alias}.city))` : kind === "category" ? `${alias}.category_id::text` : "'*'"})`;
}
const visibleBanner = `FROM promotion_order o JOIN promotion_banner_image i ON i.order_id=o.id
  JOIN directory_business b ON b.id=o.business_id JOIN auth_user u ON u.id=b.owner_user_id
  WHERE o.kind='banner' AND o.status='active' AND o.starts_at<=now() AND o.ends_at>now()
  AND o.owner_id=b.owner_user_id AND b.status='published' AND b.deleted_at IS NULL
  AND u.approval='approved' AND u."emailVerified" AND u.role IN ('member','owner')`;
export async function getActiveBanner() {
  const db = getDatabase();
  if (!db.configured()) return null;
  const row = (
    await db.query(
      `SELECT o.id,b.id AS "businessId",b.title,b.city ${visibleBanner} ORDER BY o.starts_at,o.id LIMIT 1`,
    )
  ).rows[0];
  return row
    ? {
        id: String(row.id),
        businessId: String(row.businessId),
        title: String(row.title),
        city: row.city ? String(row.city) : null,
        image: `/api/promotions/${row.id}/image`,
      }
    : null;
}
export async function getPublicPromotionImage(id: string): Promise<Uint8Array | null> {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return null;
  const db = getDatabase();
  if (!db.configured()) return null;
  const row = (await db.query(`SELECT i.bytes ${visibleBanner} AND o.id=$1`, [id])).rows[0];
  return row?.bytes instanceof Uint8Array ? row.bytes : null;
}
