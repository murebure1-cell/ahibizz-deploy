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

function recoverableOrder(
  value: unknown,
  bankOnlyTopUp = false,
  platformCreditsOnly = false,
): value is CardOrder {
  if (!value || typeof value !== "object") return false;
  const order = value as CardOrder;
  return (
    typeof order.id === "string" &&
    uuid.test(order.id) &&
    typeof order.requestId === "string" &&
    uuid.test(order.requestId) &&
    ((order.kind === "promotion" &&
      typeof order.businessId === "string" &&
      uuid.test(order.businessId)) ||
      (order.kind === "quote" &&
        typeof order.quoteId === "string" &&
        uuid.test(order.quoteId) &&
        (platformCreditsOnly ||
          (order.quoteKind === "credits" &&
            (order.flow === "sdk" || (bankOnlyTopUp && order.flow === "redirect")) &&
            order.businessId === null)))) &&
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

export function canCancelPromotionOrder(
  order: CardOrder | null,
  bankOnlyTopUp = false,
  platformCreditsOnly = false,
): boolean {
  return (
    recoverableOrder(order, bankOnlyTopUp, platformCreditsOnly) &&
    order.status === "provider_created"
  );
}

/** No retries: an uncertain cancellation must be reconciled before another attempt. */
export async function cancelPromotionOrder(
  order: CardOrder,
  send: Send,
  bankOnlyTopUp = false,
  platformCreditsOnly = false,
): Promise<CardOrder> {
  if (!canCancelPromotionOrder(order, bankOnlyTopUp, platformCreditsOnly))
    throw new Error("Ova narudžba nije dostupna za odustajanje.");
  const result = await send(`orders/${encodeURIComponent(order.id)}/cancel`, {});
  const next = responseOrder(result);
  if (
    !recoverableOrder(next, bankOnlyTopUp, platformCreditsOnly) ||
    next.status !== "cancelled" ||
    next.id !== order.id ||
    next.requestId !== order.requestId ||
    next.kind !== order.kind ||
    next.quoteId !== order.quoteId ||
    next.quoteKind !== order.quoteKind ||
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
    !recoverableOrder(order) ||
    order.kind !== "promotion" ||
    !["created", "provider_created"].includes(order.status) ||
    order.businessId !== businessId
  )
    throw new Error("Otvorenu narudžbu nije moguće potvrditi. Provjeri Moj nalog.");
  return order;
}

/** A full navigation drops the old order URL, component state and idempotency key. */
export function promotionRestartHref(order: CardOrder | null): string | null {
  if (!recoverableOrder(order) || order.status !== "cancelled") return null;
  return order.kind === "quote"
    ? `/naplata?ponuda=${encodeURIComponent(order.quoteId ?? "")}&nacin=kartica`
    : `/naplata?djelatnost=${encodeURIComponent(order.businessId ?? "")}`;
}
