// The purchase flow was removed on 2026-11-25. The tables from migration 0054 remain, so a
// promotion that was already active keeps its place until it ends.
const kinds = ["home", "category", "nearby", "banner"] as const;
export type PromotionKind = (typeof kinds)[number];

export function activePromotionSql(alias: string, kind: PromotionKind) {
  if (!/^[a-z][a-z0-9_]*$/.test(alias) || !kinds.includes(kind))
    throw new Error("Invalid promotion query");
  return `EXISTS(SELECT 1 FROM promotion_order promotion WHERE promotion.business_id=${alias}.id AND promotion.owner_id=${alias}.owner_user_id
    AND promotion.kind='${kind}' AND promotion.status='active' AND promotion.starts_at<=now() AND promotion.ends_at>now()
    AND promotion.scope_key=${kind === "nearby" ? `lower(btrim(${alias}.city))` : kind === "category" ? `${alias}.category_id::text` : "'*'"})`;
}
