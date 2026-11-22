import type { LiveOrder } from "./live";

export type CheckoutActor = {
  userId: string;
  id: string;
  token: string;
  expectedAccountId?: string | null;
};
export type CheckoutRecord = {
  id: string;
  userId: string;
  kind: "promotion" | "support" | "quote";
  businessId: string | null;
  amountMinor: number;
  currency: "EUR";
  merchantId: string;
  environment: "sandbox" | "live";
  providerOrderId: string | null;
  approvalUrl: string | null;
  captureId: string | null;
  createRequestId: string;
  captureRequestId: string;
  status: string;
  refundedMinor: number;
  startsAt?: string | null;
  endsAt?: string | null;
};
export type CaptureProof = {
  providerOrderId: string;
  captureId: string;
  merchantId: string;
  amountMinor: number;
  currency: "EUR";
  completedAt: string;
};
export type CheckoutPolicy = {
  origin: string;
  environment: "sandbox" | "live";
  merchantId: string;
  enabled: boolean;
  priceApproved: boolean;
  fulfillmentReady: boolean;
};
export class CheckoutHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
type CheckoutCreateInput = {
  requestId: string;
  kind: "promotion" | "support" | "quote";
  businessId?: string;
  quoteId?: string;
  amountMinor?: number;
  flow?: "sdk" | "guest" | "card-fields";
};
export interface CheckoutHttpService {
  catalog(): unknown;
  reconcileBatch(
    headers: Headers,
    cursors?: { ordersAfter?: string | null; refundsAfter?: string | null },
  ): Promise<unknown>;
  read(headers: Headers, id: string): Promise<unknown>;
  readPendingPromotion(headers: Headers, businessId: string): Promise<unknown>;
  resumeCard(headers: Headers, id: string): Promise<unknown>;
  create(headers: Headers, value: CheckoutCreateInput): Promise<unknown>;
  cancel(headers: Headers, id: string): Promise<unknown>;
  capture(headers: Headers, id: string): Promise<unknown>;
  reconcile(headers: Headers, id: string): Promise<unknown>;
  refund(
    headers: Headers,
    id: string,
    value: { requestId: string; amountMinor: number; reason: string },
  ): Promise<unknown>;
  webhook(headers: Headers, value: unknown, rawJson?: string): Promise<unknown>;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function fail(status: number, code: string): never {
  throw new CheckoutHttpError(status, code);
}
function object(value: unknown, keys: string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    fail(400, "INVALID_CHECKOUT_INPUT");
  return value as Record<string, unknown>;
}
function requestId(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value)) fail(400, "INVALID_REQUEST_ID");
  return value;
}
function amount(value: unknown, minimum = 100, maximum = 100000): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  )
    fail(400, "INVALID_AMOUNT");
  return value;
}
export function checkoutInput(value: unknown): CheckoutCreateInput {
  const input = object(value, [
    "requestId",
    "kind",
    "businessId",
    "quoteId",
    "amountMinor",
    "flow",
  ]);
  const flow = input.flow;
  if (flow !== undefined && flow !== "sdk" && flow !== "guest" && flow !== "card-fields")
    fail(400, "INVALID_CHECKOUT_FLOW");
  if (input.kind === "quote") {
    if (
      input.businessId !== undefined ||
      input.amountMinor !== undefined ||
      typeof input.quoteId !== "string" ||
      !uuid.test(input.quoteId)
    )
      fail(400, "INVALID_QUOTE");
    return {
      requestId: requestId(input.requestId),
      kind: "quote",
      quoteId: input.quoteId,
      ...(flow ? { flow } : {}),
    };
  }
  if (input.quoteId !== undefined) fail(400, "INVALID_QUOTE");
  if ((flow === "guest" || flow === "card-fields") && input.kind !== "promotion")
    fail(400, "INVALID_CHECKOUT_FLOW");
  if (input.kind === "promotion") {
    if (
      input.amountMinor !== undefined ||
      typeof input.businessId !== "string" ||
      !uuid.test(input.businessId)
    )
      fail(400, "INVALID_PROMOTION");
    return {
      ...(flow ? { flow } : {}),
      requestId: requestId(input.requestId),
      kind: "promotion" as const,
      businessId: input.businessId,
    };
  }
  if (input.kind === "support" && input.businessId === undefined)
    return {
      ...(input.flow === "sdk" ? { flow: "sdk" as const } : {}),
      requestId: requestId(input.requestId),
      kind: "support" as const,
      amountMinor: amount(input.amountMinor),
    };
  return fail(400, "INVALID_PURPOSE");
}
async function body(request: Request, max: number) {
  const reader = request.body?.getReader();
  if (!reader) fail(400, "INVALID_CHECKOUT_INPUT");
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > max) {
        await reader.cancel();
        fail(413, "REQUEST_TOO_LARGE");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    const rawJson = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);
    return { input: JSON.parse(rawJson) as unknown, rawJson };
  } catch {
    return fail(400, "INVALID_CHECKOUT_INPUT");
  }
}
function reply(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}
export function createCheckoutHttpHandler(service: CheckoutHttpService, origin: string) {
  return async (request: Request) => {
    try {
      const url = new URL(request.url);
      if (request.url.length > 2048 || [...url.searchParams].length)
        fail(400, "INVALID_CHECKOUT_INPUT");
      const path = url.pathname.slice("/api/checkout/".length);
      if (!url.pathname.startsWith("/api/checkout/")) return reply({ code: "NOT_FOUND" }, 404);
      if (request.method === "GET" && path === "catalog") return reply(service.catalog());
      const pending = /^pending-promotion\/([a-f0-9-]{36})$/.exec(path);
      if (request.method === "GET" && pending)
        return reply(await service.readPendingPromotion(request.headers, requestId(pending[1])));
      const match =
        /^orders\/([a-f0-9-]{36})(?:\/(card-session|cancel|capture|reconcile|refund))?$/.exec(path);
      if (match && !uuid.test(match[1] ?? "")) fail(400, "INVALID_CHECKOUT_INPUT");
      if (request.method === "GET" && match && !match[2])
        return reply({ order: await service.read(request.headers, match[1] ?? "") });
      if (
        request.method !== "POST" ||
        !(path === "orders" || path === "webhook" || path === "admin/reconcile" || match?.[2])
      )
        return reply({ code: "NOT_FOUND" }, 404);
      if (path !== "webhook" && request.headers.get("origin") !== origin)
        fail(403, "INVALID_ORIGIN");
      if (
        request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
        "application/json"
      )
        fail(415, "INVALID_CONTENT_TYPE");
      const { input, rawJson } = await body(request, path === "webhook" ? 131072 : 2048);
      if (path === "webhook") return reply(await service.webhook(request.headers, input, rawJson));
      if (path === "admin/reconcile") {
        const value = object(input, ["ordersAfter", "refundsAfter"]);
        const cursors: { ordersAfter?: string | null; refundsAfter?: string | null } = {};
        for (const key of ["ordersAfter", "refundsAfter"] as const) {
          if (value[key] === null) cursors[key] = null;
          else if (value[key] !== undefined) cursors[key] = requestId(value[key]);
        }
        return reply(await service.reconcileBatch(request.headers, cursors));
      }
      if (path === "orders")
        return reply(await service.create(request.headers, checkoutInput(input)), 201);
      const id = match?.[1] ?? "",
        action = match?.[2];
      if (action === "refund") {
        const value = object(input, ["requestId", "amountMinor", "reason"]);
        if (
          typeof value.reason !== "string" ||
          value.reason.trim().length < 3 ||
          value.reason.length > 500 ||
          /\p{Cc}/u.test(value.reason)
        )
          fail(400, "INVALID_REFUND_REASON");
        return reply(
          await service.refund(request.headers, id, {
            requestId: requestId(value.requestId),
            amountMinor: amount(value.amountMinor, 1, 51129188),
            reason: value.reason.trim(),
          }),
        );
      }
      object(input, []);
      if (action === "card-session") return reply(await service.resumeCard(request.headers, id));
      if (action === "cancel") return reply(await service.cancel(request.headers, id));
      return reply(
        action === "capture"
          ? await service.capture(request.headers, id)
          : await service.reconcile(request.headers, id),
      );
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "status" in error &&
        "code" in error &&
        typeof error.status === "number" &&
        typeof error.code === "string" &&
        /^[A-Z_]+$/.test(error.code)
      )
        return reply({ code: error.code }, error.status);
      return reply({ code: "CHECKOUT_UNAVAILABLE" }, 503);
    }
  };
}
export function providerOrder(order: CheckoutRecord): LiveOrder {
  return {
    id: order.id,
    purpose: order.kind,
    amountMinor: order.amountMinor,
    currency: "EUR",
    merchantId: order.merchantId,
    ...(order.providerOrderId ? { providerOrderId: order.providerOrderId } : {}),
    createRequestId: order.createRequestId,
    captureRequestId: order.captureRequestId,
  };
}
export { body as readCheckoutJsonBody };
