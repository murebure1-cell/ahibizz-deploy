import type { PayPalOrderFlow } from "../../lib/paypal-order-flow";

/** Server-only transport. Durable authorization/order persistence belongs to the checkout service. */
export class PayPalLiveError extends Error {}
export type LiveOrder = {
  id: string;
  purpose: "promotion" | "support";
  amountMinor: number;
  currency: "EUR";
  merchantId: string;
  providerOrderId?: string;
  createRequestId: string;
  captureRequestId: string;
};
export type LiveConfiguration = {
  clientId: string;
  clientSecret: string;
  merchantId: string;
  webhookId: string;
  publicOrigin: string;
  chargingApproved: boolean;
  refundsApproved?: boolean;
  environment?: "sandbox" | "live";
};
type Json = Record<string, unknown>;
export type VerifiedCapture = {
  status: "COMPLETED";
  captureId: string;
  completedAt: string;
  amountMinor: number;
  currency: "EUR";
  merchantId: string;
  providerOrderId: string;
};
function record(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PayPalLiveError("INVALID_PROVIDER_RESPONSE");
  return value as Json;
}
function providerId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z0-9]{10,32}$/.test(value))
    throw new PayPalLiveError("INVALID_PROVIDER_ID");
  return value;
}
export function liveAmount(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 1 || minor > 1000000)
    throw new PayPalLiveError("INVALID_AMOUNT");
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
}
export function liveApprovalUrl(value: unknown, environment: "sandbox" | "live" = "live") {
  if (typeof value !== "string") throw new PayPalLiveError("INVALID_APPROVAL_URL");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname !== (environment === "sandbox" ? "www.sandbox.paypal.com" : "www.paypal.com") ||
    url.username ||
    url.password ||
    url.port ||
    !["/checkoutnow", "/pay/checkout"].includes(url.pathname)
  )
    throw new PayPalLiveError("INVALID_APPROVAL_URL");
  return url.href;
}
function orderUnit(value: unknown, expected: LiveOrder) {
  const order = record(value);
  if (
    order.id !== expected.providerOrderId ||
    order.intent !== "CAPTURE" ||
    !Array.isArray(order.purchase_units) ||
    order.purchase_units.length !== 1
  )
    throw new PayPalLiveError("ORDER_MISMATCH");
  const unit = record(order.purchase_units[0]),
    amount = record(unit.amount);
  if (
    unit.custom_id !== expected.id ||
    record(unit.payee).merchant_id !== expected.merchantId ||
    amount.currency_code !== "EUR" ||
    amount.value !== liveAmount(expected.amountMinor)
  )
    throw new PayPalLiveError("ORDER_MISMATCH");
  return { order, unit };
}
function captureFacts(capture: Json, expected: LiveOrder): Omit<VerifiedCapture, "status"> {
  const amount = record(capture.amount);
  if (
    capture.final_capture !== true ||
    typeof capture.id !== "string" ||
    amount.currency_code !== "EUR" ||
    amount.value !== liveAmount(expected.amountMinor)
  )
    throw new PayPalLiveError("CAPTURE_MISMATCH");
  if (
    typeof capture.create_time !== "string" ||
    !Number.isFinite(Date.parse(capture.create_time)) ||
    !expected.providerOrderId
  )
    throw new PayPalLiveError("CAPTURE_TIME_MISSING");
  return {
    captureId: capture.id,
    completedAt: capture.create_time,
    amountMinor: expected.amountMinor,
    currency: "EUR",
    merchantId: expected.merchantId,
    providerOrderId: expected.providerOrderId,
  };
}
export function verifyLiveOrder(
  value: unknown,
  expected: LiveOrder,
  requireCaptured?: true,
): VerifiedCapture;
export function verifyLiveOrder(
  value: unknown,
  expected: LiveOrder,
  requireCaptured: false,
): { status: string; captureId: null };
export function verifyLiveOrder(value: unknown, expected: LiveOrder, requireCaptured = true) {
  const { order, unit } = orderUnit(value, expected);
  if (!requireCaptured) {
    if (order.status !== "APPROVED" && order.status !== "COMPLETED")
      throw new PayPalLiveError("PAYMENT_NOT_APPROVED");
    return { status: String(order.status), captureId: null };
  }
  const captures = record(unit.payments).captures;
  if (order.status !== "COMPLETED" || !Array.isArray(captures) || captures.length !== 1)
    throw new PayPalLiveError("PAYMENT_NOT_COMPLETED");
  const capture = record(captures[0]);
  if (capture.status !== "COMPLETED") throw new PayPalLiveError("CAPTURE_MISMATCH");
  return { status: "COMPLETED" as const, ...captureFacts(capture, expected) };
}
function normalizeRefund(
  value: Json,
  captureId: string,
  amountMinor: number,
  environment: "sandbox" | "live",
) {
  const amount = record(value.amount);
  if (
    typeof value.id !== "string" ||
    !/^[A-Z0-9]{10,32}$/.test(value.id) ||
    amount.currency_code !== "EUR" ||
    amount.value !== liveAmount(amountMinor) ||
    !Array.isArray(value.links)
  )
    throw new PayPalLiveError("REFUND_MISMATCH");
  const parent = value.links.map(record).find((link) => link.rel === "up");
  if (typeof parent?.href !== "string") throw new PayPalLiveError("REFUND_MISMATCH");
  const url = new URL(parent.href);
  const hosts =
    environment === "sandbox"
      ? ["api.sandbox.paypal.com", "api-m.sandbox.paypal.com"]
      : ["api.paypal.com", "api-m.paypal.com"];
  if (
    url.protocol !== "https:" ||
    !hosts.includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== `/v2/payments/captures/${captureId}`
  )
    throw new PayPalLiveError("REFUND_MISMATCH");
  if (!["COMPLETED", "PENDING", "FAILED", "CANCELLED"].includes(String(value.status)))
    throw new PayPalLiveError("REFUND_MISMATCH");
  return {
    refundId: value.id,
    status: (value.status === "CANCELLED" ? "FAILED" : value.status) as
      | "COMPLETED"
      | "PENDING"
      | "FAILED",
    amountMinor,
    captureId,
  };
}
export function createLivePayPal(config: LiveConfiguration, transport: typeof fetch = fetch) {
  const environment = config.environment ?? "live";
  const base =
    environment === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
  const origin = new URL(config.publicOrigin);
  if (
    (origin.protocol !== "https:" &&
      !(
        environment === "sandbox" &&
        origin.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(origin.hostname)
      )) ||
    origin.origin !== config.publicOrigin ||
    origin.username ||
    origin.password ||
    !config.clientId ||
    !config.clientSecret ||
    !config.merchantId
  )
    throw new PayPalLiveError("INVALID_CONFIGURATION");
  function canCharge(order: LiveOrder, refund = false) {
    if (!(refund ? config.refundsApproved : config.chargingApproved) || !config.webhookId)
      throw new PayPalLiveError("LIVE_CHECKOUT_NOT_RELEASED");
    if (
      order.merchantId !== config.merchantId ||
      order.currency !== "EUR" ||
      !/^[a-f0-9-]{36}$/.test(order.id)
    )
      throw new PayPalLiveError("INVALID_ORDER");
    liveAmount(order.amountMinor);
  }
  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    key?: string,
    rawBody?: string,
  ) {
    const tokenResponse = await transport(`${base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!tokenResponse.ok) throw new PayPalLiveError("PAYPAL_AUTH_FAILED");
    const token = record(await tokenResponse.json()).access_token;
    if (typeof token !== "string") throw new PayPalLiveError("PAYPAL_AUTH_FAILED");
    const response = await transport(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...(key ? { "PayPal-Request-Id": key } : {}),
      },
      ...(rawBody !== undefined
        ? { body: rawBody }
        : body === undefined
          ? {}
          : { body: JSON.stringify(body) }),
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new PayPalLiveError("PAYPAL_REQUEST_FAILED");
    return record(await response.json());
  }
  async function readOrder(order: LiveOrder) {
    const data = await request(`/v2/checkout/orders/${providerId(order.providerOrderId)}`);
    orderUnit(data, order);
    return data;
  }
  return {
    async create(order: LiveOrder, flow: PayPalOrderFlow = "redirect") {
      if (
        !["redirect", "sdk", "guest"].includes(flow) ||
        (flow === "guest" && order.purpose !== "promotion")
      )
        throw new PayPalLiveError("INVALID_CHECKOUT_FLOW");
      canCharge(order);
      const data = await request(
        "/v2/checkout/orders",
        "POST",
        {
          intent: "CAPTURE",
          purchase_units: [
            {
              custom_id: order.id,
              reference_id: order.purpose,
              description:
                order.purpose === "promotion"
                  ? "AhiBizz: isticanje profila u kategoriji, 7 dana"
                  : "AhiBizz: dobrovoljna podrška razvoju",
              payee: { merchant_id: config.merchantId },
              amount: { currency_code: "EUR", value: liveAmount(order.amountMinor) },
            },
          ],
          ...(flow === "sdk"
            ? {
                application_context: { shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW" },
              }
            : {
                payment_source: {
                  paypal: {
                    experience_context: {
                      ...(flow === "guest" ? { landing_page: "GUEST_CHECKOUT" } : {}),
                      brand_name: "AhiBizz",
                      locale: "en-BA",
                      shipping_preference: "NO_SHIPPING",
                      user_action: "PAY_NOW",
                      return_url: `${origin.origin}/naplata/povratak?narudzba=${order.id}`,
                      cancel_url: `${origin.origin}/naplata/odustajanje?narudzba=${order.id}`,
                    },
                  },
                },
              }),
        },
        order.createRequestId,
      );
      if (flow === "sdk") {
        if (
          !["CREATED", "SAVED", "APPROVED", "PAYER_ACTION_REQUIRED"].includes(String(data.status))
        )
          throw new PayPalLiveError("INVALID_ORDER_RESPONSE");
        orderUnit(data, { ...order, providerOrderId: providerId(data.id) });
      }
      if (data.links !== undefined && !Array.isArray(data.links))
        throw new PayPalLiveError("INVALID_ORDER_RESPONSE");
      const approval = (Array.isArray(data.links) ? data.links : [])
        .map(record)
        .find((link) => link.rel === "payer-action" || link.rel === "approve");
      return {
        providerOrderId: providerId(data.id),
        approvalUrl:
          flow === "sdk" && !approval ? null : liveApprovalUrl(approval?.href, environment),
      };
    },
    async capture(order: LiveOrder) {
      canCharge(order);
      let data = await readOrder(order);
      const before = verifyLiveOrder(data, order, false);
      if (before.status !== "COMPLETED") {
        await request(
          `/v2/checkout/orders/${order.providerOrderId}/capture`,
          "POST",
          {},
          order.captureRequestId,
        );
        data = await readOrder(order);
      }
      return verifyLiveOrder(data, order);
    },
    async canResumeCard(order: LiveOrder) {
      const data = await readOrder(order);
      const { unit } = orderUnit(data, order);
      const captures = record(unit.payments).captures;
      return (
        ["CREATED", "SAVED", "PAYER_ACTION_REQUIRED"].includes(String(data.status)) &&
        (captures === undefined || (Array.isArray(captures) && captures.length === 0))
      );
    },
    async inspect(order: LiveOrder) {
      const data = await readOrder(order);
      if (
        ["CREATED", "SAVED", "PAYER_ACTION_REQUIRED", "VOIDED", "APPROVED"].includes(
          String(data.status),
        )
      )
        return { status: "UNPAID" as const };
      const { unit } = orderUnit(data, order);
      const captures = record(unit.payments).captures;
      if (!Array.isArray(captures) || captures.length !== 1)
        throw new PayPalLiveError("CAPTURE_MISMATCH");
      const id = providerId(record(captures[0]).id);
      const capture = await request(`/v2/payments/captures/${id}`);
      if (
        capture.id !== id ||
        record(capture.payee).merchant_id !== order.merchantId ||
        record(record(capture.supplementary_data).related_ids).order_id !== order.providerOrderId
      )
        throw new PayPalLiveError("CAPTURE_MISMATCH");
      const facts = captureFacts(capture, order);
      if (capture.status === "REFUNDED")
        return { status: "REFUNDED" as const, ...facts, refundedMinor: order.amountMinor };
      if (capture.status === "PARTIALLY_REFUNDED")
        return { status: "PARTIALLY_REFUNDED" as const, ...facts, refundedMinor: null };
      if (["DECLINED", "FAILED"].includes(String(capture.status)))
        return { status: "REVERSED" as const, ...facts, refundedMinor: order.amountMinor };
      if (capture.status !== "COMPLETED") return { status: "PENDING" as const, ...facts };
      return { status: "COMPLETED" as const, ...facts };
    },
    async refund(
      order: LiveOrder,
      input: { captureId: string; amountMinor: number; requestId: string },
    ) {
      canCharge(order, true);
      providerId(input.captureId);
      if (input.amountMinor > order.amountMinor || !input.requestId)
        throw new PayPalLiveError("INVALID_REFUND");
      liveAmount(input.amountMinor);
      const data = await readOrder(order);
      const { unit } = orderUnit(data, order);
      const captures = record(unit.payments).captures;
      if (
        !Array.isArray(captures) ||
        captures.length !== 1 ||
        record(captures[0]).id !== input.captureId
      )
        throw new PayPalLiveError("CAPTURE_MISMATCH");
      const result = await request(
        `/v2/payments/captures/${input.captureId}/refund`,
        "POST",
        {
          amount: { value: liveAmount(input.amountMinor), currency_code: "EUR" },
          custom_id: order.id,
        },
        input.requestId,
      );
      return normalizeRefund(result, input.captureId, input.amountMinor, environment);
    },
    async readRefund(
      order: LiveOrder,
      input: { refundId: string; captureId: string; amountMinor: number },
    ) {
      providerId(input.refundId);
      providerId(input.captureId);
      if (input.amountMinor > order.amountMinor) throw new PayPalLiveError("INVALID_REFUND");
      const result = normalizeRefund(
        await request(`/v2/payments/refunds/${input.refundId}`),
        input.captureId,
        input.amountMinor,
        environment,
      );
      if (result.refundId !== input.refundId) throw new PayPalLiveError("REFUND_MISMATCH");
      return result;
    },
    async verifyWebhook(headers: Headers, event: unknown, rawJson?: string) {
      if (typeof rawJson !== "string" || Buffer.byteLength(rawJson, "utf8") > 131072) return false;
      try {
        const parsed = record(JSON.parse(rawJson));
        if (JSON.stringify(parsed) !== JSON.stringify(event)) return false;
      } catch {
        return false;
      }
      if (!config.webhookId) throw new PayPalLiveError("WEBHOOK_NOT_CONFIGURED");
      const certificate = headers.get("paypal-cert-url");
      if (!certificate) return false;
      let url: URL;
      try {
        url = new URL(certificate);
      } catch {
        return false;
      }
      const hosts =
        environment === "sandbox"
          ? ["api.sandbox.paypal.com", "api-m.sandbox.paypal.com"]
          : ["api.paypal.com", "api-m.paypal.com"];
      if (
        url.protocol !== "https:" ||
        !hosts.includes(url.hostname) ||
        !url.pathname.startsWith("/v1/notifications/certs/") ||
        url.username ||
        url.password ||
        url.port
      )
        return false;
      const verification = {
        auth_algo: headers.get("paypal-auth-algo"),
        cert_url: certificate,
        transmission_id: headers.get("paypal-transmission-id"),
        transmission_sig: headers.get("paypal-transmission-sig"),
        transmission_time: headers.get("paypal-transmission-time"),
        webhook_id: config.webhookId,
      };
      // Embed the original validated JSON verbatim, preserving its signed representation.
      const rawBody = `${JSON.stringify(verification).slice(0, -1)},"webhook_event":${rawJson}}`;
      const response = await request(
        "/v1/notifications/verify-webhook-signature",
        "POST",
        undefined,
        undefined,
        rawBody,
      );
      return response.verification_status === "SUCCESS";
    },
  };
}
