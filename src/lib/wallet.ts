export const initialCreditUnitBamMinor = 10;

export const ahiCreditTopUps = [
  { quantity: 60, base: 50, bonus: 10, amountMinor: 1500 },
  { quantity: 130, base: 100, bonus: 30, amountMinor: 2000 },
  { quantity: 260, base: 200, bonus: 60, amountMinor: 3000 },
  { quantity: 675, base: 500, bonus: 175, amountMinor: 6000 },
  { quantity: 1400, base: 1000, bonus: 400, amountMinor: 11000 },
  { quantity: 3000, base: 2000, bonus: 1000, amountMinor: 21000 },
] as const;

export function creditsForBamMinor(amountMinor: number, unitBamMinor: number): number | null {
  if (
    !Number.isSafeInteger(amountMinor) ||
    amountMinor < 1 ||
    !Number.isSafeInteger(unitBamMinor) ||
    unitBamMinor < 1
  )
    return null;
  const scaled = amountMinor * 100;
  return Number.isSafeInteger(scaled) && scaled % unitBamMinor === 0 ? scaled / unitBamMinor : null;
}

export function formatAhiCredits(creditMinor: number): string {
  return `${(creditMinor / 100).toLocaleString("bs-BA", { maximumFractionDigits: 2 })} Ahi kredita`;
}

export function formatCreditsFromBam(amountMinor: number, unitBamMinor: number | null): string {
  const creditMinor = creditsForBamMinor(amountMinor, unitBamMinor ?? 0);
  return creditMinor === null ? "Cijena na upit" : formatAhiCredits(creditMinor);
}

export function validCreditBalance(value: unknown): value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return false;
  const minor = Math.round(value * 100);
  return Number.isSafeInteger(minor) && minor / 100 === value;
}
