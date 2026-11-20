import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { type BillingPeriod, billingPackages } from "../../lib/billing";
import { accountTransaction, createAccountAccess } from "../auth/accounts";
import type { AuthService } from "../auth/service";
import { type PlanReferences, packageQuote, subscriptionConfig } from "./config";
import { subscriptionApi, verifySandboxPlan } from "./provider";
import { fail } from "./service";

const key = "billing.live_paypal_packages.v1";
const product = "AHIBIZZ-BUSINESS-PACKAGES-V1";
const events = [
  "BILLING.SUBSCRIPTION.ACTIVATED",
  "BILLING.SUBSCRIPTION.CANCELLED",
  "BILLING.SUBSCRIPTION.SUSPENDED",
  "BILLING.SUBSCRIPTION.EXPIRED",
  "PAYMENT.SALE.COMPLETED",
  "PAYMENT.SALE.REFUNDED",
  "PAYMENT.SALE.REVERSED",
];
function merchant(env: NodeJS.ProcessEnv) {
  const origin = env.BETTER_AUTH_URL,
    merchantId = env.PAYPAL_LIVE_MERCHANT_ID,
    clientId = env.PAYPAL_LIVE_CLIENT_ID,
    clientSecret = env.PAYPAL_LIVE_CLIENT_SECRET;
  if (
    env.PAYPAL_CHECKOUT_ENVIRONMENT !== "live" ||
    !origin ||
    !merchantId ||
    !clientId ||
    !clientSecret
  )
    return null;
  try {
    const url = new URL(origin);
    if (
      url.origin !== origin ||
      url.protocol !== "https:" ||
      origin !== env.PAYPAL_CHECKOUT_PUBLIC_ORIGIN
    )
      return null;
  } catch {
    return null;
  }
  const binding = createHash("sha256")
    .update(JSON.stringify([origin, merchantId, clientId]))
    .digest("hex");
  return { origin, merchantId, clientId, clientSecret, binding };
}
export async function livePackageConfig(pool: Pool | null, env: NodeJS.ProcessEnv = process.env) {
  const direct = subscriptionConfig(
    "live",
    env.AHIBIZZ_LIVE_SUBSCRIPTIONS_ENABLED === "false"
      ? { ...env, AHIBIZZ_LIVE_SUBSCRIPTIONS_ENABLED: "true" }
      : env,
  );
  if (direct) return direct;
  const active = merchant(env);
  if (!pool || !active) return null;
  const data = (
    await pool.query<{ value: { binding?: string; plans?: PlanReferences; webhookId?: string } }>(
      "SELECT value FROM platform_settings WHERE key=$1",
      [key],
    )
  ).rows[0]?.value;
  if (data?.binding !== active.binding || !data.plans || !data.webhookId) return null;
  const configured: NodeJS.ProcessEnv = {
    ...env,
    AHIBIZZ_LIVE_SUBSCRIPTIONS_ENABLED: "true",
    PAYPAL_LIVE_SUBSCRIPTION_WEBHOOK_ID: data.webhookId,
  };
  for (const plan of billingPackages)
    for (const period of ["monthly", "annual"]) {
      configured[`PAYPAL_LIVE_PLAN_${plan.id.toUpperCase()}_${period.toUpperCase()}`] =
        data.plans[`${plan.id}:${period}`];
    }
  return subscriptionConfig("live", configured);
}
type Api = ReturnType<typeof subscriptionApi>;
function objects(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some((x) => !x || typeof x !== "object" || Array.isArray(x)))
    fail(502, "PAYPAL_PACKAGE_CONFIGURATION_INVALID");
  return value as Record<string, unknown>[];
}
export async function provisionPackagePlans(api: Api, origin: string) {
  let item = await api(`/v1/catalogs/products/${product}`, "GET", undefined, undefined, true);
  if (!item.id)
    item = await api(
      "/v1/catalogs/products",
      "POST",
      { id: product, name: "AhiBizz poslovni paketi", type: "SERVICE" },
      product,
    );
  if (item.id !== product || item.type !== "SERVICE")
    fail(502, "PAYPAL_PACKAGE_CONFIGURATION_INVALID");
  const existing: Record<string, unknown>[] = [];
  for (let page = 1; ; page++) {
    const result = await api(
      `/v1/billing/plans?product_id=${product}&page_size=20&page=${page}&total_required=true`,
    );
    existing.push(...objects(result.plans));
    if (!Number.isSafeInteger(result.total_pages) || Number(result.total_pages) > 500)
      fail(502, "PAYPAL_PACKAGE_CONFIGURATION_INVALID");
    if (page >= Number(result.total_pages)) break;
  }
  const plans: PlanReferences = {};
  for (const plan of billingPackages)
    for (const period of ["monthly", "annual"] as const satisfies readonly BillingPeriod[]) {
      const quote = packageQuote(plan.id, period);
      if (!quote) fail(503, "INVALID_SUBSCRIPTION_INPUT");
      const name = `AhiBizz ${plan.name} · ${period === "monthly" ? "12 mjesečnih rata" : "12 mjeseci unaprijed"}`;
      const matches = existing.filter((p) => p.name === name);
      if (matches.length > 1) fail(409, "PAYPAL_PACKAGE_CONFIGURATION_INVALID");
      const entry =
        matches[0] ??
        (await api(
          "/v1/billing/plans",
          "POST",
          {
            product_id: product,
            name,
            status: "ACTIVE",
            billing_cycles: [
              {
                frequency: {
                  interval_unit: period === "annual" ? "YEAR" : "MONTH",
                  interval_count: 1,
                },
                tenure_type: "REGULAR",
                sequence: 1,
                total_cycles: quote.totalCycles,
                pricing_scheme: {
                  fixed_price: {
                    currency_code: "EUR",
                    value: (quote.amountEurMinor / 100).toFixed(2),
                  },
                },
              },
            ],
            payment_preferences: { auto_bill_outstanding: false, payment_failure_threshold: 1 },
          },
          `ahibizz-v1-${plan.id}-${period}`,
        ));
      if (
        typeof entry.id !== "string" ||
        !/^P-[A-Z0-9]{8,32}$/.test(entry.id) ||
        Object.values(plans).includes(entry.id)
      )
        fail(502, "PAYPAL_PACKAGE_CONFIGURATION_INVALID");
      const detail = await api(`/v1/billing/plans/${entry.id}`);
      if (detail.product_id !== product) fail(502, "PAYPAL_PACKAGE_CONFIGURATION_INVALID");
      verifySandboxPlan(detail, {
        planId: entry.id,
        period,
        totalCycles: quote.totalCycles,
        amountEurMinor: quote.amountEurMinor,
      });
      plans[`${plan.id}:${period}`] = entry.id;
    }
  const url = `${origin}/api/paketi/webhook`;
  const matches = objects((await api("/v1/notifications/webhooks")).webhooks).filter(
    (w) => w.url === url,
  );
  if (matches.length > 1) fail(409, "PAYPAL_PACKAGE_CONFIGURATION_INVALID");
  const hook =
    matches[0] ??
    (await api("/v1/notifications/webhooks", "POST", {
      url,
      event_types: events.map((name) => ({ name })),
    }));
  if (typeof hook.id !== "string" || !/^[A-Z0-9]{8,64}$/.test(hook.id))
    fail(502, "PAYPAL_PACKAGE_CONFIGURATION_INVALID");
  const checked = await api(`/v1/notifications/webhooks/${hook.id}`);
  const subscribed = objects(checked.event_types).map((e) => e.name);
  if (
    checked.url !== url ||
    checked.id !== hook.id ||
    (!subscribed.includes("*") && !events.every((e) => subscribed.includes(e)))
  )
    fail(502, "PAYPAL_PACKAGE_CONFIGURATION_INVALID");
  return { plans, webhookId: hook.id };
}

export async function configureLivePackages(
  pool: Pool,
  auth: AuthService,
  headers: Headers,
  env = process.env,
) {
  const active = merchant(env);
  if (!active || env.AHIBIZZ_LIVE_SUBSCRIPTIONS_ENABLED === "false")
    fail(503, "PAYPAL_LIVE_CONFIG_UNAVAILABLE");
  if (!headers.get("X-AhiBizz-Account-ID")) fail(401, "ACCOUNT_IDENTITY_CHANGED");
  const access = createAccountAccess(auth),
    session = await access.session(headers);
  await accountTransaction(pool, (c) => access.authority(c, session, true));
  const mapping = await provisionPackagePlans(subscriptionApi("live", active), active.origin);
  await accountTransaction(pool, async (c) => {
    const actor = await access.authority(c, session, true);
    await c.query(
      "INSERT INTO platform_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()",
      [key, JSON.stringify({ ...mapping, binding: active.binding, configuredBy: actor.id })],
    );
  });
  return { available: true, plans: 6 };
}
