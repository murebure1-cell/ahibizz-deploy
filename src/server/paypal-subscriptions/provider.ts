import { AccountAccessError } from "../auth/accounts";
import { createLivePayPal } from "../paypal/live";
import type { SubscriptionEnvironment, sandboxConfig } from "./config";
import type { SandboxRecord } from "./service";

export type PaymentEvidence = {
  id: string;
  amountEurMinor: number;
  at: string;
  status: "COMPLETED" | "REFUNDED" | "REVERSED" | "PARTIALLY_REFUNDED";
};
export const remoteStatuses = [
  "APPROVAL_PENDING",
  "APPROVED",
  "ACTIVE",
  "SUSPENDED",
  "CANCELLED",
  "EXPIRED",
] as const;
export type Snapshot = {
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  updatedAt: string;
  payments: PaymentEvidence[];
  reportedCycles?: number;
  lastPaymentAt?: string | null;
};
export type SubscriptionProvider = {
  create(
    contract: SandboxRecord,
  ): Promise<{ id: string; status: string; approvalUrl: string | null }>;
  inspect(contract: SandboxRecord): Promise<Snapshot>;
  cancel(contract: SandboxRecord): Promise<void>;
  verifyWebhook(headers: Headers, event: unknown, raw: string): Promise<boolean>;
};
function invalid(): never {
  throw new AccountAccessError(502, "SANDBOX_PROVIDER_MISMATCH");
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function price(v: unknown) {
  const m = obj(v);
  if (
    m.currency_code !== "EUR" ||
    typeof m.value !== "string" ||
    !/^\d{1,6}(?:\.\d{1,2})?$/.test(m.value)
  )
    return invalid();
  return Math.round(Number(m.value) * 100);
}
function date(v: unknown) {
  if (typeof v !== "string" || !Number.isFinite(Date.parse(v))) return invalid();
  return new Date(v).toISOString();
}
export function subscriptionApproval(value: unknown, environment: SubscriptionEnvironment) {
  if (typeof value !== "string") return invalid();
  const u = new URL(value);
  if (
    u.origin !==
      (environment === "live" ? "https://www.paypal.com" : "https://www.sandbox.paypal.com") ||
    u.username ||
    u.password ||
    u.hash ||
    !["/webapps/billing/subscriptions", "/agreements/approve", "/checkoutnow"].includes(u.pathname)
  )
    return invalid();
  return u.href;
}
export function sandboxSubscriptionApproval(value: unknown) {
  return subscriptionApproval(value, "sandbox");
}
export function verifySandboxPlan(
  value: unknown,
  c: Pick<SandboxRecord, "planId" | "period" | "totalCycles" | "amountEurMinor">,
) {
  const d = obj(value),
    cycles = d.billing_cycles;
  if (
    d.id !== c.planId ||
    d.status !== "ACTIVE" ||
    !Array.isArray(cycles) ||
    cycles.length !== 1 ||
    d.quantity_supported === true
  )
    return invalid();
  const cycle = obj(cycles[0]),
    freq = obj(cycle.frequency),
    pricing = obj(cycle.pricing_scheme),
    prefs = obj(d.payment_preferences);
  if (
    cycle.tenure_type !== "REGULAR" ||
    cycle.sequence !== 1 ||
    cycle.total_cycles !== c.totalCycles ||
    freq.interval_count !== 1 ||
    freq.interval_unit !== (c.period === "annual" ? "YEAR" : "MONTH") ||
    price(pricing.fixed_price) !== c.amountEurMinor ||
    (prefs.setup_fee !== undefined && price(prefs.setup_fee) !== 0) ||
    (d.taxes !== undefined && Number(obj(d.taxes).percentage) !== 0)
  )
    invalid();
}
export function verifiedSandboxPayment(
  value: unknown,
  expectedMinor: number,
): PaymentEvidence | null {
  const row = obj(value);
  if (row.status === "PENDING" || row.status === "DECLINED" || row.status === "FAILED") return null;
  if (
    !["COMPLETED", "REFUNDED", "REVERSED", "PARTIALLY_REFUNDED"].includes(String(row.status)) ||
    typeof row.id !== "string" ||
    !/^[A-Z0-9-]{5,64}$/.test(row.id)
  )
    return invalid();
  const amount = price(obj(row.amount_with_breakdown).gross_amount);
  if (amount !== expectedMinor) return invalid();
  return {
    id: row.id,
    status: row.status as PaymentEvidence["status"],
    at: date(row.time),
    amountEurMinor: amount,
  };
}
export function subscriptionApi(
  environment: SubscriptionEnvironment,
  config: { clientId: string; clientSecret: string },
  transport: typeof fetch = fetch,
) {
  const base =
    environment === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
  let bearer = "",
    until = 0;
  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    key?: string,
    allowMissing = false,
  ) {
    if (!bearer || Date.now() >= until) {
      const r = await transport(`${base}/v1/oauth2/token`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) throw new AccountAccessError(503, "SANDBOX_PROVIDER_UNAVAILABLE");
      const d = await r.json();
      if (typeof d.access_token !== "string" || !d.access_token) return invalid();
      bearer = d.access_token;
      until = Date.now() + Math.max(0, Math.min(Number(d.expires_in) || 0, 600) - 30) * 1000;
    }
    const r = await transport(base + path, {
      method,
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...(key ? { "PayPal-Request-Id": key } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (r.status === 401) {
      bearer = "";
      until = 0;
    }
    if (allowMissing && r.status === 404 && method === "GET") return {};
    if (!r.ok)
      throw new AccountAccessError(
        502,
        r.status === 403 ? "PAYPAL_SUBSCRIPTIONS_PERMISSION" : "PAYPAL_SUBSCRIPTIONS_UNAVAILABLE",
      );
    if (r.status === 204) {
      if (method === "GET") return invalid();
      return {};
    }
    const data: unknown = await r.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) return invalid();
    return data as Record<string, unknown>;
  }
  return request;
}
export function createSubscriptionProvider(
  environment: SubscriptionEnvironment,
  config: NonNullable<ReturnType<typeof sandboxConfig>>,
  transport: typeof fetch = fetch,
): SubscriptionProvider {
  const request = subscriptionApi(environment, config, transport);
  function subPath(c: SandboxRecord) {
    if (!c.providerId || !/^I-[A-Z0-9]{5,32}$/.test(c.providerId)) return invalid();
    return `/v1/billing/subscriptions/${c.providerId}`;
  }
  async function checkedSubscription(c: SandboxRecord) {
    const d = await request(subPath(c));
    if (
      d.id !== c.providerId ||
      d.plan_id !== c.planId ||
      d.custom_id !== c.id ||
      d.plan_overridden === true ||
      (d.quantity != null && String(d.quantity) !== "1") ||
      !remoteStatuses.some((s) => s === d.status)
    )
      return invalid();
    return d;
  }
  return {
    async create(c) {
      verifySandboxPlan(await request(`/v1/billing/plans/${c.planId}`), c);
      const returnUrl =
        environment === "live"
          ? `${config.origin}/paketi/placanje?paket=${c.packageId}&period=${c.period}&ugovor=${encodeURIComponent(c.id)}`
          : `${config.origin}/paketi/proba?ugovor=${encodeURIComponent(c.id)}`;
      const d = await request(
        "/v1/billing/subscriptions",
        "POST",
        {
          plan_id: c.planId,
          custom_id: c.id,
          application_context: {
            brand_name: "AhiBizz",
            shipping_preference: "NO_SHIPPING",
            user_action: "SUBSCRIBE_NOW",
            return_url: returnUrl,
            cancel_url: `${returnUrl}&odustao=1`,
          },
        },
        c.id,
      );
      if (
        typeof d.id !== "string" ||
        !/^I-[A-Z0-9]{5,32}$/.test(d.id) ||
        !remoteStatuses.some((s) => s === d.status)
      )
        return invalid();
      const confirmed = await checkedSubscription({ ...c, providerId: d.id });
      const pending = confirmed.status === "APPROVAL_PENDING";
      const approve = [confirmed.links, d.links]
        .flatMap((links) => (Array.isArray(links) ? links : []))
        .find((link) => obj(link).rel === "approve");
      return {
        id: d.id,
        status: String(confirmed.status),
        approvalUrl: pending ? subscriptionApproval(obj(approve).href, environment) : null,
      };
    },
    async inspect(c) {
      const d = await checkedSubscription(c);
      const status = String(d.status);
      const startsAt = d.start_time ? date(d.start_time) : null;
      const updatedAt = date(d.status_update_time ?? d.update_time ?? d.create_time);
      const billing = obj(d.billing_info);
      const regular = Array.isArray(billing.cycle_executions)
        ? billing.cycle_executions.find((execution) => obj(execution).tenure_type === "REGULAR")
        : undefined;
      const completed = obj(regular).cycles_completed;
      if (
        completed !== undefined &&
        (typeof completed !== "number" ||
          !Number.isSafeInteger(completed) ||
          completed < 0 ||
          completed > c.totalCycles)
      )
        return invalid();
      let lastPaymentAt: string | null = null;
      if (billing.last_payment != null) {
        const last = obj(billing.last_payment);
        if (price(last.amount) !== c.amountEurMinor) return invalid();
        lastPaymentAt = date(last.time);
      }
      const payments: PaymentEvidence[] = [];
      // Before buyer approval PayPal has no captured transactions to list.
      if (status !== "APPROVAL_PENDING" && status !== "APPROVED") {
        const day = 86400000,
          from = new Date(c.createdAt).valueOf() - 60000;
        const end = Math.min(Date.now(), from + 400 * day);
        for (let start = from; start < end; start += 30 * day) {
          const query = new URLSearchParams({
            start_time: new Date(start).toISOString(),
            end_time: new Date(Math.min(end, start + 30 * day)).toISOString(),
          });
          const result = await request(`${subPath(c)}/transactions?${query}`);
          // PayPal can reply 200 with {} while it prepares the first transaction report.
          // An active subscription by itself supplies no proof of a settled installment.
          if (Object.keys(result).length === 0) continue;
          if (
            !Array.isArray(result.transactions) ||
            (Array.isArray(result.links) && result.links.some((l) => obj(l).rel === "next"))
          )
            return invalid();
          for (const item of result.transactions) {
            const p = verifiedSandboxPayment(item, c.amountEurMinor);
            if (p) payments.push(p);
          }
        }
      }
      return {
        status,
        startsAt,
        endsAt: null,
        updatedAt,
        payments,
        reportedCycles: completed as number | undefined,
        lastPaymentAt,
      };
    },
    async cancel(c) {
      const d = await checkedSubscription(c);
      if (d.status === "CANCELLED" || d.status === "EXPIRED") return;
      await request(`${subPath(c)}/cancel`, "POST", {
        reason:
          environment === "live"
            ? "Otkazivanje AhiBizz pretplate"
            : "Otkazivanje probnog AhiBizz paketa",
      });
    },
    async verifyWebhook(headers, event, raw) {
      if (!config.webhookId || !config.merchantId) return false;
      const verifier = createLivePayPal(
        {
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          environment,
          merchantId: config.merchantId,
          webhookId: config.webhookId,
          publicOrigin: config.origin,
          chargingApproved: false,
        },
        transport,
      );
      return verifier.verifyWebhook(headers, event, raw);
    },
  };
}

export function createSandboxProvider(
  config: NonNullable<ReturnType<typeof sandboxConfig>>,
  transport: typeof fetch = fetch,
) {
  return createSubscriptionProvider("sandbox", config, transport);
}
