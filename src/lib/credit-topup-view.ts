import type { BankTopUpRequest, BankTopUpStatus, CreditBankCurrency } from "./bank-credit-topup";
import type { MarketingOrder } from "./marketing";

export const creditTopUpStatusLabels: Record<BankTopUpStatus, string> = {
  pending: "Na čekanju",
  approved: "Potvrđeno",
  cancelled: "Otkazano",
};

export type CreditTopUpHistory = {
  id: string;
  quantity: number;
  amountMinor: number | null;
  currency: CreditBankCurrency;
  status: BankTopUpStatus;
  date: string | null;
  paymentReference?: string;
};

export function creditTopUpView(requests: BankTopUpRequest[], orders: MarketingOrder[]) {
  // Both endpoints describe the same top-up. The bank request owns its presentation.
  const bankOrders = new Map<string, BankTopUpRequest>();
  for (const request of requests) {
    const previous = bankOrders.get(request.orderId);
    if (!previous || request.version > previous.version) bankOrders.set(request.orderId, request);
  }
  const bankRequests = [...bankOrders.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const visibleOrders = orders.filter((order) => !order.bankTopUp && !bankOrders.has(order.id));
  const history: CreditTopUpHistory[] = bankRequests
    .filter((request) => request.status !== "pending")
    .map((request) => ({
      id: request.id,
      quantity: request.quantity,
      amountMinor: request.amountMinor,
      currency: request.currency,
      status: request.status,
      date: request.approvedAt ?? request.createdAt,
      paymentReference: request.paymentReference,
    }));
  for (const order of visibleOrders) {
    if (order.kind !== "credits" || !["paid", "closed"].includes(order.status)) continue;
    history.push({
      id: order.id,
      quantity: order.quantity,
      amountMinor: order.paidAmountMinor ?? order.amountMinor,
      currency: order.paidCurrency ?? "BAM",
      status: order.status === "paid" ? "approved" : "cancelled",
      date: order.startsAt,
    });
  }
  return {
    pendingBank: bankRequests.find((request) => request.status === "pending"),
    history,
    orders: visibleOrders.filter(
      (order) => order.kind !== "credits" || !["paid", "closed"].includes(order.status),
    ),
  };
}
