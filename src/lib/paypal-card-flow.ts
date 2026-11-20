import type { PayPalOrderFlow } from "./paypal-order-flow";

export const checkoutEuro = (minor: number) => `${(minor / 100).toFixed(2).replace(".", ",")} EUR`;

/** Browser controller only. Orders, price, approval and fulfillment stay server-authoritative. */
export type CardOrder = {
  id: string;
  requestId: string;
  kind: "promotion" | "support" | "quote";
  quoteId?: string | null;
  businessId: string | null;
  businessTitle: string | null;
  amountMinor: number;
  currency: "EUR";
  environment: "sandbox" | "live";
  status: string;
  refundedMinor: number;
  endsAt: string | null;
  flow?: PayPalOrderFlow;
};
export function canOfferPayPalCard(
  order: CardOrder | null,
  reviewed: boolean,
  kind: string,
): boolean {
  return order
    ? (order.kind === "promotion" || (order.kind === "quote" && Boolean(order.quoteId))) &&
        (((order.flow === "sdk" || order.flow === "card-fields") &&
          ["created", "provider_created"].includes(order.status)) ||
          (order.flow === "guest" && order.status === "provider_created"))
    : reviewed && (kind === "promotion" || kind === "quote");
}
export type CardPurchaseInput =
  | { requestId: string; businessId: string }
  | { requestId: string; quoteId: string; amountMinor: number };

function sameOrder(received: CardOrder, expected: CardOrder) {
  return (
    received.id === expected.id &&
    received.requestId === expected.requestId &&
    received.environment === expected.environment &&
    received.businessId === expected.businessId &&
    received.kind === expected.kind &&
    (received.quoteId ?? null) === (expected.quoteId ?? null) &&
    received.amountMinor === expected.amountMinor &&
    received.currency === expected.currency &&
    received.flow === expected.flow
  );
}

export function createPayPalCardFlow(options: {
  send: (
    path: string,
    body: unknown,
    signal: AbortSignal,
  ) => Promise<{ order?: CardOrder; providerOrderId?: string; pending?: boolean }>;
  input: () => CardPurchaseInput;
  savedOrder?: () => CardOrder | undefined;
  onOrder: (order: CardOrder) => void;
  acquire: () => boolean;
  release: () => void;
}) {
  const controller = new AbortController();
  let creating: Promise<string> | null = null;
  let approved = false;
  let current: { order: CardOrder; providerOrderId: string } | null = null;
  let acquired = false;
  let revision = 0;
  const alive = () => controller.signal.throwIfAborted();
  const release = () => {
    if (acquired) {
      acquired = false;
      options.release();
    }
  };
  return {
    click() {
      alive();
      if (acquired || !options.acquire()) return false;
      acquired = true;
      revision++;
      approved = false;
      creating = null;
      current = null;
      return true;
    },
    create(method: "sdk" | "card-fields" = "sdk"): Promise<string> {
      alive();
      if (!acquired) return Promise.reject(new Error("Prvo odaberi kartično plaćanje."));
      if (creating) return creating;
      const generation = revision;
      creating = (async () => {
        try {
          const input = options.input();
          const { requestId } = input;
          const purchase =
            "quoteId" in input
              ? { kind: "quote" as const, quoteId: input.quoteId }
              : { kind: "promotion" as const, businessId: input.businessId };
          const matchesPurchase = (order: CardOrder) =>
            order.kind === purchase.kind &&
            ("quoteId" in input
              ? order.quoteId === input.quoteId
              : order.businessId === input.businessId);
          const amount = "quoteId" in input ? input.amountMinor : 511;
          const saved = options.savedOrder?.();
          if (
            saved &&
            (!canOfferPayPalCard(saved, false, "promotion") ||
              (saved.flow === "card-fields") !== (method === "card-fields") ||
              !matchesPurchase(saved) ||
              saved.amountMinor !== amount ||
              saved.requestId !== requestId)
          )
            throw new Error("Sačuvana narudžba više nije dostupna za kartično plaćanje.");
          const result =
            saved?.flow === "guest"
              ? await options.send(
                  `orders/${encodeURIComponent(saved.id)}/card-session`,
                  {},
                  controller.signal,
                )
              : await options.send(
                  "orders",
                  { requestId, ...purchase, flow: method },
                  controller.signal,
                );
          alive();
          if (generation !== revision)
            throw new Error("Kartični pokušaj je zatvoren. Provjeri sačuvanu narudžbu.");
          // Persist a server-returned order before interpreting provider readiness.
          if (saved && (!result.order || !sameOrder(result.order, saved)))
            throw new Error("Odgovor ne odgovara sačuvanoj narudžbi. Osvježi njen status.");
          if (
            !result.order ||
            !matchesPurchase(result.order) ||
            result.order.amountMinor !== amount ||
            result.order.currency !== "EUR"
          )
            throw new Error("Odgovor ne odgovara odabranom plaćanju.");
          options.onOrder(result.order);
          if (
            result.order.flow !== (saved?.flow ?? method) ||
            !canOfferPayPalCard(result.order, false, "promotion") ||
            !result.providerOrderId ||
            !/^[A-Z0-9]{10,32}$/.test(result.providerOrderId)
          )
            throw new Error(
              "Kartična narudžba još nije spremna. Provjeri sačuvanu narudžbu prije novog pokušaja.",
            );
          current = { order: result.order, providerOrderId: result.providerOrderId };
          return result.providerOrderId;
        } catch (error) {
          if (generation === revision) release();
          throw error;
        }
      })();
      return creating;
    },
    async approve(providerOrderId: string) {
      alive();
      if (approved) return;
      if (!acquired || !current || current.providerOrderId !== providerOrderId)
        throw new Error(
          "Odobrenje ne odgovara ovoj narudžbi ili je već obrađeno. Osvježi status uplate.",
        );
      approved = true;
      const generation = revision;
      const expected = current.order;
      try {
        const result = await options.send(
          `orders/${encodeURIComponent(expected.id)}/capture`,
          {},
          controller.signal,
        );
        alive();
        if (generation !== revision || !result.order || !sameOrder(result.order, expected))
          throw new Error("Odgovor nije potvrđen. Osvježi status sačuvane narudžbe.");
        options.onOrder(result.order);
        if (result.pending || result.order.status !== "captured")
          throw new Error(
            "Uplata još nije potvrđena. Osvježi status sačuvane narudžbe; ne plaćaj ponovo.",
          );
      } finally {
        if (generation === revision) release();
      }
    },
    cancel() {
      revision++;
      current = null;
      creating = null;
      release();
    },
    dispose() {
      revision++;
      controller.abort();
      current = null;
      release();
    },
  };
}
