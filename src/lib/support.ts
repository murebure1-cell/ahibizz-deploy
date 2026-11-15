import { publicSupportSettings } from "../config/support";

export type SupportConfig = {
  recipient: string;
  paypalUrl: string | null;
  bank: {
    name: string;
    iban: string | null;
    accountNumber: string | null;
    bic: string | null;
  } | null;
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

/** Accept a receiving link supplied by the recipient; never construct a payment request. */
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

/** ISO 7064 MOD97 check digits, not a verification of account ownership or bank availability. */
export function supportIban(value: unknown): string | null {
  const text = plainText(value, 80);
  if (!text) return null;
  const compact = text.replace(/ /g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact)) return null;
  const checkDigits = Number(compact.slice(2, 4));
  if (checkDigits < 2 || checkDigits > 98) return null;
  if (compact.startsWith("BA") && !/^BA\d{18}$/.test(compact)) return null;
  let remainder = 0;
  for (const character of compact.slice(4) + compact.slice(0, 4)) {
    const digits = /[A-Z]/.test(character) ? String(character.charCodeAt(0) - 55) : character;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1 ? compact : null;
}

export function readSupportConfig(value: unknown): SupportConfig | null {
  if (!record(value) || value.enabled !== true) return null;
  const recipient = plainText(value.recipient, 140);
  if (!recipient) return null;
  const paypalUrl = supportPayPalUrl(value.paypalUrl);
  let bank: SupportConfig["bank"] = null;
  if (record(value.bank)) {
    const name = plainText(value.bank.name, 140);
    const iban = supportIban(value.bank.iban);
    const rawAccount = plainText(value.bank.accountNumber, 40);
    const accountNumber =
      rawAccount &&
      /^[0-9][0-9 -]*[0-9]$/.test(rawAccount) &&
      /^[0-9]{8,34}$/.test(rawAccount.replace(/[ -]/g, ""))
        ? rawAccount
        : null;
    const rawBic = plainText(value.bank.bic, 11);
    const bic =
      rawBic && /^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.test(rawBic.toUpperCase())
        ? rawBic.toUpperCase()
        : null;
    const invalidEnteredIban =
      typeof value.bank.iban === "string" && value.bank.iban.trim() !== "" && !iban;
    const invalidEnteredBic =
      typeof value.bank.bic === "string" && value.bank.bic.trim() !== "" && !bic;
    if (name && (iban || accountNumber) && !invalidEnteredIban && !invalidEnteredBic)
      bank = { name, iban, accountNumber, bic };
  }
  if (!paypalUrl && !bank) return null;
  return { recipient, paypalUrl, bank, purpose: "Podrška razvoju AhiBizza" };
}

export function getSupportConfig(): SupportConfig | null {
  return readSupportConfig(publicSupportSettings);
}

export function bankTransferText(config: SupportConfig): string {
  if (!config.bank) return "";
  return [
    `Primalac: ${config.recipient}`,
    `Banka: ${config.bank.name}`,
    config.bank.iban ? `IBAN: ${config.bank.iban}` : "",
    config.bank.accountNumber ? `Broj računa: ${config.bank.accountNumber}` : "",
    config.bank.bic ? `SWIFT/BIC: ${config.bank.bic}` : "",
    `Svrha uplate: ${config.purpose}`,
  ]
    .filter(Boolean)
    .join("\n");
}
