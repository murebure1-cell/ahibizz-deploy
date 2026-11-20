import type { PoolClient } from "pg";
import type { MarketingCommand } from "../../lib/marketing";
import { ahiCreditTopUps } from "../../lib/wallet";
import { AccountAccessError } from "../auth/accounts";
import { readWalletRate } from "./service";

const rateLock = "hashtextextended('ahi-credit-price',0)";

export async function lockWalletRate(client: PoolClient) {
  await client.query(`SELECT pg_advisory_xact_lock_shared(${rateLock})`);
  return readWalletRate(client);
}

export async function setCreditRate(
  client: PoolClient,
  actorId: string,
  command: Extract<MarketingCommand, { action: "setCreditRate" }>,
) {
  await client.query(`SELECT pg_advisory_xact_lock(${rateLock})`);
  const saved = await client.query("SELECT * FROM ahi_credit_rate WHERE request_id=$1", [
    command.id,
  ]);
  if (saved.rowCount) {
    const row = saved.rows[0];
    if (
      row.changed_by !== actorId ||
      row.unit_bam_minor !== command.unitBamMinor ||
      row.previous_unit_bam_minor !== command.expectedUnitBamMinor
    )
      throw new AccountAccessError(409, "CREDIT_RATE_CHANGED");
    return { id: command.id };
  }
  const current = await readWalletRate(client);
  if (current !== command.expectedUnitBamMinor)
    throw new AccountAccessError(409, "CREDIT_RATE_CHANGED");
  await client.query(
    "INSERT INTO ahi_credit_rate(request_id,unit_bam_minor,previous_unit_bam_minor,changed_by) VALUES($1,$2,$3,$4)",
    [command.id, command.unitBamMinor, current, actorId],
  );
  // Existing accepted credit prices are immutable. Enable an exact price on quotes which had none.
  await client.query(
    `UPDATE marketing_order SET wallet_price_minor=amount_minor::bigint*100/$1::bigint
    WHERE kind IN ('banner','featured','nearby') AND status='quoted' AND wallet_price_minor IS NULL AND
    amount_minor::bigint*100 % $1::bigint=0`,
    [command.unitBamMinor],
  );
  return { id: command.id };
}

export async function createCreditTopUp(
  client: PoolClient,
  accountId: string,
  command: Extract<MarketingCommand, { action: "topUp" }>,
) {
  const previous = await client.query("SELECT * FROM ahi_wallet_topup_request WHERE id=$1", [
    command.id,
  ]);
  if (previous.rowCount) {
    const row = previous.rows[0];
    if (
      row.account_id !== accountId ||
      row.quantity !== command.quantity ||
      row.amount_minor !== command.expectedAmountMinor
    )
      throw new AccountAccessError(409, "OFFER_CHANGED");
    return { id: String(row.order_id) };
  }
  const bundle = ahiCreditTopUps.find((option) => option.quantity === command.quantity);
  if (!bundle) throw new AccountAccessError(400, "INVALID_CREDIT_BUNDLE");
  const price = bundle.amountMinor;
  if (price !== command.expectedAmountMinor)
    throw new AccountAccessError(409, "CREDIT_BUNDLE_CHANGED");
  const existing = await client.query(
    `SELECT id,quantity,amount_minor,status FROM marketing_order WHERE account_id=$1
    AND kind='credits' AND status IN ('requested','quoted') FOR UPDATE`,
    [accountId],
  );
  const order = existing.rows[0];
  if (
    order &&
    (order.quantity !== command.quantity ||
      (order.status === "quoted" && order.amount_minor !== price))
  )
    throw new AccountAccessError(409, "OPEN_OFFER");
  const orderId = String(order?.id ?? command.id);
  if (!order) {
    const inserted = await client.query(
      `INSERT INTO marketing_order(id,account_id,kind,quantity)
      VALUES($1,$2,'credits',$3) ON CONFLICT DO NOTHING RETURNING id`,
      [orderId, accountId, command.quantity],
    );
    if (!inserted.rowCount) throw new AccountAccessError(409, "OFFER_CHANGED");
  }
  if (order?.status !== "quoted") {
    await client.query(
      `UPDATE marketing_order SET status='quoted',amount_minor=$2,instructions='Dopuna Ahi kredita',
      quoted_at=clock_timestamp(),catalogue_topup=true
      WHERE id=$1 AND status='requested'`,
      [orderId, price],
    );
  }
  const saved = await client.query(
    `INSERT INTO ahi_wallet_topup_request(id,order_id,account_id,quantity,amount_minor)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id`,
    [command.id, orderId, accountId, command.quantity, price],
  );
  if (!saved.rowCount) throw new AccountAccessError(409, "OFFER_CHANGED");
  return { id: orderId };
}
