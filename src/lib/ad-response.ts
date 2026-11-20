export type AdInteractionFormat = "loan_calculator" | "lead_form";
export function monthlyLoanPayment(
  principal: number,
  annualPercent: number,
  months: number,
): number | null {
  if (
    !Number.isFinite(principal) ||
    principal <= 0 ||
    principal > 10000000 ||
    !Number.isFinite(annualPercent) ||
    annualPercent < 0 ||
    annualPercent > 100 ||
    !Number.isInteger(months) ||
    months < 1 ||
    months > 600
  )
    return null;
  const rate = annualPercent / 1200;
  const amount =
    rate === 0 ? principal / months : (principal * rate) / -Math.expm1(-months * Math.log1p(rate));
  return Math.round(amount * 100) / 100;
}
