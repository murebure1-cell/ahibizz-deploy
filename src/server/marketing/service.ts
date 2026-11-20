import type { Pool, PoolClient } from "pg";
import type {
  MarketingCommand,
  MarketingData,
  MarketingMode,
  MarketingOrder,
} from "../../lib/marketing";
import { isPlacement, isProductionService } from "../../lib/marketing";
import { AccountAccessError, accountTransaction, createAccountAccess } from "../auth/accounts";
import { type AuthService, getAuthDatabasePool, getAuthService } from "../auth/service";
import { syncProductionReceipt } from "../billing/service";
import { checkoutConfiguration } from "../paypal/runtime";
import { holdsQuotePayment, payableQuote, pendingQuoteOrder } from "./online-quote";
import { creditBalanceSql, packagePromotions, paidPromotions } from "./read";

function fail(status: number, code: string): never {
  throw new AccountAccessError(status, code);
}
const uuid = (s: unknown): s is string =>
  typeof s === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(s);
const amount = (n: unknown, max: number): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 1 && n <= max;
const validText = (v: unknown, max: number): v is string =>
  typeof v === "string" &&
  v.trim().length > 0 &&
  v.length <= max &&
  !/\p{Cc}/u.test(v.replace(/[\t\r\n]/g, ""));

export function parseMarketingCommand(v: unknown): MarketingCommand {
  if (!v || typeof v !== "object" || Array.isArray(v)) fail(400, "INVALID_OFFER");
  const row = v as Record<string, unknown>;
  if (!uuid(row.id)) fail(400, "INVALID_OFFER");
  const { action, id } = row;
  const keys = (allowed: string[]) => {
    if (Object.keys(row).some((key) => !allowed.includes(key))) fail(400, "INVALID_OFFER");
  };
  if (action === "request") {
    keys(["action", "id", "kind", "quantity", "businessId"]);
    if (row.kind === "credits" && amount(row.quantity, 100000) && row.businessId === undefined)
      return { action, id, kind: row.kind, quantity: row.quantity };
    if (isPlacement(row.kind) && amount(row.quantity, 90) && uuid(row.businessId))
      return { action, id, kind: row.kind, quantity: row.quantity, businessId: row.businessId };
    if (isProductionService(row.kind) && row.quantity === 1 && uuid(row.businessId))
      return { action, id, kind: row.kind, quantity: 1, businessId: row.businessId };
  } else if (action === "quote") {
    keys(["action", "id", "amountMinor", "instructions", "creditPrice"]);
    if (
      amount(row.amountMinor, 100000000) &&
      validText(row.instructions, 600) &&
      (row.creditPrice === undefined || amount(row.creditPrice, 100000))
    )
      return {
        action,
        id,
        amountMinor: row.amountMinor,
        instructions: row.instructions.trim(),
        creditPrice: row.creditPrice,
      };
  } else if (action === "confirm") {
    keys(["action", "id", "amountMinor", "reference"]);
    if (
      amount(row.amountMinor, 100000000) &&
      typeof row.reference === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9 ./_:()-]{2,119}$/.test(row.reference.trim())
    )
      return {
        action,
        id,
        amountMinor: row.amountMinor,
        reference: row.reference.trim().toUpperCase(),
      };
  } else if (action === "close" || action === "useCredits") {
    keys(["action", "id"]);
    return { action, id };
  }
  return fail(400, "INVALID_OFFER");
}
type LockedOrder = {
  account_id: string;
  business_id: string | null;
  kind: MarketingOrder["kind"];
  status: MarketingOrder["status"];
  quantity: number;
  amount_minor: number | null;
  credit_price: number | null;
  bank_reference: string | null;
};
async function validBusiness(
  client: PoolClient,
  id: string,
  user: string,
  kind: MarketingOrder["kind"],
) {
  const found = await client.query(
    "SELECT id,latitude,longitude,CASE WHEN $3::text IN ('featured','nearby') THEN paid_package_placement_until(b,$3)::text END AS included_until FROM directory_business b WHERE id=$1 AND owner_user_id=$2 AND CASE WHEN $3::text IN ('photo','video','photo_video') THEN status<>'archived' ELSE status='published' AND package_allows_listing(b) END FOR UPDATE",
    [id, user, kind],
  );
  if (!found.rowCount) fail(409, "BUSINESS_CHANGED");
  if (kind === "nearby" && (found.rows[0].latitude === null || found.rows[0].longitude === null))
    fail(409, "LOCATION_REQUIRED");
  return found.rows[0].included_until as string | null;
}
async function wallet(client: PoolClient, user: string) {
  const value = Number(
    (await client.query(`SELECT ${creditBalanceSql("$1")} AS balance`, [user])).rows[0]?.balance,
  );
  if (!Number.isSafeInteger(value) || value < 0) fail(503, "MARKETING_UNAVAILABLE");
  return value;
}
export function createMarketingService(auth: AuthService, pool: Pool) {
  const access = createAccountAccess(auth);
  return {
    async offer(headers: Headers, id: string) {
      if (!uuid(id)) fail(400, "INVALID_OFFER");
      const scope = await access.session(headers);
      return accountTransaction(pool, async (client) => {
        const actor = await access.authority(client, scope, false, "read");
        const quote = await payableQuote(client, actor.id, id);
        const environment = checkoutConfiguration()?.environment;
        const saved = environment
          ? await pendingQuoteOrder(client, id, environment, actor.id)
          : null;
        if (saved)
          return {
            offer: {
              id,
              kind: saved.kind,
              title: saved.business_title,
              amountMinor: saved.amount_minor,
              originalBamMinor: saved.original_bam_minor,
            },
            orderId: saved.id,
          };
        if (!quote) fail(404, "OFFER_NOT_FOUND");
        return { offer: quote };
      });
    },
    async read(headers: Headers, mode: MarketingMode, page: number): Promise<MarketingData> {
      if (
        !["admin", "ads", "credits"].includes(mode) ||
        !Number.isSafeInteger(page) ||
        page < 0 ||
        page > 999
      )
        fail(400, "INVALID_OFFER");
      const session = await access.session(headers);
      return accountTransaction(pool, async (client) => {
        const actor = await access.authority(client, session, mode === "admin", "read");
        const orders = (
          await client.query<MarketingOrder>(
            `
          SELECT o.id,o.kind,o.status,o.quantity,o.amount_minor AS "amountMinor",o.credit_price AS "creditPrice",
            o.revoked_at::text AS "revokedAt",(o.status='quoted' AND EXISTS (SELECT 1 FROM paypal_checkout_order p WHERE p.quote_id=o.id AND p.environment='live'
              AND ${holdsQuotePayment})) AS "onlinePending",
            o.instructions,b.title AS "businessTitle",u.name AS customer,o.starts_at::text AS "startsAt",
            CASE WHEN o.ends_at IS NOT NULL THEN LEAST(o.ends_at,o.revoked_at)::text END AS "endsAt",o.production_receipt_conflict AS "productionReceiptConflict"
          FROM marketing_order o JOIN auth_user u ON u.id=o.account_id LEFT JOIN directory_business b ON b.id=o.business_id
          WHERE ($2::text='admin' OR (o.account_id=$1 AND (o.kind='credits')=($2='credits')))
          ORDER BY CASE o.status WHEN 'requested' THEN 0 WHEN 'quoted' THEN 1 WHEN 'paid' THEN 2 ELSE 3 END,o.created_at DESC,o.id LIMIT 21 OFFSET $3`,
            [actor.id, mode, page * 20],
          )
        ).rows;
        const businesses =
          mode === "ads"
            ? (
                await client.query<{ id: string; title: string; adEligible: boolean }>(
                  "SELECT id,title,(status='published' AND package_allows_listing(b)) AS \"adEligible\" FROM directory_business b WHERE owner_user_id=$1 AND status<>'archived' ORDER BY title,id",
                  [actor.id],
                )
              ).rows
            : [];
        const config = checkoutConfiguration();
        return {
          orders: orders.slice(0, 20),
          more: orders.length > 20,
          balance: await wallet(client, actor.id),
          businesses: businesses
            .filter((b) => b.adEligible)
            .map(({ id, title }) => ({ id, title })),
          productionBusinesses: businesses.map(({ id, title }) => ({ id, title })),
          promotions: mode === "ads" ? await paidPromotions(client, actor.id) : [],
          included: mode === "ads" ? await packagePromotions(client, actor.id) : [],
          checkoutAvailable: config?.chargingApproved === true && config.environment === "live",
        };
      });
    },
    async command(headers: Headers, input: unknown) {
      const command = parseMarketingCommand(input);
      const current = await access.session(headers);
      return accountTransaction(pool, async (client) => {
        const actor = await access.authority(
          client,
          current,
          command.action === "quote" || command.action === "confirm",
        );
        if (command.action === "request") {
          const prior = (
            await client.query<LockedOrder>(
              "SELECT * FROM marketing_order WHERE id=$1 FOR UPDATE",
              [command.id],
            )
          ).rows[0];
          if (prior) {
            if (
              prior.account_id !== actor.id ||
              prior.kind !== command.kind ||
              prior.quantity !== command.quantity ||
              prior.business_id !== (command.businessId ?? null)
            )
              fail(409, "OFFER_CHANGED");
            return { id: command.id };
          }
          if (
            command.businessId &&
            (await validBusiness(client, command.businessId, actor.id, command.kind))
          )
            fail(409, "INCLUDED_IN_PACKAGE");
          if (
            command.businessId &&
            (
              await client.query(
                "SELECT id FROM marketing_order WHERE business_id=$1 AND kind=$2 AND status='paid' AND revoked_at IS NULL AND ends_at>now()",
                [command.businessId, command.kind],
              )
            ).rowCount
          )
            fail(409, "ACTIVE_BANNER");
          const result = await client.query(
            `INSERT INTO marketing_order(id,account_id,kind,business_id,quantity) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id`,
            [command.id, actor.id, command.kind, command.businessId ?? null, command.quantity],
          );
          if (!result.rowCount) fail(409, "OPEN_OFFER");
          return { id: command.id };
        }
        // Lock matching listing before the order, as the ownership trigger also locks in this order.
        const target = (
          await client.query<LockedOrder>(
            "SELECT business_id,account_id,kind FROM marketing_order WHERE id=$1",
            [command.id],
          )
        ).rows[0];
        if (!target || (actor.role !== "owner" && target.account_id !== actor.id))
          fail(404, "OFFER_NOT_FOUND");
        const includedUntil =
          target.business_id && command.action !== "close"
            ? await validBusiness(client, target.business_id, target.account_id, target.kind)
            : null;
        const order = (
          await client.query<LockedOrder>("SELECT * FROM marketing_order WHERE id=$1 FOR UPDATE", [
            command.id,
          ])
        ).rows[0];
        if (!order) fail(404, "OFFER_NOT_FOUND");
        if (
          order.status === "quoted" &&
          command.action !== "quote" &&
          (await pendingQuoteOrder(client, command.id, "live"))
        )
          fail(409, "QUOTE_PAYMENT_PENDING");
        if (command.action === "quote") {
          if (includedUntil) fail(409, "INCLUDED_IN_PACKAGE");
          if (order.status !== "requested" || (command.creditPrice && !isPlacement(order.kind)))
            fail(409, "OFFER_CHANGED");
          await client.query(
            "UPDATE marketing_order SET status='quoted',amount_minor=$2,instructions=$3,credit_price=$4,quoted_at=now(),quoted_by=$5 WHERE id=$1",
            [
              command.id,
              command.amountMinor,
              command.instructions,
              command.creditPrice ?? null,
              actor.id,
            ],
          );
        } else if (command.action === "close") {
          if (order.status === "paid") fail(409, "OFFER_CHANGED");
          await client.query(
            "UPDATE marketing_order SET status='closed' WHERE id=$1 AND status IN ('quoted','requested')",
            [command.id],
          );
        } else {
          const customer = await client.query(
            `SELECT id FROM auth_user WHERE id=$1 AND approval='approved' AND "emailVerified" AND role IN ('owner','member') FOR UPDATE`,
            [order.account_id],
          );
          if (!customer.rowCount) fail(409, "ACCOUNT_CHANGED");
          if (
            command.action === "useCredits" &&
            (actor.id !== order.account_id ||
              !isPlacement(order.kind) ||
              order.credit_price === null)
          )
            fail(403, "OFFER_FORBIDDEN");
          const reference = command.action === "confirm" ? command.reference : null;
          if (command.action === "confirm" && command.amountMinor !== order.amount_minor)
            fail(409, "AMOUNT_MISMATCH");
          if (order.status === "paid" && order.bank_reference === reference)
            return { id: command.id };
          if (order.status !== "quoted") fail(409, "OFFER_CHANGED");
          if (reference === null && (await wallet(client, actor.id)) < (order.credit_price ?? 0))
            fail(409, "INSUFFICIENT_CREDITS");
          if (isPlacement(order.kind)) {
            const active = await client.query(
              "SELECT id FROM marketing_order WHERE business_id=$1 AND kind=$2 AND status='paid' AND revoked_at IS NULL AND ends_at>clock_timestamp()",
              [order.business_id, order.kind],
            );
            if (active.rowCount) fail(409, "ACTIVE_BANNER");
          }
          try {
            await client.query(
              `UPDATE marketing_order SET status='paid',settled_by=$2,bank_reference=$3,paid_at=now(),
              starts_at=CASE WHEN kind IN ('banner','featured','nearby') THEN GREATEST(now(),$4::timestamptz) END,
              ends_at=CASE WHEN kind IN ('banner','featured','nearby') THEN GREATEST(now(),$4::timestamptz)+quantity*interval '1 day' END WHERE id=$1`,
              [command.id, actor.id, reference, includedUntil],
            );
            if (isProductionService(order.kind)) await syncProductionReceipt(client, command.id);
          } catch (error) {
            if ((error as { code?: string }).code === "23505") fail(409, "REFERENCE_USED");
            throw error;
          }
        }
        return { id: command.id };
      });
    },
  };
}
export function getMarketingService() {
  const auth = getAuthService(),
    pool = getAuthDatabasePool();
  return auth && pool ? createMarketingService(auth, pool) : null;
}
