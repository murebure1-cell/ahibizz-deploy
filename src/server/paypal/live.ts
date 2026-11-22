import { type PayPalOrderFlow, supportsCreditTopUpFlow } from "../../lib/paypal-order-flow";
import { type CreditCardTopUpPolicy, creditCardTopUpsAvailable } from "./credit-top-up-policy";

/** Server-only transport. Durable authorization/order persistence belongs to the checkout service. */
export class PayPalLiveError extends Error {
  constructor(
    message: string,
    readonly providerStatus?: number,
  ) {
    super(message);
  }
}
export type LiveOrder = {
  id: string;
  purpose: "promotion" | "support" | "quote";
  creditTopUp?: true;
  creditTopUpCard?: true;
  amountMinor: number;
  currency: "EUR";
  merchantId: string;
  providerOrderId?: string;
  createRequestId: string;
  captureRequestId: string;
};
export type LiveConfiguration = CreditCardTopUpPolicy & {
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
export type VerifiedDecline = Pick<
  VerifiedCapture,
  "captureId" | "amountMinor" | "currency" | "merchantId" | "providerOrderId"
>;
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
export function providerOrderReference(
  relatedId: unknown,
  links: unknown,
  environment: "sandbox" | "live",
) {
  const ids = new Set<string>();
  if (relatedId !== undefined) {
    if (typeof relatedId !== "string" || !/^[A-Z0-9]{10,32}$/.test(relatedId)) return undefined;
    ids.add(relatedId);
  }
  const pattern =
    environment === "sandbox"
      ? /^https:\/\/(?:api|api-m)\.sandbox\.paypal\.com\/v2\/checkout\/orders\/([A-Z0-9]{10,32})$/
      : /^https:\/\/(?:api|api-m)\.paypal\.com\/v2\/checkout\/orders\/([A-Z0-9]{10,32})$/;
  if (Array.isArray(links)) {
    for (const value of links) {
      if (!value || typeof value !== "object" || value.rel !== "up") continue;
      const id = typeof value.href === "string" ? pattern.exec(value.href)?.[1] : undefined;
      if (!id) return undefined;
      ids.add(id);
    }
  }
  return ids.size === 1 ? [...ids][0] : undefined;
}
export function liveAmount(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 1 || minor > 51129188)
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

function hasNoOrderPayments(unit: Json) {
  if (unit.payments === undefined) return true;
  const { captures, authorizations } = record(unit.payments);
  return [captures, authorizations].every(
    (entries) => entries === undefined || (Array.isArray(entries) && entries.length === 0),
  );
}

const captureIssues = new Map([
  ["ORDER_NOT_APPROVED", "PAYMENT_NOT_APPROVED"],
  ["PAYER_ACTION_REQUIRED", "PAYPAL_PAYER_ACTION_REQUIRED"],
  ["INSTRUMENT_DECLINED", "PAYPAL_CARD_DECLINED"],
  ["TRANSACTION_REFUSED", "PAYPAL_CARD_DECLINED"],
  ["CARD_EXPIRED", "PAYPAL_CARD_EXPIRED"],
]);
const declineOrderStates = new Set(["APPROVED", "COMPLETED", "VOIDED"]);
export function isDeclinedCaptureStatus(status: unknown) {
  return status === "DECLINED" || status === "DENIED" || status === "FAILED";
}

function declineFitsOrder(data: Json, unit: Json) {
  if (typeof data.status !== "string" || !declineOrderStates.has(data.status)) return false;
  if (unit.payments === undefined) return data.status !== "COMPLETED";
  const { captures, authorizations } = record(unit.payments);
  if (authorizations !== undefined && (!Array.isArray(authorizations) || authorizations.length > 0))
    return false;
  if (captures === undefined) return data.status !== "COMPLETED";
  return (
    Array.isArray(captures) &&
    (data.status !== "COMPLETED" || captures.length > 0) &&
    captures.every((entry) => isDeclinedCaptureStatus(record(entry).status))
  );
}

function captureIssue(body: unknown) {
  const details = record(body).details;
  if (!Array.isArray(details) || details.length !== 1) return undefined;
  const issue = record(details[0]).issue;
  return typeof issue === "string" ? captureIssues.get(issue) : undefined;
}

function verifyCardAuthentication(order: Json) {
  const card = record(record(order.payment_source).card);
  // SCA_WHEN_REQUIRED can approve a card without any 3D Secure challenge.
  if (card.authentication_result === undefined) return;
  const result = record(card.authentication_result);
  const details = result.three_d_secure === undefined ? undefined : record(result.three_d_secure);
  const enrollment = details?.enrollment_status;
  const authentication = details?.authentication_status;
  if (
    result.liability_shift === "POSSIBLE" &&
    (!details || (enrollment === "Y" && (authentication === "Y" || authentication === "A")))
  )
    return;
  // PayPal also allows unenrolled, unavailable-at-enrollment, or bypassed cards
  // when no authentication was attempted and liability stays with the merchant.
  if (
    result.liability_shift === "NO" &&
    (enrollment === "N" || enrollment === "U" || enrollment === "B") &&
    (authentication === undefined || authentication === "")
  )
    return;
  throw new PayPalLiveError("CARD_AUTHENTICATION_NOT_APPROVED");
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
    if (order.status === "PAYER_ACTION_REQUIRED")
      throw new PayPalLiveError("PAYPAL_PAYER_ACTION_REQUIRED");
    if (order.status === "VOIDED") throw new PayPalLiveError("PAYPAL_ORDER_VOIDED");
    if (order.status !== "APPROVED" && order.status !== "COMPLETED")
      throw new PayPalLiveError("PAYMENT_NOT_APPROVED");
    if (order.status === "APPROVED" && !hasNoOrderPayments(unit))
      throw new PayPalLiveError("PAYPAL_CAPTURE_PENDING");
    return { status: String(order.status), captureId: null };
  }
  const captures = record(unit.payments).captures;
  if (order.status !== "COMPLETED" || !Array.isArray(captures))
    throw new PayPalLiveError("PAYMENT_NOT_COMPLETED");
  const active = captures.map(record).filter((capture) => !isDeclinedCaptureStatus(capture.status));
  if (active.length !== 1) throw new PayPalLiveError("PAYMENT_NOT_COMPLETED");
  const capture = record(active[0]);
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
    if (order.purpose !== "quote" && order.amountMinor > 1000000)
      throw new PayPalLiveError("INVALID_AMOUNT");
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
    if (!response.ok) {
      const issue =
        response.status === 422 && method === "POST" && path.endsWith("/capture")
          ? await response
              .json()
              .then(captureIssue)
              .catch(() => undefined)
          : undefined;
      throw new PayPalLiveError(issue ?? "PAYPAL_REQUEST_FAILED", response.status);
    }
    return record(await response.json());
  }
  async function readOrder(order: LiveOrder, includePaymentSource = false) {
    const fields = includePaymentSource ? "?fields=payment_source" : "";
    const data = await request(`/v2/checkout/orders/${providerId(order.providerOrderId)}${fields}`);
    orderUnit(data, order);
    return data;
  }
  async function readDeclinedCapture(order: LiveOrder, id: string) {
    let capture: Json | null = null;
    try {
      capture = await request(`/v2/payments/captures/${providerId(id)}`);
    } catch (error) {
      if (!(error instanceof PayPalLiveError) || error.providerStatus !== 404) throw error;
    }
    // Read the order last so pending or successful activity always takes precedence.
    const data = await readOrder(order);
    const { unit } = orderUnit(data, order);
    if (!declineFitsOrder(data, unit)) return null;
    if (!capture) {
      const values = unit.payments === undefined ? undefined : record(unit.payments).captures;
      if (!Array.isArray(values)) return null;
      const exact = values.map(record).filter((entry) => entry.id === id);
      if (exact.length !== 1) return null;
      capture = exact[0] ?? null;
    } else {
      const related =
        capture.supplementary_data === undefined
          ? undefined
          : record(capture.supplementary_data).related_ids;
      const relatedOrder = related === undefined ? undefined : record(related).order_id;
      if (
        providerOrderReference(relatedOrder, capture.links, environment) !== order.providerOrderId
      )
        return null;
    }
    if (
      !capture ||
      capture.id !== id ||
      !isDeclinedCaptureStatus(capture.status) ||
      (capture.payee !== undefined && record(capture.payee).merchant_id !== order.merchantId) ||
      (capture.custom_id !== undefined && capture.custom_id !== order.id)
    )
      return null;
    const amount = record(capture.amount);
    if (amount.value !== liveAmount(order.amountMinor) || amount.currency_code !== order.currency)
      throw new PayPalLiveError("CAPTURE_MISMATCH");
    return {
      captureId: id,
      amountMinor: order.amountMinor,
      currency: order.currency,
      merchantId: order.merchantId,
      providerOrderId: providerId(order.providerOrderId),
    };
  }
  return {
    readDeclinedCapture,
    async create(order: LiveOrder, flow: PayPalOrderFlow = "redirect", actorRole?: string) {
      if (
        !["redirect", "sdk", "guest", "card-fields"].includes(flow) ||
        ((flow === "guest" || flow === "card-fields") && order.purpose === "support")
      )
        throw new PayPalLiveError("INVALID_CHECKOUT_FLOW");
      if (order.creditTopUp && config.creditTopUpBankOnly)
        throw new PayPalLiveError("CREDIT_TOP_UP_BANK_ONLY");
      if (
        order.creditTopUp &&
        !supportsCreditTopUpFlow(flow, creditCardTopUpsAvailable(config, environment, actorRole))
      )
        throw new PayPalLiveError("CREDIT_TOP_UP_PAYPAL_REQUIRED");
      canCharge(order);
      const returnUrl = `${origin.origin}/naplata/povratak?narudzba=${order.id}`;
      const cancelUrl = `${origin.origin}/naplata/odustajanje?narudzba=${order.id}`;
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
                  : order.creditTopUp
                    ? "AhiBizz: dopuna Ahi kredita"
                    : order.purpose === "quote"
                      ? "AhiBizz: ponuda za oglase ili kredite"
                      : "AhiBizz: dobrovoljna podrška razvoju",
              payee: { merchant_id: config.merchantId },
              amount: { currency_code: "EUR", value: liveAmount(order.amountMinor) },
            },
          ],
          ...(flow === "card-fields"
            ? {
                payment_source: {
                  card: {
                    attributes: { verification: { method: "SCA_WHEN_REQUIRED" } },
                    experience_context: { return_url: returnUrl, cancel_url: cancelUrl },
                  },
                },
              }
            : flow === "sdk"
              ? {
                  application_context: {
                    shipping_preference: "NO_SHIPPING",
                    user_action: "PAY_NOW",
                  },
                }
              : {
                  payment_source: {
                    paypal: {
                      experience_context: {
                        ...(order.creditTopUp
                          ? { landing_page: "LOGIN" }
                          : flow === "guest"
                            ? { landing_page: "GUEST_CHECKOUT" }
                            : {}),
                        brand_name: "AhiBizz",
                        locale: "en-BA",
                        shipping_preference: "NO_SHIPPING",
                        user_action: "PAY_NOW",
                        return_url: returnUrl,
                        cancel_url: cancelUrl,
                      },
                    },
                  },
                }),
        },
        order.createRequestId,
      );
      if (flow === "sdk" || flow === "card-fields") {
        if (
          !["CREATED", "SAVED", "APPROVED", "PAYER_ACTION_REQUIRED"].includes(String(data.status))
        )
          throw new PayPalLiveError("INVALID_ORDER_RESPONSE");
        orderUnit(data, { ...order, providerOrderId: providerId(data.id) });
        if (flow === "card-fields")
          return { providerOrderId: providerId(data.id), approvalUrl: null };
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
    async capture(order: LiveOrder, flow: PayPalOrderFlow = "redirect") {
      canCharge(order);
      let data = await readOrder(order, flow === "card-fields");
      const before = verifyLiveOrder(data, order, false);
      if (before.status !== "COMPLETED") {
        if (flow === "card-fields") verifyCardAuthentication(data);
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
      return (
        ["CREATED", "SAVED", "PAYER_ACTION_REQUIRED"].includes(String(data.status)) &&
        hasNoOrderPayments(unit)
      );
    },
    async isUnpaidForCancellation(order: LiveOrder) {
      const data = await readOrder(order);
      const { unit } = orderUnit(data, order);
      return (data.status === "CREATED" || data.status === "VOIDED") && hasNoOrderPayments(unit);
    },
    async inspect(order: LiveOrder) {
      const data = await readOrder(order);
      const { unit } = orderUnit(data, order);
      if (data.status !== "COMPLETED" && hasNoOrderPayments(unit)) {
        if (data.status === "APPROVED") return { status: "APPROVED" as const };
        if (data.status === "PAYER_ACTION_REQUIRED") return { status: "ACTION_REQUIRED" as const };
        if (data.status === "VOIDED") return { status: "VOIDED" as const };
        if (data.status === "CREATED" || data.status === "SAVED")
          return { status: "UNPAID" as const };
        return { status: "UNKNOWN" as const };
      }
      const captures = record(unit.payments).captures;
      if (!Array.isArray(captures) || captures.length === 0) {
        if (data.status !== "COMPLETED") return { status: "PENDING" as const };
        throw new PayPalLiveError("CAPTURE_MISMATCH");
      }
      const entries = captures.map(record);
      const active = entries.filter((entry) => !isDeclinedCaptureStatus(entry.status));
      const canCloseDecline = order.purpose === "promotion" || order.creditTopUpCard;
      if (canCloseDecline && active.length === 0) {
        const latest = entries.at(-1);
        const proof = latest && (await readDeclinedCapture(order, providerId(latest.id)));
        return proof ? { status: "DECLINED" as const, ...proof } : { status: "PENDING" as const };
      }
      if (active.length > 1 || (active.length === 0 && entries.length !== 1))
        throw new PayPalLiveError("CAPTURE_MISMATCH");
      const id = providerId((active[0] ?? entries[0])?.id);
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
      if (isDeclinedCaptureStatus(capture.status)) {
        if (canCloseDecline) {
          const proof = await readDeclinedCapture(order, id);
          return proof ? { status: "DECLINED" as const, ...proof } : { status: "PENDING" as const };
        }
        return { status: "REVERSED" as const, ...facts, refundedMinor: 0 };
      }
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
