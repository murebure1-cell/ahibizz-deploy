import type { Pool, PoolClient } from "pg";
import type {
  BankTopUpApprove,
  BankTopUpCancel,
  BankTopUpCreate,
  BankTopUpData,
  BankTopUpRequest,
  BankTopUpStatus,
  CreditBankReceiver,
} from "../../lib/bank-credit-topup";
import { bamToEuroMinor } from "../../lib/billing";
import { ahiCreditTopUps } from "../../lib/wallet";
import { AccountAccessError, accountTransaction, createAccountAccess } from "../auth/accounts";
import { type AuthService, getAuthDatabasePool, getAuthService } from "../auth/service";
import { pendingQuoteOrder } from "../marketing/online-quote";
import { settleMarketingPayment } from "../marketing/settlement";
import { type CreditBankConfiguration, readCreditBankConfiguration } from "./bank-config";
import { createCreditTopUp } from "./topup";

const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
const integer = (v: unknown, max: number): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 1 && v <= max;
function fail(status: number, code: string): never {
  throw new AccountAccessError(status, code);
}
function record(input: unknown, keys: string[]) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail(400, "INVALID_BANK_TOPUP");
  const row = input as Record<string, unknown>;
  if (Object.keys(row).some((key) => !keys.includes(key))) fail(400, "INVALID_BANK_TOPUP");
  return row;
}
export function parseBankTopUpCreate(input: unknown): BankTopUpCreate {
  const row = record(input, ["id", "quantity", "expectedAmountMinor", "currency"]);
  if (
    !uuid(row.id) ||
    !integer(row.quantity, 100000) ||
    !integer(row.expectedAmountMinor, 100000000) ||
    (row.currency !== "BAM" && row.currency !== "EUR")
  )
    fail(400, "INVALID_BANK_TOPUP");
  return {
    id: row.id,
    quantity: row.quantity,
    expectedAmountMinor: row.expectedAmountMinor,
    currency: row.currency,
  };
}
export function parseBankTopUpCancel(input: unknown): BankTopUpCancel {
  const row = record(input, ["expectedVersion"]);
  if (!integer(row.expectedVersion, 2)) fail(400, "INVALID_BANK_TOPUP");
  return { expectedVersion: row.expectedVersion };
}
export function parseBankTopUpApprove(input: unknown): BankTopUpApprove {
  const row = record(input, [
    "expectedVersion",
    "bankTransactionReference",
    "amountMinor",
    "currency",
    "paymentReference",
  ]);
  if (
    !integer(row.expectedVersion, 2) ||
    !integer(row.amountMinor, 100000000) ||
    (row.currency !== "BAM" && row.currency !== "EUR") ||
    typeof row.paymentReference !== "string" ||
    !/^AHI-[A-F0-9]{32}$/.test(row.paymentReference) ||
    typeof row.bankTransactionReference !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9 ./_:()-]{2,119}$/.test(row.bankTransactionReference.trim())
  )
    fail(400, "INVALID_BANK_TOPUP");
  return {
    expectedVersion: row.expectedVersion,
    amountMinor: row.amountMinor,
    currency: row.currency,
    paymentReference: row.paymentReference,
    bankTransactionReference: row.bankTransactionReference.trim().toUpperCase(),
  };
}

type Row = {
  id: string;
  order_id: string;
  account_id: string;
  quantity: number;
  amount_minor: number;
  original_bam_minor: number;
  currency: "BAM" | "EUR";
  payment_reference: string;
  receiver: CreditBankReceiver;
  config_fingerprint: string;
  created_at: string;
  approved_at: string | null;
  status: "requested" | "quoted" | "paid" | "closed";
  bank_reference: string | null;
  name: string;
  email: string;
};
const projection = `SELECT bank.*,bank.created_at::text,bank.approved_at::text,sale.status,sale.bank_reference,u.name,u.email
  FROM ahi_wallet_bank_topup bank JOIN marketing_order sale ON sale.id=bank.order_id
  JOIN auth_user u ON u.id=bank.account_id`;
function dto(row: Row, config: CreditBankConfiguration | null, admin: boolean): BankTopUpRequest {
  const status =
    row.status === "paid" ? "approved" : row.status === "closed" ? "cancelled" : "pending";
  return {
    id: row.id,
    orderId: row.order_id,
    quantity: row.quantity,
    amountMinor: row.amount_minor,
    originalBamMinor: row.original_bam_minor,
    currency: row.currency,
    paymentReference: row.payment_reference,
    status,
    version: status === "pending" ? 1 : 2,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
    bank: row.receiver,
    instructionsAvailable: status === "pending" && config?.fingerprint === row.config_fingerprint,
    ...(admin ? { accountId: row.account_id, customer: row.name, email: row.email } : {}),
  };
}
async function find(client: PoolClient, id: string) {
  return (await client.query<Row>(`${projection} WHERE bank.id=$1`, [id])).rows[0];
}
async function noOnlinePayment(client: PoolClient, orderId: string) {
  if (
    (await pendingQuoteOrder(client, orderId, "live")) ||
    (await pendingQuoteOrder(client, orderId, "sandbox"))
  )
    fail(409, "QUOTE_PAYMENT_PENDING");
}
/** Customer first, then quote: matches checkout authority and avoids quote/account lock inversion. */
async function lockTarget(
  client: PoolClient,
  row: Row,
  actor: { id: string; role: string },
  requireActive: boolean,
) {
  if (row.account_id !== actor.id && actor.role !== "owner") fail(404, "BANK_TOPUP_NOT_FOUND");
  const customer = (
    await client.query<{ active: boolean }>(
      `SELECT (approval='approved' AND "emailVerified" AND role IN ('member','owner') AND erased_at IS NULL) AS active FROM auth_user WHERE id=$1 FOR UPDATE`,
      [row.account_id],
    )
  ).rows[0];
  if (!customer || (requireActive && !customer.active)) fail(409, "ACCOUNT_CHANGED");
  await client.query("SELECT id FROM marketing_order WHERE id=$1 FOR UPDATE", [row.order_id]);
  const current = await find(client, row.id);
  if (!current) fail(404, "BANK_TOPUP_NOT_FOUND");
  return current;
}

export function createBankTopUpService(
  auth: AuthService,
  pool: Pool,
  configuration: () => CreditBankConfiguration | null = readCreditBankConfiguration,
) {
  const access = createAccountAccess(auth);
  return {
    async read(
      headers: Headers,
      scope: "mine" | "admin",
      page: number,
      status?: BankTopUpStatus,
    ): Promise<BankTopUpData> {
      if (
        !["mine", "admin"].includes(scope) ||
        !integer(page, 1000) ||
        (status !== undefined &&
          (scope !== "admin" || !["pending", "approved", "cancelled"].includes(status)))
      )
        fail(400, "INVALID_BANK_TOPUP");
      const session = await access.session(headers);
      return accountTransaction(pool, async (client) => {
        const actor = await access.authority(client, session, scope === "admin", "read");
        const config = configuration();
        const rows = (
          await client.query<Row>(
            `${projection}
          WHERE ($1::boolean OR bank.account_id=$2)
          AND ($3::text IS NULL OR CASE sale.status WHEN 'paid' THEN 'approved' WHEN 'closed' THEN 'cancelled' ELSE 'pending' END=$3)
          ORDER BY CASE WHEN sale.status IN ('requested','quoted') THEN 0 ELSE 1 END,bank.created_at DESC,bank.id
          LIMIT 21 OFFSET $4`,
            [scope === "admin", actor.id, status ?? null, (page - 1) * 20],
          )
        ).rows;
        return {
          requests: rows.slice(0, 20).map((row) => dto(row, config, scope === "admin")),
          page,
          limit: 20,
          hasMore: rows.length > 20,
          available: config !== null,
          bank: config?.bank ?? null,
          offers: config
            ? ahiCreditTopUps.map((offer) => ({
                ...offer,
                originalBamMinor: offer.amountMinor,
                amountMinor:
                  config.bank.currency === "EUR"
                    ? bamToEuroMinor(offer.amountMinor)
                    : offer.amountMinor,
              }))
            : [],
        };
      });
    },
    async create(headers: Headers, input: unknown) {
      const command = parseBankTopUpCreate(input),
        session = await access.session(headers);
      return accountTransaction(pool, async (client) => {
        const actor = await access.authority(client, session),
          config = configuration();
        const prior = await find(client, command.id);
        if (prior) {
          if (
            prior.account_id !== actor.id ||
            prior.quantity !== command.quantity ||
            prior.amount_minor !== command.expectedAmountMinor ||
            prior.currency !== command.currency
          )
            fail(409, "BANK_TOPUP_CHANGED");
          return { request: dto(prior, config, false) };
        }
        if (!config || command.currency !== config.bank.currency)
          fail(503, "BANK_TOPUP_UNAVAILABLE");
        const offer = ahiCreditTopUps.find((item) => item.quantity === command.quantity);
        if (!offer) fail(400, "INVALID_CREDIT_BUNDLE");
        const price =
          command.currency === "EUR" ? bamToEuroMinor(offer.amountMinor) : offer.amountMinor;
        if (price !== command.expectedAmountMinor) fail(409, "AMOUNT_MISMATCH");
        const order = await createCreditTopUp(client, actor.id, {
          action: "topUp",
          id: command.id,
          quantity: command.quantity,
          expectedAmountMinor: offer.amountMinor,
        });
        await client.query("SELECT id FROM marketing_order WHERE id=$1 FOR UPDATE", [order.id]);
        if (
          (await client.query("SELECT 1 FROM ahi_wallet_bank_topup WHERE order_id=$1", [order.id]))
            .rowCount
        )
          fail(409, "BANK_TOPUP_PENDING");
        await noOnlinePayment(client, order.id);
        const reference = `AHI-${command.id.replaceAll("-", "").toUpperCase()}`;
        await client.query(
          `INSERT INTO ahi_wallet_bank_topup(id,order_id,account_id,quantity,amount_minor,original_bam_minor,currency,payment_reference,receiver,config_fingerprint)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
          [
            command.id,
            order.id,
            actor.id,
            command.quantity,
            price,
            offer.amountMinor,
            command.currency,
            reference,
            JSON.stringify(config.bank),
            config.fingerprint,
          ],
        );
        const saved = await find(client, command.id);
        if (!saved) fail(503, "BANK_TOPUP_UNAVAILABLE");
        return { request: dto(saved, config, false) };
      });
    },
    async approve(headers: Headers, id: string, input: unknown) {
      if (!uuid(id)) fail(400, "INVALID_BANK_TOPUP");
      const command = parseBankTopUpApprove(input),
        session = await access.session(headers);
      return accountTransaction(pool, async (client) => {
        const actor = await access.authority(client, session, true);
        const initial = await find(client, id);
        if (!initial) fail(404, "BANK_TOPUP_NOT_FOUND");
        const row = await lockTarget(client, initial, actor, true);
        if (
          command.amountMinor !== row.amount_minor ||
          command.currency !== row.currency ||
          command.paymentReference !== row.payment_reference
        )
          fail(409, "AMOUNT_MISMATCH");
        if (row.status === "paid" && row.bank_reference === command.bankTransactionReference)
          return { request: dto(row, configuration(), true) };
        // Closed instructions may still receive a late bank transfer. Only an
        // administrator with the exact statement proof can reconcile that receipt.
        if (
          command.expectedVersion !== (row.status === "closed" ? 2 : 1) ||
          !["requested", "quoted", "closed"].includes(row.status)
        )
          fail(409, "BANK_TOPUP_CHANGED");
        await noOnlinePayment(client, row.order_id);
        try {
          await client.query(
            "UPDATE ahi_wallet_bank_topup SET approved_by=$2,approved_at=clock_timestamp() WHERE id=$1",
            [id, actor.id],
          );
          await settleMarketingPayment(client, {
            id: row.order_id,
            actorId: actor.id,
            reference: command.bankTransactionReference,
            includedUntil: null,
            walletPaymentId: null,
          });
        } catch (error) {
          if ((error as { code?: string }).code === "23505") fail(409, "BANK_REFERENCE_USED");
          throw error;
        }
        const saved = await find(client, id);
        if (!saved) fail(503, "BANK_TOPUP_UNAVAILABLE");
        return { request: dto(saved, configuration(), true) };
      });
    },
    async cancel(headers: Headers, id: string, input: unknown) {
      if (!uuid(id)) fail(400, "INVALID_BANK_TOPUP");
      const command = parseBankTopUpCancel(input),
        session = await access.session(headers);
      return accountTransaction(pool, async (client) => {
        const actor = await access.authority(client, session);
        const initial = await find(client, id);
        if (!initial) fail(404, "BANK_TOPUP_NOT_FOUND");
        const row = await lockTarget(client, initial, actor, false);
        if (row.status === "closed")
          return { request: dto(row, configuration(), actor.role === "owner") };
        if (command.expectedVersion !== 1 || row.status === "paid") fail(409, "BANK_TOPUP_CHANGED");
        await noOnlinePayment(client, row.order_id);
        await client.query(
          "UPDATE marketing_order SET status='closed' WHERE id=$1 AND status IN ('requested','quoted')",
          [row.order_id],
        );
        const saved = await find(client, id);
        if (!saved) fail(503, "BANK_TOPUP_UNAVAILABLE");
        return { request: dto(saved, configuration(), actor.role === "owner") };
      });
    },
  };
}
export type BankTopUpService = ReturnType<typeof createBankTopUpService>;
export function getBankTopUpService() {
  const auth = getAuthService(),
    pool = getAuthDatabasePool();
  return auth && pool ? createBankTopUpService(auth, pool) : null;
}
