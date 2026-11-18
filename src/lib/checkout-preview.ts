export const promotionTrialOffer = Object.freeze({
  id: "category-seven-days-v1",
  title: "Isticanje profila u kategoriji",
  days: 7,
  amountMinor: 1000,
  currency: "BAM",
  mode: "preview",
  paymentEnabled: false,
} as const);

export type CheckoutPreviewState = "offer" | "review" | "blocked";
export type CheckoutPreviewAction = "review" | "continue" | "back" | "cancel";
export function checkoutPreviewTransition(
  state: CheckoutPreviewState,
  action: CheckoutPreviewAction,
): CheckoutPreviewState {
  if (action === "cancel" || action === "back") return "offer";
  if (action === "review" && state === "offer") return "review";
  if (action === "continue" && state === "review") return "blocked";
  return state;
}
