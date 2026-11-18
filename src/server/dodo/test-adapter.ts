import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** Transport-only TEST prototype. No routes, authorization, fulfillment or PayPal rights.
 * Sources: docs.dodopayments.com/developer-resources/{checkout-session,webhooks}
 * API shapes: github.com/dodopayments/dodopayments-typescript/src/resources
 * Signature: github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md
 * No documented provider idempotency header assumed; ambiguous POSTs MUST NOT be retried.
 */
export type DodoTestConfig = {
  enabled: boolean;
  environment: "test_mode";
  apiKey: string;
  webhookSecret: string;
  productId: string;
  businessId: string;
  returnOrigin: string;
};
export type DodoTestOrder = {
  id: string;
  requestId: string;
  purpose: "promotion";
  amountMinor: 511;
  currency: "EUR";
};
export type DodoTestSession = { sessionId: string; checkoutUrl: string };
export interface DodoTestPersistence {
  /** Durable UNIQUE(namespace,key), immutable fingerprint, atomic reservation BEFORE callback.
   * Completed retry returns saved result. Pending/ambiguous crash MUST fail closed, never
   * repeat callback automatically. Persist result before returning. Auth is caller's job. */
  createOnce(
    namespace: string,
    key: string,
    fingerprint: string,
    sendOnce: () => Promise<DodoTestSession>,
  ): Promise<DodoTestSession>;
  /** Atomically persist an inbox event + raw body + hash. UNIQUE(namespace,eventId).
   * Duplicate same hash returns false; different hash must reject. Process persisted inbox
   * separately with transactional domain changes. This adapter never grants anything. */
  putVerifiedEvent(namespace: string, eventId: string, raw: string, hash: string): Promise<boolean>;
}
const base = "https://test.dodopayments.com";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function fail(code: string): never {
  throw new Error(code);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("DODO_INVALID_RESPONSE");
  return value as Record<string, unknown>;
}
function identifier(value: unknown, prefix: string): string {
  if (typeof value !== "string" || !new RegExp(`^${prefix}_[A-Za-z0-9_-]{1,100}$`).test(value))
    fail("DODO_INVALID_ID");
  return value;
}
export function dodoTestConfiguration(
  env: Record<string, string | undefined> = process.env,
): DodoTestConfig | null {
  if (env.DODO_TEST_ADAPTER_ENABLED !== "true" || env.DODO_ENVIRONMENT !== "test_mode") return null;
  const {
    DODO_TEST_API_KEY: apiKey,
    DODO_TEST_WEBHOOK_SECRET: webhookSecret,
    DODO_TEST_PRODUCT_ID: productId,
    DODO_TEST_BUSINESS_ID: businessId,
    DODO_TEST_RETURN_ORIGIN: returnOrigin,
  } = env;
  if (!apiKey || !webhookSecret || !productId || !businessId || !returnOrigin) return null;
  return {
    enabled: true,
    environment: "test_mode",
    apiKey,
    webhookSecret,
    productId,
    businessId,
    returnOrigin,
  };
}
export function createDodoTestAdapter(
  config: DodoTestConfig,
  persistence: DodoTestPersistence,
  transport: typeof fetch = fetch,
  now: () => number = Date.now,
) {
  if (typeof window !== "undefined") fail("DODO_SERVER_ONLY");
  const namespace = `dodo:test_mode:${config.businessId}`;
  function gate() {
    if (!config.enabled || config.environment !== "test_mode") fail("DODO_TEST_DISABLED");
    if (!persistence?.createOnce || !persistence?.putVerifiedEvent)
      fail("DODO_PERSISTENCE_REQUIRED");
    if (!config.apiKey || !config.businessId) fail("DODO_CONFIG_MISSING");
    identifier(config.productId, "pdt");
    const url = new URL(config.returnOrigin);
    if (url.origin !== config.returnOrigin || url.protocol !== "https:") fail("DODO_RETURN_ORIGIN");
  }
  function order(value: DodoTestOrder) {
    if (
      value.purpose !== "promotion" ||
      value.amountMinor !== 511 ||
      value.currency !== "EUR" ||
      !uuid.test(value.id) ||
      !uuid.test(value.requestId)
    )
      fail("DODO_INVALID_ORDER");
  }
  async function request(path: string, body?: unknown) {
    const response = await transport(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) fail("DODO_REQUEST_FAILED");
    return record(await response.json());
  }
  async function inspectPayment(value: DodoTestOrder, paymentId: string) {
    gate();
    order(value);
    identifier(paymentId, "pay");
    const payment = await request(`/payments/${paymentId}`),
      metadata = record(payment.metadata);
    const cart = Array.isArray(payment.product_cart) ? payment.product_cart : [];
    if (
      payment.payment_id !== paymentId ||
      payment.business_id !== config.businessId ||
      payment.currency !== "EUR" ||
      payment.total_amount !== 511 ||
      metadata.ahibizz_order_id !== value.id ||
      metadata.ahibizz_request_id !== value.requestId ||
      metadata.purpose !== "promotion" ||
      metadata.environment !== "test_mode" ||
      cart.length !== 1 ||
      record(cart[0]).product_id !== config.productId ||
      record(cart[0]).quantity !== 1 ||
      payment.subscription_id != null ||
      !Array.isArray(payment.subscription_ids) ||
      payment.subscription_ids.length !== 0 ||
      !Array.isArray(payment.refunds) ||
      !Array.isArray(payment.disputes)
    )
      fail("DODO_PAYMENT_NOT_VERIFIED");
    if (
      (payment.refunds as unknown[]).length ||
      payment.refund_status != null ||
      (payment.disputes as unknown[]).length
    )
      return { status: "review" as const, paymentId };
    if (payment.status !== "succeeded") return { status: "pending" as const, paymentId };
    return {
      merchantId: config.businessId,
      productId: config.productId,
      provider: "dodo" as const,
      environment: "test_mode" as const,
      orderId: value.id,
      paymentId,
      amountMinor: 511 as const,
      currency: "EUR" as const,
      status: "succeeded" as const,
    };
  }
  return {
    async createCheckout(value: DodoTestOrder) {
      gate();
      order(value);
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify({ value, productId: config.productId, returnOrigin: config.returnOrigin }),
        )
        .digest("hex");
      return persistence.createOnce(namespace, value.requestId, fingerprint, async () => {
        const product = await request(`/products/${config.productId}`),
          price = record(product.price);
        if (
          product.product_id !== config.productId ||
          product.business_id !== config.businessId ||
          product.is_recurring !== false ||
          product.pricing_mode != null ||
          price.type !== "one_time_price" ||
          price.currency !== "EUR" ||
          price.price !== 511 ||
          price.tax_inclusive !== true ||
          price.pay_what_you_want === true ||
          price.purchasing_power_parity === true ||
          (price.discount_bps ?? 0) !== 0 ||
          (price.discount ?? 0) !== 0
        )
          fail("DODO_PRODUCT_PRICE_MISMATCH");
        const session = await request("/checkouts", {
          product_cart: [{ product_id: config.productId, quantity: 1 }],
          billing_currency: "EUR",
          feature_flags: { allow_currency_selection: false, allow_discount_code: false },
          metadata: {
            ahibizz_order_id: value.id,
            ahibizz_request_id: value.requestId,
            purpose: "promotion",
            environment: "test_mode",
          },
          return_url: `${config.returnOrigin}/dodo-proba?narudzba=${value.id}`,
        });
        const sessionId = identifier(session.session_id, "cks");
        if (session.checkout_url !== `https://test.checkout.dodopayments.com/session/${sessionId}`)
          fail("DODO_INVALID_CHECKOUT_URL");
        return { sessionId, checkoutUrl: session.checkout_url as string };
      });
    },
    async verifyPayment(value: DodoTestOrder, paymentId: string) {
      const proof = await inspectPayment(value, paymentId);
      if (proof.status !== "succeeded") fail("DODO_PAYMENT_NOT_VERIFIED");
      return proof;
    },
    async reconcileSession(value: DodoTestOrder, sessionId: string) {
      gate();
      order(value);
      identifier(sessionId, "cks");
      const session = await request(`/checkouts/${sessionId}`);
      if (session.id !== sessionId) fail("DODO_SESSION_MISMATCH");
      if (session.payment_id == null) return { status: "pending" as const };
      const paymentId = identifier(session.payment_id, "pay");
      return { ...(await inspectPayment(value, paymentId)), sessionId };
    },
    async receiveWebhook(headers: Headers, raw: Uint8Array) {
      gate();
      if (raw.byteLength > 131072) fail("DODO_WEBHOOK_TOO_LARGE");
      const id = headers.get("webhook-id") ?? "",
        timestamp = headers.get("webhook-timestamp") ?? "",
        signatures = headers.get("webhook-signature") ?? "";
      if (
        !/^[A-Za-z0-9_-]{1,128}$/.test(id) ||
        !/^\d{10,12}$/.test(timestamp) ||
        Math.abs(Math.floor(now() / 1000) - Number(timestamp)) > 300 ||
        signatures.length > 4096
      )
        fail("DODO_WEBHOOK_INVALID");
      const encoded = config.webhookSecret.replace(/^whsec_/, "");
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) fail("DODO_WEBHOOK_SECRET");
      const key = Buffer.from(encoded, "base64");
      if (key.length < 24 || key.length > 64 || key.toString("base64") !== encoded)
        fail("DODO_WEBHOOK_SECRET");
      const expected = createHmac("sha256", key).update(`${id}.${timestamp}.`).update(raw).digest();
      const valid = signatures.split(" ").some((signature) => {
        const match = /^v1,([A-Za-z0-9+/]{43}=)$/.exec(signature);
        if (!match?.[1]) return false;
        const received = Buffer.from(match[1], "base64");
        return received.length === expected.length && timingSafeEqual(received, expected);
      });
      if (!valid) fail("DODO_WEBHOOK_SIGNATURE");
      let text: string, event: Record<string, unknown>;
      try {
        text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw);
        event = record(JSON.parse(text));
      } catch {
        fail("DODO_WEBHOOK_INVALID");
      }
      if (event.business_id !== config.businessId || typeof event.type !== "string")
        fail("DODO_WEBHOOK_IDENTITY");
      const inserted = await persistence.putVerifiedEvent(
        namespace,
        id,
        text,
        createHash("sha256").update(raw).digest("hex"),
      );
      return { eventId: id, duplicate: !inserted };
    },
  };
}
