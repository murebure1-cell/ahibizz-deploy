import { randomUUID } from "node:crypto";

const base = "https://api-m.sandbox.paypal.com";
export type SandboxPurpose = "promotion" | "support";
export const sandboxQuote = (purpose: SandboxPurpose) => ({
  currency: "EUR" as const,
  value: purpose === "promotion" ? "5.11" : "1.00",
  description:
    purpose === "promotion"
      ? "TEST: AhiBizz category promotion, 7 days"
      : "TEST: AhiBizz voluntary support",
});
export class SandboxError extends Error {}

type Json = Record<string, unknown>;
function object(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SandboxError("INVALID_PROVIDER_RESPONSE");
  return value as Json;
}
export function sandboxApprovalUrl(value: unknown): string {
  if (typeof value !== "string") throw new SandboxError("INVALID_APPROVAL_URL");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.sandbox.paypal.com" ||
    url.port ||
    url.username ||
    url.password
  )
    throw new SandboxError("INVALID_APPROVAL_URL");
  return url.href;
}
export function verifySandboxCapture(
  value: unknown,
  orderId: string,
  purpose: SandboxPurpose,
  merchantId: string,
) {
  const order = object(value);
  if (
    order.id !== orderId ||
    order.status !== "COMPLETED" ||
    !Array.isArray(order.purchase_units) ||
    order.purchase_units.length !== 1
  )
    throw new SandboxError("PAYMENT_NOT_COMPLETED");
  const unit = object(order.purchase_units[0]);
  if (object(unit.payee).merchant_id !== merchantId) throw new SandboxError("PAYEE_MISMATCH");
  const captures = object(unit.payments).captures;
  if (!Array.isArray(captures) || captures.length !== 1) throw new SandboxError("INVALID_CAPTURE");
  const capture = object(captures[0]);
  const amount = object(capture.amount);
  const quote = sandboxQuote(purpose);
  if (
    capture.status !== "COMPLETED" ||
    amount.currency_code !== quote.currency ||
    amount.value !== quote.value ||
    typeof capture.id !== "string"
  )
    throw new SandboxError("CAPTURE_MISMATCH");
  return { id: capture.id, status: "COMPLETED" as const, ...quote, sandbox: true as const };
}

export function createSandboxPayPal(
  config: { clientId: string; secret: string; merchantId: string },
  transport: typeof fetch = fetch,
) {
  async function request(path: string, method = "GET", body?: unknown, requestId?: string) {
    const tokenResponse = await transport(`${base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.secret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!tokenResponse.ok) throw new SandboxError("SANDBOX_AUTH_FAILED");
    const token = object(await tokenResponse.json()).access_token;
    if (typeof token !== "string") throw new SandboxError("SANDBOX_AUTH_FAILED");
    const response = await transport(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new SandboxError("SANDBOX_REQUEST_FAILED");
    return object(await response.json());
  }
  return {
    async create(purpose: SandboxPurpose, requestId: string) {
      const quote = sandboxQuote(purpose);
      const order = await request(
        "/v2/checkout/orders",
        "POST",
        {
          intent: "CAPTURE",
          purchase_units: [
            {
              reference_id: purpose,
              description: quote.description,
              amount: { currency_code: quote.currency, value: quote.value },
              payee: { merchant_id: config.merchantId },
            },
          ],
          payment_source: {
            paypal: {
              experience_context: {
                shipping_preference: "NO_SHIPPING",
                user_action: "PAY_NOW",
                return_url: "http://127.0.0.1:3012/probna-naplata?paypal=return",
                cancel_url: "http://127.0.0.1:3012/probna-naplata?paypal=cancel",
              },
            },
          },
        },
        requestId,
      );
      if (
        typeof order.id !== "string" ||
        !/^[A-Z0-9]{10,32}$/.test(order.id) ||
        !Array.isArray(order.links)
      )
        throw new SandboxError("INVALID_ORDER");
      const link = order.links
        .map(object)
        .find((link) => link.rel === "payer-action" || link.rel === "approve");
      return { id: order.id, approvalUrl: sandboxApprovalUrl(link?.href) };
    },
    async capture(orderId: string, purpose: SandboxPurpose, requestId: string) {
      if (!/^[A-Z0-9]{10,32}$/.test(orderId)) throw new SandboxError("INVALID_ORDER");
      let order = await request(`/v2/checkout/orders/${orderId}`);
      if (order.status !== "COMPLETED") {
        if (order.status !== "APPROVED") throw new SandboxError("PAYMENT_NOT_APPROVED");
        await request(`/v2/checkout/orders/${orderId}/capture`, "POST", {}, requestId);
        order = await request(`/v2/checkout/orders/${orderId}`);
      }
      return verifySandboxCapture(order, orderId, purpose, config.merchantId);
    },
  };
}
export type SandboxSession = {
  expires: number;
  purpose: SandboxPurpose;
  createKey: string;
  captureKey: string;
  order?: { id: string; approvalUrl: string };
  busy?: boolean;
  result?: ReturnType<typeof verifySandboxCapture>;
};
export function newSandboxSession(purpose: SandboxPurpose): SandboxSession {
  return {
    expires: Date.now() + 30 * 60_000,
    purpose,
    createKey: randomUUID(),
    captureKey: randomUUID(),
  };
}
