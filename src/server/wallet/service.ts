import type { PoolClient } from "pg";
import type { CreditMovement } from "../../lib/marketing";
import { initialCreditUnitBamMinor, validCreditBalance } from "../../lib/wallet";
import { AccountAccessError } from "../auth/accounts";

export async function readWalletRate(client: Pick<PoolClient, "query">): Promise<number | null> {
  const row = await client.query<{ unit_bam_minor: number }>(
    "SELECT unit_bam_minor FROM ahi_credit_rate ORDER BY revision DESC LIMIT 1",
  );
  return row.rows[0]?.unit_bam_minor ?? initialCreditUnitBamMinor;
}

export async function walletBalance(client: PoolClient, accountId: string): Promise<number> {
  const row = await client.query("SELECT ahi_wallet_available_minor($1) AS minor", [accountId]);
  const value = Number(row.rows[0].minor) / 100;
  if (!validCreditBalance(value)) throw new AccountAccessError(503, "MARKETING_UNAVAILABLE");
  return value;
}

// Must run inside the same transaction that fulfills the purchased service.
export async function debitWallet(
  client: PoolClient,
  input: {
    accountId: string;
    purchaseId: string;
    kind: "marketing" | "package" | "promotion" | "reel";
    creditMinor: number;
  },
): Promise<boolean> {
  if (
    !Number.isSafeInteger(input.creditMinor) ||
    input.creditMinor < 1 ||
    input.creditMinor > 10000000000
  )
    throw new AccountAccessError(400, "INVALID_CREDIT_AMOUNT");
  await client.query("SELECT ahi_wallet_lock($1)", [input.accountId]);
  const prior = await client.query(
    "SELECT account_id,kind,credit_minor FROM ahi_wallet_debit WHERE purchase_id=$1",
    [input.purchaseId],
  );
  if (prior.rowCount) {
    const row = prior.rows[0];
    if (
      row.account_id !== input.accountId ||
      row.kind !== input.kind ||
      Number(row.credit_minor) !== input.creditMinor
    )
      throw new AccountAccessError(409, "WALLET_PAYMENT_CHANGED");
    return false;
  }
  const paid = await client.query(
    `INSERT INTO ahi_wallet_debit(purchase_id,account_id,kind,credit_minor)
     SELECT $1,$2,$3,$4 WHERE ahi_wallet_available_minor($2)>=$4::bigint
     ON CONFLICT (purchase_id) DO NOTHING RETURNING purchase_id`,
    [input.purchaseId, input.accountId, input.kind, input.creditMinor],
  );
  if (!paid.rowCount) {
    const conflict = await client.query("SELECT 1 FROM ahi_wallet_debit WHERE purchase_id=$1", [
      input.purchaseId,
    ]);
    throw new AccountAccessError(
      409,
      conflict.rowCount ? "WALLET_PAYMENT_CHANGED" : "INSUFFICIENT_CREDITS",
    );
  }
  return true;
}

const movementLabels: Record<string, string> = {
  booking: "Nagrada za održani termin",
  topup: "Dopuna kredita",
  reversal: "Korekcija dopune",
  banner: "Baner na početnoj",
  featured: "Isticanje na početnoj",
  nearby: "Isticanje na lokaciji",
  promotion: "Isticanje u kategoriji",
  package: "Plaćanje paketa",
  marketing: "Plaćanje ponude",
  reel: "Objava Reela",
};
export async function readCreditMovements(
  client: PoolClient,
  accountId: string,
): Promise<CreditMovement[]> {
  const rows = await client.query<{
    id: string;
    kind: string;
    amount_minor: string;
    created_at: string;
  }>(
    "SELECT id,kind,amount_minor,created_at::text FROM ahi_credit_movements WHERE account_id=$1 AND amount_minor<>0 ORDER BY created_at DESC,id LIMIT 20",
    [accountId],
  );
  return rows.rows.map((row) => ({
    id: row.id,
    label: movementLabels[row.kind] ?? "Plaćanje",
    amount: Number(row.amount_minor) / 100,
    createdAt: row.created_at,
  }));
}
