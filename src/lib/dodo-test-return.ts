/** Return only the internal order reference; provider status, email and payment IDs are not proof. */
export function dodoTestReturnPath(orderId?: string): string {
  return typeof orderId === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(orderId)
    ? `/dodo-proba?narudzba=${orderId}`
    : "/dodo-proba";
}
