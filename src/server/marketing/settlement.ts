import type { PoolClient } from "pg";
/** Shared existing marketing settlement. The enclosing transaction must authorize and lock the quote. */
export async function settleMarketingPayment(
  client: PoolClient,
  input: {
    id: string;
    actorId: string;
    reference: string | null;
    includedUntil: string | null;
    walletPaymentId: string | null;
  },
) {
  await client.query(
    `UPDATE marketing_order SET status='paid',settled_by=$2,bank_reference=$3,wallet_payment_id=$5,paid_at=now(),
     starts_at=CASE WHEN kind IN ('banner','featured','nearby') THEN GREATEST(now(),$4::timestamptz) END,
     ends_at=CASE WHEN kind IN ('banner','featured','nearby') THEN GREATEST(now(),$4::timestamptz)+quantity*interval '1 day' END WHERE id=$1`,
    [input.id, input.actorId, input.reference, input.includedUntil, input.walletPaymentId],
  );
}
