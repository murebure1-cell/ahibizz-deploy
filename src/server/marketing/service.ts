import type { Pool, PoolClient } from "pg";
import type { BusinessMediaAsset } from "../../lib/business-media";
import type {
  MarketingCommand,
  MarketingData,
  MarketingMode,
  MarketingOrder,
} from "../../lib/marketing";
import {
  isPlacement,
  isProductionService,
  type PromotionView,
  readPromotionView,
} from "../../lib/marketing";
import { creditsForBamMinor, validCreditBalance } from "../../lib/wallet";
import { AccountAccessError, accountTransaction, createAccountAccess } from "../auth/accounts";
import { type AuthService, getAuthDatabasePool, getAuthService } from "../auth/service";
import { syncProductionReceipt } from "../billing/service";
import { creditCardTopUpsAvailable, readCreditTopUpBankOnly } from "../paypal/credit-top-up-policy";
import { checkoutConfiguration } from "../paypal/runtime";
import { readPlatformCreditsOnly } from "../wallet/platform-policy";
import { debitWallet, readCreditMovements, readWalletRate, walletBalance } from "../wallet/service";
import { createCreditTopUp, lockWalletRate, setCreditRate } from "../wallet/topup";
import { readAdPricing } from "./ad-pricing";
import {
  briefFingerprint,
  campaignKey,
  campaignProjection,
  checkCampaignQuote,
  parseCampaignBrief,
  saveCampaignBrief,
} from "./campaigns";
import { buyCategoryPromotion } from "./category-promotion";
import { holdsQuotePayment, payableQuote, pendingQuoteOrder } from "./online-quote";
import { packagePromotions, paidPromotions } from "./read";
import { settleMarketingPayment } from "./settlement";

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
const paidWithCredits = `o.status='paid' AND (o.wallet_payment_id IS NOT NULL OR
  (o.bank_reference IS NULL AND o.online_checkout_id IS NULL AND o.credit_price IS NOT NULL))`;

export function parseMarketingCommand(v: unknown): MarketingCommand {
  if (!v || typeof v !== "object" || Array.isArray(v)) fail(400, "INVALID_OFFER");
  const row = v as Record<string, unknown>;
  if (!uuid(row.id)) fail(400, "INVALID_OFFER");
  const { action, id } = row;
  const keys = (allowed: string[]) => {
    if (Object.keys(row).some((key) => !allowed.includes(key))) fail(400, "INVALID_OFFER");
  };
  if (action === "topUp") {
    keys(["action", "id", "quantity", "expectedAmountMinor"]);
    if (amount(row.quantity, 100000) && amount(row.expectedAmountMinor, 100000000))
      return { action, id, quantity: row.quantity, expectedAmountMinor: row.expectedAmountMinor };
    return fail(400, "INVALID_OFFER");
  }
  if (action === "setCreditRate") {
    keys(["action", "id", "unitBamMinor", "expectedUnitBamMinor"]);
    if (!amount(row.unitBamMinor, 100) || 100 % row.unitBamMinor !== 0)
      fail(400, "INVALID_CREDIT_RATE");
    if (
      amount(row.unitBamMinor, 1000000) &&
      (row.expectedUnitBamMinor === null || amount(row.expectedUnitBamMinor, 1000000))
    )
      return {
        action,
        id,
        unitBamMinor: row.unitBamMinor,
        expectedUnitBamMinor: row.expectedUnitBamMinor,
      };
    return fail(400, "INVALID_OFFER");
  }
  if (action === "promoteCategory") {
    keys(["action", "id", "businessId", "expectedCreditMinor"]);
    if (!uuid(row.businessId) || !amount(row.expectedCreditMinor, 100000000))
      fail(400, "INVALID_OFFER");
    return { action, id, businessId: row.businessId, expectedCreditMinor: row.expectedCreditMinor };
  }
  if (action === "request") {
    keys(["action", "id", "kind", "quantity", "businessId", "campaign"]);
    if (row.campaign !== undefined) {
      if (row.kind !== "banner" || !amount(row.quantity, 90) || !uuid(row.businessId))
        fail(400, "INVALID_CAMPAIGN");
      return {
        action,
        id,
        kind: "banner",
        businessId: row.businessId,
        quantity: row.quantity,
        campaign: parseCampaignBrief(row.campaign),
      };
    }
    if (row.kind === "credits" && amount(row.quantity, 100000) && row.businessId === undefined)
      return { action, id, kind: row.kind, quantity: row.quantity };
    if (isPlacement(row.kind) && amount(row.quantity, 90) && uuid(row.businessId))
      return { action, id, kind: row.kind, quantity: row.quantity, businessId: row.businessId };
    if (isProductionService(row.kind) && row.quantity === 1 && uuid(row.businessId))
      return { action, id, kind: row.kind, quantity: 1, businessId: row.businessId };
  } else if (action === "quote") {
    keys([
      "action",
      "id",
      "amountMinor",
      "instructions",
      "creditPrice",
      "campaignBenefit",
      "offerStandardTargeting",
      "expectedAssetVersion",
    ]);
    if (
      (amount(row.amountMinor, 100000000) ||
        (row.amountMinor === undefined && row.creditPrice !== undefined)) &&
      (row.expectedAssetVersion === undefined ||
        row.expectedAssetVersion === 0 ||
        amount(row.expectedAssetVersion, 2147483647)) &&
      (row.offerStandardTargeting === undefined || row.offerStandardTargeting === true) &&
      (row.campaignBenefit === undefined ||
        row.campaignBenefit === "advance" ||
        row.campaignBenefit === "welcome") &&
      validText(row.instructions, 600) &&
      (row.creditPrice === undefined ||
        (validCreditBalance(row.creditPrice) && row.creditPrice > 0 && row.creditPrice <= 100000))
    )
      return {
        action,
        id,
        ...(typeof row.amountMinor === "number" ? { amountMinor: row.amountMinor } : {}),
        instructions: row.instructions.trim(),
        creditPrice: row.creditPrice,
        ...(row.expectedAssetVersion !== undefined
          ? { expectedAssetVersion: row.expectedAssetVersion }
          : {}),
        ...(row.offerStandardTargeting === true ? { offerStandardTargeting: true as const } : {}),
        ...(row.campaignBenefit ? { campaignBenefit: row.campaignBenefit } : {}),
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
  wallet_price_minor: string | null;
  wallet_payment_id: string | null;
  online_checkout_id: string | null;
  bank_reference: string | null;
  campaign_key: string | null;
  request_fingerprint?: string | null;
};
async function validBusiness(
  client: PoolClient,
  id: string,
  user: string,
  kind: MarketingOrder["kind"],
) {
  const found = await client.query(
    "SELECT id,latitude,longitude,CASE WHEN $3::text IN ('featured','nearby') THEN paid_package_placement_until(b,$3)::text END AS included_until FROM directory_business b WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL AND CASE WHEN $3::text IN ('photo','video','photo_video') THEN status<>'archived' ELSE status='published' AND package_allows_listing(b) END FOR UPDATE",
    [id, user, kind],
  );
  if (!found.rowCount) fail(409, "BUSINESS_CHANGED");
  if (kind === "nearby" && (found.rows[0].latitude === null || found.rows[0].longitude === null))
    fail(409, "LOCATION_REQUIRED");
  return found.rows[0].included_until as string | null;
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
        const environment = readPlatformCreditsOnly()
          ? "live"
          : checkoutConfiguration()?.environment;
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
    async read(
      headers: Headers,
      mode: MarketingMode,
      page: number,
      promotionView?: PromotionView,
    ): Promise<MarketingData> {
      if (
        !["admin", "ads", "credits"].includes(mode) ||
        !Number.isSafeInteger(page) ||
        page < 0 ||
        page > 999 ||
        (promotionView !== undefined && (mode !== "ads" || !readPromotionView(promotionView)))
      )
        fail(400, "INVALID_OFFER");
      const session = await access.session(headers);
      return accountTransaction(pool, async (client) => {
        const actor = await access.authority(client, session, mode === "admin", "read");
        const orders = (
          await client.query<MarketingOrder>(
            `
          SELECT o.id,o.kind,o.status,o.quantity,o.amount_minor AS "amountMinor",(o.wallet_price_minor::double precision/100) AS "creditPrice",
            (${paidWithCredits}) AS "paidWithCredits",bank.id IS NOT NULL AS "bankTopUp",
            CASE WHEN o.status='paid' THEN
              CASE WHEN paid_online.id IS NOT NULL THEN paid_online.currency
                   WHEN o.bank_reference IS NOT NULL THEN COALESCE(bank.currency,'BAM') END
            END AS "paidCurrency",
            CASE WHEN o.status='paid' THEN
              CASE WHEN paid_online.id IS NOT NULL THEN paid_online.amount_minor
                   WHEN o.bank_reference IS NOT NULL THEN COALESCE(bank.amount_minor,o.amount_minor) END
            END AS "paidAmountMinor",
            o.revoked_at::text AS "revokedAt",(o.status='quoted' AND EXISTS (SELECT 1 FROM paypal_checkout_order p WHERE p.quote_id=o.id AND p.environment='live'
              AND ${holdsQuotePayment})) AS "onlinePending",
            ${campaignProjection},o.instructions,b.title AS "businessTitle",u.name AS customer,o.starts_at::text AS "startsAt",
            CASE WHEN o.ends_at IS NOT NULL THEN LEAST(o.ends_at,o.revoked_at)::text END AS "endsAt",o.production_receipt_conflict AS "productionReceiptConflict"
          FROM marketing_order o JOIN auth_user u ON u.id=o.account_id LEFT JOIN directory_business b ON b.id=o.business_id
          LEFT JOIN ahi_wallet_bank_topup bank ON bank.order_id=o.id
          LEFT JOIN paypal_checkout_order paid_online ON paid_online.id=o.online_checkout_id
          LEFT JOIN marketing_campaign_brief c ON c.order_id=o.id
          LEFT JOIN directory_category dc ON dc.id=c.category_id
          LEFT JOIN marketing_ad_totals stats ON stats.order_id=o.id
          WHERE ($2::text='admin' OR (o.account_id=$1 AND (o.kind='credits')=($2='credits')))
            AND ($4::text IS NULL OR
              (o.kind IN ('banner','featured','nearby') AND o.status='paid' AND o.revoked_at IS NULL
                AND o.ends_at>now() AND b.owner_user_id=o.account_id AND b.status='published'
                AND b.deleted_at IS NULL AND package_allows_listing(b)
                AND (c.impression_goal IS NULL OR c.impression_goal>COALESCE(stats.impressions,0))
                AND CASE WHEN $4='zakazane' THEN o.starts_at>now() ELSE o.starts_at<=now() END))
          ORDER BY CASE o.status WHEN 'requested' THEN 0 WHEN 'quoted' THEN 1 WHEN 'paid' THEN 2 ELSE 3 END,o.created_at DESC,o.id LIMIT 21 OFFSET $3`,
            [actor.id, mode, page * 20, promotionView ?? null],
          )
        ).rows;
        const businesses =
          mode === "ads"
            ? (
                await client.query<{
                  id: string;
                  title: string;
                  adEligible: boolean;
                  website: boolean;
                  assets: BusinessMediaAsset[];
                }>(
                  `SELECT b.id,b.title,(b.website_url ~ '^https://') IS TRUE AS website,(b.status='published' AND package_allows_listing(b)) AS "adEligible",
                     COALESCE((SELECT jsonb_agg(jsonb_build_object('kind',i.kind,'slot',i.slot,'version',i.version,'width',i.width,'height',i.height) ORDER BY i.kind,i.slot)
                               FROM directory_business_image i WHERE i.business_id=b.id),'[]'::jsonb) AS assets
                   FROM directory_business b WHERE b.owner_user_id=$1 AND deleted_at IS NULL AND status<>'archived' ORDER BY title,id`,
                  [actor.id],
                )
              ).rows
            : [];
        const config = checkoutConfiguration();
        const platformCreditsOnly = readPlatformCreditsOnly();
        return {
          orders: orders.slice(0, 20),
          more: orders.length > 20,
          balance: await walletBalance(client, actor.id),
          creditUnitBamMinor: await readWalletRate(client),
          movements: mode === "credits" ? await readCreditMovements(client, actor.id) : undefined,
          businesses: businesses
            .filter((b) => b.adEligible)
            .map(({ id, title, website, assets }) => ({ id, title, website, assets })),
          adPricing: mode === "ads" ? await readAdPricing(client) : undefined,
          locations:
            mode === "ads"
              ? (
                  await client.query<{ cities: string[]; countries: string[] }>(`SELECT
            COALESCE(array_agg(DISTINCT b.city ORDER BY b.city) FILTER(WHERE b.city IS NOT NULL AND b.city<>''),'{}') AS cities,
            COALESCE(array_agg(DISTINCT b.country_code ORDER BY b.country_code) FILTER(WHERE b.country_code IS NOT NULL),'{}') AS countries
            FROM directory_business b JOIN auth_user u ON u.id=b.owner_user_id WHERE b.status='published'
            AND package_allows_listing(b) AND u.approval='approved' AND u."emailVerified" AND u.role IN ('member','owner')`)
                ).rows[0]
              : undefined,
          categories:
            mode === "ads"
              ? (
                  await client.query<{ id: string; name: string }>(
                    "SELECT id,name FROM directory_category ORDER BY name,id",
                  )
                ).rows
              : undefined,
          productionBusinesses: businesses.map(({ id, title }) => ({ id, title })),
          promotions: mode === "ads" ? await paidPromotions(client, actor.id) : [],
          included: mode === "ads" ? await packagePromotions(client, actor.id) : [],
          checkoutAvailable:
            !platformCreditsOnly &&
            config?.chargingApproved === true &&
            config.environment === "live",
          platformCreditsOnly,
          creditTopUpBankOnly: readCreditTopUpBankOnly(),
          creditCardTopUps:
            config?.chargingApproved === true &&
            config.environment === "live" &&
            creditCardTopUpsAvailable(config, config.environment, actor.role),
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
          command.action === "quote" ||
            command.action === "confirm" ||
            command.action === "setCreditRate",
        );
        if (command.action === "setCreditRate") return setCreditRate(client, actor.id, command);
        if (command.action === "topUp") {
          if (readCreditTopUpBankOnly()) fail(409, "CREDIT_TOP_UP_BANK_ONLY");
          const result = await createCreditTopUp(client, actor.id, command);
          if (
            (
              await client.query("SELECT 1 FROM ahi_wallet_bank_topup WHERE order_id=$1", [
                result.id,
              ])
            ).rowCount
          )
            fail(409, "BANK_TOPUP_PENDING");
          return result;
        }
        if (command.action === "promoteCategory")
          return buyCategoryPromotion(client, actor.id, command);
        const quoteRate = command.action === "quote" ? await lockWalletRate(client) : null;
        if (command.action === "request") {
          if (command.kind === "credits" && readCreditTopUpBankOnly())
            fail(409, "CREDIT_TOP_UP_BANK_ONLY");
          const prior = (
            await client.query<LockedOrder>(
              "SELECT o.*,c.request_fingerprint FROM marketing_order o LEFT JOIN marketing_campaign_brief c ON c.order_id=o.id WHERE o.id=$1 FOR UPDATE OF o",
              [command.id],
            )
          ).rows[0];
          if (prior) {
            if (
              prior.account_id !== actor.id ||
              prior.kind !== command.kind ||
              prior.quantity !== command.quantity ||
              prior.business_id !== (command.businessId ?? null) ||
              (prior.request_fingerprint ?? null) !==
                (command.campaign ? briefFingerprint(command.campaign) : null)
            )
              fail(409, "OFFER_CHANGED");
            return { id: command.id };
          }
          if (command.kind === "banner" && !command.campaign && readPlatformCreditsOnly())
            fail(400, "CAMPAIGN_REQUIRED");
          if (
            command.businessId &&
            (await validBusiness(client, command.businessId, actor.id, command.kind))
          )
            fail(409, "INCLUDED_IN_PACKAGE");
          if (
            command.businessId &&
            (
              await client.query(
                "SELECT id FROM marketing_order WHERE business_id=$1 AND kind=$2 AND campaign_key IS NOT DISTINCT FROM $3::text AND status='paid' AND revoked_at IS NULL AND ends_at>now()",
                [
                  command.businessId,
                  command.kind,
                  command.campaign ? campaignKey(command.campaign) : null,
                ],
              )
            ).rowCount
          )
            fail(409, "ACTIVE_BANNER");
          const result = await client.query(
            `INSERT INTO marketing_order(id,account_id,kind,business_id,quantity,campaign_key) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id`,
            [
              command.id,
              actor.id,
              command.kind,
              command.businessId ?? null,
              command.quantity,
              command.campaign ? campaignKey(command.campaign) : null,
            ],
          );
          if (!result.rowCount) fail(409, "OPEN_OFFER");
          if (command.campaign && command.businessId)
            await saveCampaignBrief(client, command.id, command.businessId, command.campaign);
          return { id: command.id };
        }
        // Lock matching listing before the order, as the ownership trigger also locks in this order.
        const target = (
          await client.query<
            Pick<LockedOrder, "business_id" | "account_id" | "kind"> & {
              paid_with_credits: boolean;
            }
          >(
            `SELECT o.business_id,o.account_id,o.kind,(${paidWithCredits}) AS paid_with_credits
             FROM marketing_order o WHERE o.id=$1`,
            [command.id],
          )
        ).rows[0];
        if (!target || (actor.role !== "owner" && target.account_id !== actor.id))
          fail(404, "OFFER_NOT_FOUND");
        // A successful debit can be replayed even if the listing became ineligible after payment.
        if (
          command.action === "useCredits" &&
          target.account_id === actor.id &&
          target.paid_with_credits
        )
          return { id: command.id };
        if (command.action === "confirm" && target.account_id !== actor.id) {
          const customer = await client.query(
            `SELECT id FROM auth_user WHERE id=$1 AND approval='approved' AND "emailVerified"
              AND role IN ('owner','member') AND erased_at IS NULL FOR UPDATE`,
            [target.account_id],
          );
          if (!customer.rowCount) fail(409, "ACCOUNT_CHANGED");
        }
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
          (
            await client.query("SELECT 1 FROM ahi_wallet_bank_topup WHERE order_id=$1", [
              command.id,
            ])
          ).rowCount
        )
          fail(409, "BANK_TOPUP_REVIEW_REQUIRED");
        if (
          order.status === "quoted" &&
          command.action !== "quote" &&
          (await pendingQuoteOrder(client, command.id, "live"))
        )
          fail(409, "QUOTE_PAYMENT_PENDING");
        if (command.action === "quote") {
          if (includedUntil) fail(409, "INCLUDED_IN_PACKAGE");
          const creditsOnly = readPlatformCreditsOnly();
          if (order.kind === "credits" && readCreditTopUpBankOnly())
            fail(409, "CREDIT_TOP_UP_BANK_ONLY");
          const creditPrice = command.creditPrice;
          if (creditsOnly && (command.amountMinor !== undefined || creditPrice === undefined))
            fail(409, "PLATFORM_CREDITS_ONLY");
          const amountMinor =
            command.amountMinor ??
            (creditPrice !== undefined && quoteRate !== null
              ? Math.round(creditPrice * quoteRate)
              : null);
          if (!amount(amountMinor, 100000000)) fail(400, "INVALID_OFFER");
          if (
            (command.offerStandardTargeting && !order.campaign_key) ||
            (command.campaignBenefit &&
              (!order.campaign_key || (!creditsOnly && creditPrice !== undefined)))
          )
            fail(400, "INVALID_CAMPAIGN");
          if (order.campaign_key)
            await checkCampaignQuote(
              client,
              command.id,
              amountMinor,
              command.campaignBenefit,
              command.offerStandardTargeting,
              command.expectedAssetVersion ?? 0,
            );
          const creditService =
            isPlacement(order.kind) || (creditsOnly && isProductionService(order.kind));
          if (order.status !== "requested" || (creditPrice !== undefined && !creditService))
            fail(409, "OFFER_CHANGED");
          await client.query(
            "UPDATE marketing_order SET status='quoted',amount_minor=$2,instructions=$3,credit_price=$4,quoted_at=now(),quoted_by=$5,wallet_price_minor=$6,campaign_benefit=$7 WHERE id=$1",
            [
              command.id,
              amountMinor,
              command.instructions,
              isPlacement(order.kind) && Number.isInteger(creditPrice) ? creditPrice : null,
              actor.id,
              !creditService
                ? null
                : creditPrice !== undefined
                  ? Math.round(creditPrice * 100)
                  : quoteRate === null
                    ? null
                    : creditsForBamMinor(amountMinor, quoteRate),
              command.campaignBenefit ?? null,
            ],
          );
        } else if (command.action === "close") {
          if (order.status === "paid") fail(409, "OFFER_CHANGED");
          await client.query(
            "UPDATE marketing_order SET status='closed' WHERE id=$1 AND status IN ('quoted','requested')",
            [command.id],
          );
        } else {
          if (
            command.action === "useCredits" &&
            (actor.id !== order.account_id ||
              (!isPlacement(order.kind) && !isProductionService(order.kind)) ||
              order.wallet_price_minor === null)
          )
            fail(403, "OFFER_FORBIDDEN");
          const reference = command.action === "confirm" ? command.reference : null;
          if (command.action === "confirm" && command.amountMinor !== order.amount_minor)
            fail(409, "AMOUNT_MISMATCH");
          if (
            order.status === "paid" &&
            (command.action === "confirm"
              ? order.bank_reference === reference
              : order.wallet_payment_id === command.id ||
                (!order.online_checkout_id && !order.bank_reference && order.credit_price !== null))
          )
            return { id: command.id };
          if (order.status !== "quoted") fail(409, "OFFER_CHANGED");
          if (command.action === "confirm") {
            if (order.kind === "credits" && readCreditTopUpBankOnly())
              fail(409, "CREDIT_TOP_UP_BANK_ONLY");
            if (readPlatformCreditsOnly()) fail(409, "PLATFORM_CREDITS_ONLY");
          }
          if (isPlacement(order.kind)) {
            const active = await client.query(
              "SELECT id FROM marketing_order WHERE business_id=$1 AND kind=$2 AND campaign_key IS NOT DISTINCT FROM $3::text AND status='paid' AND revoked_at IS NULL AND ends_at>clock_timestamp()",
              [order.business_id, order.kind, order.campaign_key],
            );
            if (active.rowCount) fail(409, "ACTIVE_BANNER");
          }
          try {
            if (command.action === "useCredits") {
              const debited = await debitWallet(client, {
                accountId: actor.id,
                purchaseId: command.id,
                kind: "marketing",
                creditMinor: Number(order.wallet_price_minor),
              });
              if (!debited) fail(409, "WALLET_PAYMENT_CHANGED");
            }
            await settleMarketingPayment(client, {
              id: command.id,
              actorId: actor.id,
              reference,
              includedUntil,
              walletPaymentId: command.action === "useCredits" ? command.id : null,
            });
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
