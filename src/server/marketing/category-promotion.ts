import type { PoolClient } from "pg";
import { promotionTrialOffer } from "../../lib/checkout-preview";
import { creditsForBamMinor } from "../../lib/wallet";
import { AccountAccessError } from "../auth/accounts";
import { debitWallet } from "../wallet/service";
import { lockWalletRate } from "../wallet/topup";

export async function hasActiveWalletPromotion(client: PoolClient, businessId: string) {
  const result = await client.query(
    "SELECT 1 FROM wallet_category_promotion WHERE business_id=$1 AND revoked_at IS NULL AND ends_at>clock_timestamp() LIMIT 1",
    [businessId],
  );
  return Boolean(result.rowCount);
}

export async function buyCategoryPromotion(
  client: PoolClient,
  accountId: string,
  offer: { id: string; businessId: string; expectedCreditMinor: number },
) {
  const previous = (
    await client.query<{
      account_id: string;
      business_id: string;
      credit_minor: number;
      ends_at: string;
    }>(
      "SELECT account_id,business_id,credit_minor,ends_at::text FROM wallet_category_promotion WHERE id=$1",
      [offer.id],
    )
  ).rows[0];
  if (previous) {
    if (
      previous.account_id !== accountId ||
      previous.business_id !== offer.businessId ||
      previous.credit_minor !== offer.expectedCreditMinor
    )
      throw new AccountAccessError(409, "WALLET_PAYMENT_CHANGED");
    return { id: offer.id, endsAt: previous.ends_at };
  }
  // PayPal checkout uses the same account and business row locks before reserving this slot.
  const business = (
    await client.query<{ category_id: string }>(
      "SELECT category_id FROM directory_business b WHERE b.id=$1 AND b.owner_user_id=$2 AND b.status='published' AND b.deleted_at IS NULL AND package_allows_listing(b) FOR UPDATE",
      [offer.businessId, accountId],
    )
  ).rows[0];
  if (!business) throw new AccountAccessError(403, "BUSINESS_NOT_ELIGIBLE");
  const reserved = await client.query(
    `SELECT 1 FROM paypal_checkout_order WHERE kind='promotion' AND business_id=$1 AND environment='live'
       AND (status='review' OR capture_lease_until>clock_timestamp()
         OR (status IN ('created','provider_created') AND expires_at>clock_timestamp())
         OR (status='captured' AND ends_at>clock_timestamp())) LIMIT 1`,
    [offer.businessId],
  );
  if (reserved.rowCount || (await hasActiveWalletPromotion(client, offer.businessId)))
    throw new AccountAccessError(409, "PROMOTION_ALREADY_RESERVED");
  const rate = await lockWalletRate(client);
  const cost = rate && creditsForBamMinor(promotionTrialOffer.amountMinor, rate);
  if (cost == null || cost < 1) throw new AccountAccessError(409, "WALLET_PRICE_UNAVAILABLE");
  if (cost !== offer.expectedCreditMinor)
    throw new AccountAccessError(409, "WALLET_PAYMENT_CHANGED");
  const debited = await debitWallet(client, {
    accountId,
    purchaseId: offer.id,
    kind: "promotion",
    creditMinor: cost,
  });
  if (!debited) throw new AccountAccessError(409, "WALLET_PAYMENT_CHANGED");
  const result = await client.query<{ ends_at: string }>(
    "INSERT INTO wallet_category_promotion(id,account_id,business_id,category_id,credit_minor) VALUES($1,$2,$3,$4,$5) RETURNING ends_at::text",
    [offer.id, accountId, offer.businessId, business.category_id, cost],
  );
  if (!result.rows[0]) throw new AccountAccessError(503, "MARKETING_UNAVAILABLE");
  return { id: offer.id, endsAt: result.rows[0].ends_at };
}
