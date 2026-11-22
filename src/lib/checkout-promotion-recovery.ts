import type { CardOrder } from "./paypal-card-flow";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Send = (path: string, body?: unknown) => Promise<unknown>;

function responseOrder(value: unknown): unknown {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Object.hasOwn(value, "order") ||
    Object.keys(value).some((key) => key !== "order")
  )
    throw new Error("Odgovor narudžbe nije potvrđen. Osvježi njen status.");
  return (value as { order: unknown }).order;
}

function promotion(value: unknown): value is CardOrder {
  if (!value || typeof value !== "object") return false;
  const order = value as CardOrder;
  return (
    typeof order.id === "string" &&
    uuid.test(order.id) &&
    typeof order.requestId === "string" &&
    uuid.test(order.requestId) &&
    order.kind === "promotion" &&
    typeof order.businessId === "string" &&
    uuid.test(order.businessId) &&
    (order.businessTitle === null || typeof order.businessTitle === "string") &&
    Number.isSafeInteger(order.amountMinor) &&
    order.amountMinor > 0 &&
    order.currency === "EUR" &&
    ["sandbox", "live"].includes(order.environment) &&
    (order.flow === undefined ||
      ["redirect", "sdk", "guest", "card-fields"].includes(order.flow)) &&
    order.refundedMinor === 0 &&
    order.endsAt === null
  );
}

export function canCancelPromotionOrder(order: CardOrder | null): boolean {
  return promotion(order) && order.status === "provider_created";
}

/** No retries: an uncertain cancellation must be reconciled before another attempt. */
export async function cancelPromotionOrder(order: CardOrder, send: Send): Promise<CardOrder> {
  if (!canCancelPromotionOrder(order))
    throw new Error("Ova narudžba nije dostupna za odustajanje.");
  const result = await send(`orders/${encodeURIComponent(order.id)}/cancel`, {});
  const next = responseOrder(result);
  if (
    !promotion(next) ||
    next.status !== "cancelled" ||
    next.id !== order.id ||
    next.requestId !== order.requestId ||
    next.businessId !== order.businessId ||
    next.amountMinor !== order.amountMinor ||
    next.environment !== order.environment ||
    next.flow !== order.flow
  )
    throw new Error("Odustajanje nije potvrđeno. Osvježi status sačuvane narudžbe.");
  return next;
}

/** Lookup is owner-bound on the server and never guesses an order identifier. */
export async function findPendingPromotion(
  businessId: string,
  send: Send,
): Promise<CardOrder | null> {
  if (!uuid.test(businessId)) throw new Error("Odabrana djelatnost nije ispravna.");
  const result = await send(`pending-promotion/${encodeURIComponent(businessId)}`);
  const order = responseOrder(result);
  if (order === null) return null;
  if (
    !promotion(order) ||
    !["created", "provider_created"].includes(order.status) ||
    order.businessId !== businessId
  )
    throw new Error("Otvorenu narudžbu nije moguće potvrditi. Provjeri Moj nalog.");
  return order;
}

/** A full navigation drops the old order URL, component state and idempotency key. */
export function promotionRestartHref(order: CardOrder | null): string | null {
  return promotion(order) && order.status === "cancelled"
    ? `/naplata?djelatnost=${encodeURIComponent(order.businessId ?? "")}`
    : null;
}
