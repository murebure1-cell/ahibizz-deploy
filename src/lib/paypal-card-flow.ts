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
        order.flow === "sdk" &&
        ["created", "provider_created"].includes(order.status)
    : reviewed && kind === "promotion";
}
export function createPayPalCardFlow(options: {
  send: (
    path: string,
    body: unknown,
    signal: AbortSignal,
  ) => Promise<{ order?: CardOrder; providerOrderId?: string; pending?: boolean }>;
  input: () => { requestId: string; businessId: string };
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
          const result = await options.send(
            "orders",
            { requestId, businessId, kind: "promotion", flow: "sdk" },
            controller.signal,
          );
          alive();
          if (generation !== revision)
            throw new Error("Kartični pokušaj je zatvoren. Provjeri sačuvanu narudžbu.");
          // Persist a server-returned order before interpreting provider readiness.
          if (result.order) options.onOrder(result.order);
          if (
            result.order?.flow !== "sdk" ||
            result.order.kind !== "promotion" ||
            result.order.businessId !== businessId ||
            result.order.amountMinor !== 511 ||
            result.order.currency !== "EUR" ||
            !["created", "provider_created"].includes(result.order.status) ||
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
      try {
        const result = await options.send(
          `orders/${current.order.id}/capture`,
          {},
          controller.signal,
        );
        alive();
        if (!result.order || result.order.id !== current.order.id)
          throw new Error("Odgovor nije potvrđen. Osvježi status sačuvane narudžbe.");
        options.onOrder(result.order);
        if (result.pending || result.order.status !== "captured")
          throw new Error(
            "Uplata još nije potvrđena. Osvježi status sačuvane narudžbe; ne plaćaj ponovo.",
          );
      } finally {
        release();
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
