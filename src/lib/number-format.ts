/**
 * Bosnian number formatting (1.234,56) that does not depend on the runtime having
 * Bosnian ICU data. Some browsers and Node builds silently fall back to English (1,234.56).
 */
export function bosnianNumber(
  value: number,
  options: { minimumFractionDigits?: number; maximumFractionDigits?: number } = {},
): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    ...options,
  })
    .formatToParts(value)
    .map(({ type, value: part }) => (type === "group" ? "." : type === "decimal" ? "," : part))
    .join("");
}

/** Drop-in replacement for `new Intl.NumberFormat("bs-BA", options)` where only `.format` is used. */
export function bosnianFormatter(
  options: { minimumFractionDigits?: number; maximumFractionDigits?: number } = {},
) {
  return { format: (value: number) => bosnianNumber(value, options) };
}

/** Amount in minor units with exactly two decimals, e.g. 1500 → "15,00". */
export function bosnianMoney(minor: number): string {
  return bosnianNumber(minor / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
