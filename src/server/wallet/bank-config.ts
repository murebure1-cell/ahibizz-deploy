import { createHash } from "node:crypto";
import type { CreditBankReceiver } from "../../lib/bank-credit-topup";
import { readSupportConfig } from "../../lib/support";
import type { Environment } from "../env";

export type CreditBankConfiguration = { bank: CreditBankReceiver; fingerprint: string };
/** Explicit commercial recipient only. There is deliberately no donation-account fallback. */
export function readCreditBankConfiguration(
  env: Environment = process.env,
): CreditBankConfiguration | null {
  const raw = env.AHIBIZZ_CREDIT_BANK_TRANSFER;
  if (!raw || raw.length > 8192) return null;
  try {
    const input = JSON.parse(raw);
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).some(
        (key) => !["enabled", "commercialConfirmed", "recipient", "bank"].includes(key),
      ) ||
      input.enabled !== true ||
      input.commercialConfirmed !== true ||
      !input.bank ||
      typeof input.bank !== "object" ||
      Array.isArray(input.bank) ||
      Object.keys(input.bank).some(
        (key) =>
          ![
            "id",
            "label",
            "name",
            "currency",
            "accountNumber",
            "iban",
            "bic",
            "address",
            "note",
          ].includes(key),
      ) ||
      input.bank.currency !== "EUR" ||
      !["Wise", "N26"].includes(input.bank.name) ||
      typeof input.bank.iban !== "string" ||
      !input.bank.iban.trim()
    )
      return null;
    const valid = readSupportConfig({
      enabled: true,
      recipient: input.recipient,
      bankAccounts: [input.bank],
    });
    if (valid?.bankAccounts.length !== 1) return null;
    const receiver = valid.bankAccounts[0];
    if (!receiver) return null;
    const bank: CreditBankReceiver = {
      recipient: valid.recipient,
      id: receiver.id,
      label: receiver.label,
      name: receiver.name,
      currency: input.bank.currency,
      accountNumber: receiver.accountNumber,
      iban: receiver.iban,
      bic: receiver.bic,
      address: receiver.address,
      note: receiver.note,
      purpose: "Dopuna Ahi kredita",
    };
    return { bank, fingerprint: createHash("sha256").update(JSON.stringify(bank)).digest("hex") };
  } catch {
    return null;
  }
}
