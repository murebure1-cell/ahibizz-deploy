import { publicSupportSettings } from "../config/support";
import { IS_PLAY_EDITION } from "./distribution";

export type SupportCurrency = "BAM" | "EUR";

export type SupportBankAccount = {
  id: string;
  label: string;
  name: string;
  iban: string | null;
  accountNumber: string | null;
  bic: string | null;
  address: string | null;
  note: string | null;
  currency?: SupportCurrency;
};

export type SupportConfig = {
  recipient: string;
  paypalUrl: string | null;
  bankAccounts: SupportBankAccount[];
  purpose: string;
};

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function plainText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string" || /[\p{Cc}\p{Cf}]/u.test(value)) return null;
  const text = value.trim();
  return text && text.length <= maximum ? text : null;
}

/** Validate the configured recipient link before displaying it or adding a PayPal.Me amount. */
export function supportPayPalUrl(value: unknown): string | null {
  const text = plainText(value, 1000);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash)
      return null;
    const host = url.hostname.toLowerCase();
    if (host === "paypal.me" || host === "www.paypal.me") {
      if (!/^\/[a-z0-9._-]+\/?$/i.test(url.pathname)) return null;
    } else if (host === "paypal.com" || host === "www.paypal.com") {
      const donate = /^\/donate\/?$/i.test(url.pathname);
      const receivingPath = /^\/(?:paypalme\/[a-z0-9._-]+|ncp\/payment\/[a-z0-9_-]+)\/?$/i.test(
        url.pathname,
      );
      if (!donate && !receivingPath) return null;
      if (
        donate &&
        !plainText(url.searchParams.get("hosted_button_id"), 150) &&
        !plainText(url.searchParams.get("business"), 254)
      )
        return null;
    } else return null;
    return url.href;
  } catch {
    return null;
  }
}

export function donationAmountMinor(value: string): number | null {
  if (!/^\d{1,10}(?:[.,]\d{1,2})?$/.test(value.trim())) return null;
  const [whole = "", decimals = ""] = value.trim().split(/[.,]/);
  const minor = Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
  return minor > 0 ? minor : null;
}

function decimalDonationAmount(amountMinor: number): string {
  const whole = Math.floor(amountMinor / 100);
  const cents = amountMinor % 100;
  return cents ? `${whole}.${String(cents).padStart(2, "0")}` : String(whole);
}

export function donationAmountText(amountMinor: number, currency: SupportCurrency): string {
  return `${decimalDonationAmount(amountMinor).replace(".", ",")} ${currency === "BAM" ? "KM" : "EUR"}`;
}

export function donationPayPalLink(value: unknown, amountMinor: number) {
  const href = supportPayPalUrl(value);
  if (!href || !Number.isSafeInteger(amountMinor) || amountMinor < 1) return null;
  const url = new URL(href);
  // The amount/currency suffix is documented for PayPal.Me. Other receiving links
  // keep their original amount handling and their exact configured destination.
  if (
    !["paypal.me", "www.paypal.me"].includes(url.hostname) ||
    !/^\/[a-z0-9]{1,20}\/?$/i.test(url.pathname) ||
    url.search
  )
    return { href, amountPrefilled: false };
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${decimalDonationAmount(amountMinor)}EUR`;
  return { href: url.href, amountPrefilled: true };
}

/** ISO 7064 MOD97 check digits, not a verification of account ownership or bank availability. */
export function supportIban(value: unknown): string | null {
  const text = plainText(value, 80);
  if (!text) return null;
  const compact = text.replace(/ /g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact)) return null;
  const checkDigits = Number(compact.slice(2, 4));
  if (checkDigits < 2 || checkDigits > 98) return null;
  if (compact.startsWith("BA") && !/^BA\d{18}$/.test(compact)) return null;
  if (compact.startsWith("BE") && !/^BE\d{14}$/.test(compact)) return null;
  let remainder = 0;
  for (const character of compact.slice(4) + compact.slice(0, 4)) {
    const digits = /[A-Z]/.test(character) ? String(character.charCodeAt(0) - 55) : character;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1 ? compact : null;
}

function entered(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function readBankAccount(value: unknown): SupportBankAccount | null {
  if (!record(value)) return null;
  const id = plainText(value.id, 40);
  const label = plainText(value.label, 80);
  const name = plainText(value.name, 140);
  if (!id || !/^[a-z0-9][a-z0-9_-]*$/.test(id) || !label || !name) return null;
  const iban = supportIban(value.iban);
  const rawAccount = plainText(value.accountNumber, 40);
  const accountNumber =
    rawAccount &&
    /^[0-9][0-9 -]*[0-9]$/.test(rawAccount) &&
    /^[0-9]{8,34}$/.test(rawAccount.replace(/[ -]/g, ""))
      ? rawAccount
      : null;
  const rawBic = plainText(value.bic, 11)?.toUpperCase();
  const bic = rawBic && /^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.test(rawBic) ? rawBic : null;
  const address = plainText(value.address, 300);
  const note = plainText(value.note, 220);
  const currency = value.currency === "BAM" || value.currency === "EUR" ? value.currency : null;
  const optional = { iban, accountNumber, bic, address, note };
  if (Object.entries(optional).some(([key, parsed]) => entered(value[key]) && !parsed)) return null;
  if (!iban && !accountNumber) return null;
  return { id, label, name, ...optional, ...(currency ? { currency } : {}) };
}

export function readSupportConfig(value: unknown): SupportConfig | null {
  if (!record(value) || value.enabled !== true) return null;
  const recipient = plainText(value.recipient, 140);
  if (!recipient) return null;
  const paypalUrl = supportPayPalUrl(value.paypalUrl);
  const candidates =
    Array.isArray(value.bankAccounts) && value.bankAccounts.length <= 6 ? value.bankAccounts : [];
  const ids = candidates.map((account) => (record(account) ? plainText(account.id, 40) : null));
  const bankAccounts = candidates.flatMap((account, index) => {
    if (!ids[index] || ids.filter((id) => id === ids[index]).length !== 1) return [];
    const bank = readBankAccount(account);
    return bank ? [bank] : [];
  });
  if (!paypalUrl && !bankAccounts.length) return null;
  return { recipient, paypalUrl, bankAccounts, purpose: "Podrška razvoju AhiBizza" };
}

export function getSupportConfig(): SupportConfig | null {
  return IS_PLAY_EDITION ? null : readSupportConfig(publicSupportSettings);
}

export function bankTransferText(
  config: SupportConfig,
  bankAccountId: string,
  amountMinor?: number,
): string {
  const matches = config.bankAccounts.filter((account) => account.id === bankAccountId);
  if (matches.length !== 1) return "";
  const bank = matches[0];
  if (!bank) return "";
  return [
    `Primalac: ${config.recipient}`,
    `Banka: ${bank.name}`,
    bank.iban ? `IBAN: ${bank.iban}` : "",
    bank.accountNumber ? `Broj računa: ${bank.accountNumber}` : "",
    bank.bic ? `SWIFT/BIC: ${bank.bic}` : "",
    bank.address ? `Adresa banke: ${bank.address}` : "",
    bank.currency && Number.isSafeInteger(amountMinor) && (amountMinor ?? 0) > 0
      ? `Iznos: ${donationAmountText(amountMinor ?? 0, bank.currency)}`
      : "",
    bank.note ? `Napomena: ${bank.note}` : "",
    `Svrha uplate: ${config.purpose}`,
  ]
    .filter(Boolean)
    .join("\n");
}
