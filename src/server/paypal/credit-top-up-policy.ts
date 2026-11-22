import { readPlatformCreditsOnly } from "../wallet/platform-policy";

export type CreditCardTopUpPolicy = {
  creditCardTopUps?: boolean;
  creditCardTopUpsPilotOwner?: boolean;
  creditTopUpBankOnly?: boolean;
  platformCreditsOnly?: boolean;
};

export function readCreditTopUpBankOnly(env: Record<string, string | undefined> = process.env) {
  return readPlatformCreditsOnly(env) || env.AHIBIZZ_CREDIT_TOP_UP_BANK_ONLY === "true";
}

export function creditCardTopUpsAvailable(
  policy: CreditCardTopUpPolicy,
  environment: "live" | "sandbox",
  role?: string,
): boolean {
  return (
    policy.platformCreditsOnly !== true &&
    policy.creditTopUpBankOnly !== true &&
    (policy.creditCardTopUps === true ||
      (environment === "live" && policy.creditCardTopUpsPilotOwner === true && role === "owner"))
  );
}
