import {
  type BillingPackageId,
  type BillingPeriod,
  bamToEuroMinor,
  billingPackages,
} from "../../lib/billing";

export type PlanReferences = Record<string, string>;
export const sandboxPackageCatalog = billingPackages.map((p) => ({
  ...p,
  monthlyEurMinor: bamToEuroMinor(p.monthlyMinor),
  annualEurMinor: bamToEuroMinor(p.annualMinor),
}));

export function packageQuote(packageId: BillingPackageId, period: BillingPeriod) {
  const item = sandboxPackageCatalog.find((p) => p.id === packageId);
  if (!item || (period !== "annual" && period !== "monthly")) return null;
  return {
    amountBamMinor: period === "annual" ? item.annualMinor : item.monthlyMinor,
    amountEurMinor: period === "annual" ? item.annualEurMinor : item.monthlyEurMinor,
    totalCycles: period === "annual" ? 1 : 12,
  };
}

export type SubscriptionEnvironment = "sandbox" | "live";
export function subscriptionConfig(
  environment: SubscriptionEnvironment,
  env: NodeJS.ProcessEnv = process.env,
) {
  const scope = environment.toUpperCase();
  if (env[`AHIBIZZ_${scope}_SUBSCRIPTIONS_ENABLED`] !== "true") return null;
  const clientId = env[`PAYPAL_${scope}_CLIENT_ID`],
    clientSecret = env[`PAYPAL_${scope}_CLIENT_SECRET`];
  const merchantId = env[`PAYPAL_${scope}_MERCHANT_ID`] ?? "",
    webhookId = env[`PAYPAL_${scope}_SUBSCRIPTION_WEBHOOK_ID`] ?? "";
  const origin = env.BETTER_AUTH_URL;
  if (environment === "live" && (!merchantId || !webhookId || !origin?.startsWith("https://")))
    return null;
  if (!clientId || !clientSecret || !origin) return null;
  try {
    const u = new URL(origin);
    if (
      u.origin !== origin ||
      (u.protocol !== "https:" &&
        !(u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)))
    )
      return null;
  } catch {
    return null;
  }
  const plans: PlanReferences = {};
  for (const p of billingPackages)
    for (const period of ["monthly", "annual"]) {
      const id = env[`PAYPAL_${scope}_PLAN_${p.id.toUpperCase()}_${period.toUpperCase()}`];
      if (!id || !/^P-[A-Z0-9]{8,32}$/.test(id) || Object.values(plans).includes(id)) return null;
      plans[`${p.id}:${period}`] = id;
    }
  return {
    clientId,
    clientSecret,
    origin,
    plans,
    webhookId,
    merchantId,
  };
}
export function sandboxConfig(env: NodeJS.ProcessEnv = process.env) {
  return subscriptionConfig("sandbox", env);
}
export function sandboxSubscriptionsEnabled() {
  return sandboxConfig() !== null;
}
