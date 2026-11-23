import type { PromotionBank } from "../../lib/promotions";
import { readSupportConfig } from "../../lib/support";
import type { Environment } from "../env";

export function readPromotionBank(env: Environment = process.env): PromotionBank | null {
  const raw = env.AHIBIZZ_BANK_TRANSFER?.trim() || env.AHIBIZZ_CREDIT_BANK_TRANSFER;
  if (!raw || raw.length > 8192) return null;
  try {
    const input = JSON.parse(raw);
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      input.enabled !== true ||
      input.commercialConfirmed !== true ||
      !input.bank ||
      !["BAM", "EUR"].includes(input.bank.currency)
    )
      return null;
    const config = readSupportConfig({
      enabled: true,
      recipient: input.recipient,
      bankAccounts: [input.bank],
    });
    const bank = config?.bankAccounts[0];
    if (!bank || !config) return null;
    return {
      recipient: config.recipient,
      name: bank.name,
      currency: input.bank.currency,
      iban: bank.iban,
      accountNumber: bank.accountNumber,
      bic: bank.bic,
      address: bank.address,
      note: bank.note,
    };
  } catch {
    return null;
  }
}
