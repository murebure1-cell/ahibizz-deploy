import type { PoolClient } from "pg";
import { bamToEuroMinor } from "../../lib/billing";
import {
  adPlacements,
  isProductionService,
  type MarketingOrder,
  productionServices,
} from "../../lib/marketing";
import { syncProductionReceipt } from "../billing/service";

type QuoteRow = {
  id: string;
  kind: MarketingOrder["kind"];
  amount_minor: number;
  quantity: number;
  title: string | null;
  business_id: string | null;
};

export async function payableQuote(
  client: PoolClient,
  accountId: string,
  quoteId: string,
  lock = false,
) {
  const { rows } = await client.query<QuoteRow>(
    `SELECT o.id,o.kind,o.amount_minor,o.quantity,o.business_id,b.title
     FROM marketing_order o LEFT JOIN directory_business b ON b.id=o.business_id
     WHERE o.id=$1 AND o.account_id=$2 AND o.status='quoted'
       AND (o.kind='credits' OR (b.owner_user_id=o.account_id AND
         CASE WHEN o.kind IN ('photo','video','photo_video') THEN b.status<>'archived'
           ELSE b.status='published' AND package_allows_listing(b) AND
             (o.kind<>'nearby' OR (b.latitude IS NOT NULL AND b.longitude IS NOT NULL)) END))
       AND NOT EXISTS (SELECT 1 FROM marketing_order other WHERE other.business_id=o.business_id
         AND other.kind=o.kind AND other.status='paid' AND other.revoked_at IS NULL AND other.ends_at>now())
     ${lock ? "FOR UPDATE OF o" : ""}`,
    [quoteId, accountId],
  );
  const offer = rows[0];
  if (!offer) return null;
  const title =
    offer.kind === "credits"
      ? `${offer.quantity} Ahi Credits`
      : `${isProductionService(offer.kind) ? productionServices[offer.kind] : adPlacements[offer.kind]} · ${offer.title}`;
  return {
    id: offer.id,
    kind: offer.kind,
    title,
    businessId: offer.business_id,
    amountMinor: bamToEuroMinor(offer.amount_minor),
    originalBamMinor: offer.amount_minor,
  };
}

// Hold alternate settlement while PayPal can still capture, including a capture that started just before expiry.
export async function pendingQuoteOrder(client: PoolClient, quoteId: string, environment: string) {
  const result = await client.query<{ id: string; offer_version: string; status: string }>(
    `SELECT id,offer_version,status FROM paypal_checkout_order WHERE quote_id=$1 AND environment=$2
      AND (status IN ('captured','review','partially_refunded','refunded','reversed')
        OR (status IN ('created','provider_created') AND GREATEST(expires_at,capture_lease_until)>clock_timestamp()))
      ORDER BY created_at DESC LIMIT 1`,
    [quoteId, environment],
  );
  return result.rows[0] ?? null;
}

export async function settleOnlineQuote(
  client: PoolClient,
  userId: string,
  quoteId: string,
  checkoutId: string,
) {
  // The membership may have been activated between quotation and settlement. Queue the purchased days after it.
  const settled = await client.query<{ kind: MarketingOrder["kind"] }>(
    `WITH start_time AS (
       SELECT GREATEST(now(),CASE WHEN o.kind IN ('featured','nearby') THEN paid_package_placement_until(b,o.kind) END) AS starts
       FROM marketing_order o LEFT JOIN directory_business b ON b.id=o.business_id WHERE o.id=$1)
     UPDATE marketing_order o SET status='paid',settled_by=$2, online_checkout_id=$3,paid_at=now(),
       starts_at=CASE WHEN kind IN ('banner','featured','nearby') THEN start_time.starts END,
       ends_at=CASE WHEN kind IN ('banner','featured','nearby') THEN start_time.starts+quantity*interval '1 day' END
       FROM start_time WHERE o.id=$1 AND o.account_id=$2 AND o.status='quoted' RETURNING kind`,
    [quoteId, userId, checkoutId],
  );
  if (isProductionService(settled.rows[0]?.kind)) await syncProductionReceipt(client, quoteId);
}

/** A refund webhook may be the first verified evidence of a captured production sale. */
export async function reconcileProductionSale(
  client: PoolClient,
  quoteId: string,
  checkoutId: string,
) {
  await client.query(
    `UPDATE marketing_order o SET status='paid',settled_by=o.account_id,online_checkout_id=p.id,
         paid_at=p.captured_at,revoked_at=COALESCE(o.revoked_at,clock_timestamp())
     FROM paypal_checkout_order p WHERE o.id=$1 AND o.kind IN ('photo','video','photo_video')
       AND o.status='quoted' AND p.id=$2 AND p.quote_id=o.id AND p.user_id=o.account_id
       AND p.environment='live' AND p.capture_id IS NOT NULL AND p.captured_at IS NOT NULL
       AND p.original_bam_minor=o.amount_minor AND p.status IN ('review','partially_refunded','refunded','reversed')`,
    [quoteId, checkoutId],
  );
  await syncProductionReceipt(client, quoteId);
}
