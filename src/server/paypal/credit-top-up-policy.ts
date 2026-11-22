export type CreditCardTopUpPolicy = {
  creditCardTopUps?: boolean;
  creditCardTopUpsPilotOwner?: boolean;
};

export function creditCardTopUpsAvailable(
  policy: CreditCardTopUpPolicy,
  environment: "live" | "sandbox",
  role?: string,
): boolean {
  return (
    policy.creditCardTopUps === true ||
    (environment === "live" && policy.creditCardTopUpsPilotOwner === true && role === "owner")
  );
}
