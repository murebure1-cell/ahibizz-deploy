import type { PayPalOrderFlow } from "./paypal-order-flow";

/** Browser controller only. Orders, price, approval and fulfillment stay server-authoritative. */
export type CardOrder = {
  id: string;
  requestId: string;
  kind: "promotion" | "support";
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
    ? order.kind === "promotion" &&
        ((order.flow === "sdk" && ["created", "provider_created"].includes(order.status)) ||
          (order.flow === "guest" && order.status === "provider_created"))
    : reviewed && kind === "promotion";
}
export function createPayPalCardFlow(options: {
  send: (
    path: string,
    body: unknown,
    signal: AbortSignal,
  ) => Promise<{ order?: CardOrder; providerOrderId?: string; pending?: boolean }>;
  input: () => { requestId: string; businessId: string };
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
    create(): Promise<string> {
      alive();
      if (!acquired) return Promise.reject(new Error("Prvo odaberi kartično plaćanje."));
      if (creating) return creating;
      const generation = revision;
      creating = (async () => {
        try {
          const { requestId, businessId } = options.input();
          const saved = options.savedOrder?.();
          if (
            saved &&
            (!canOfferPayPalCard(saved, false, "promotion") ||
              saved.businessId !== businessId ||
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
                  { requestId, businessId, kind: "promotion", flow: "sdk" },
                  controller.signal,
                );
          alive();
          if (generation !== revision)
            throw new Error("Kartični pokušaj je zatvoren. Provjeri sačuvanu narudžbu.");
          // Persist a server-returned order before interpreting provider readiness.
          if (
            saved &&
            (result.order?.id !== saved.id ||
              result.order.requestId !== saved.requestId ||
              result.order.environment !== saved.environment ||
              result.order.businessId !== saved.businessId ||
              result.order.kind !== saved.kind ||
              result.order.amountMinor !== saved.amountMinor ||
              result.order.currency !== saved.currency ||
              result.order.flow !== saved.flow)
          )
            throw new Error("Odgovor ne odgovara sačuvanoj narudžbi. Osvježi njen status.");
          if (result.order) options.onOrder(result.order);
          if (
            result.order?.flow !== (saved?.flow ?? "sdk") ||
            result.order.kind !== "promotion" ||
            result.order.businessId !== businessId ||
            result.order.amountMinor !== 511 ||
            result.order.currency !== "EUR" ||
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
        if (generation !== revision || !result.order || result.order.id !== expected.id)
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
