export type PayPalOrderFlow = "redirect" | "sdk" | "guest" | "card-fields";

/** Unsuffixed offers are existing PayPal wallet orders. */
export function paypalOrderFlow(offerVersion: string): PayPalOrderFlow {
  if (offerVersion.endsWith(":card-fields")) return "card-fields";
  if (offerVersion.endsWith(":guest")) return "guest";
  if (offerVersion.endsWith(":sdk")) return "sdk";
  return "redirect";
}
