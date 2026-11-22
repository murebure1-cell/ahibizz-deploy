import type { BillingPackageId, BillingPeriod } from "./billing";

export type SandboxContractStatus =
  | "CREATING"
  | "APPROVAL_PENDING"
  | "APPROVED"
  | "ACTIVE"
  | "SUSPENDED"
  | "CANCELLED"
  | "EXPIRED";

export type SandboxPackageContract = {
  id: string;
  requestId: string;
  businessId: string;
  businessTitle: string;
  packageId: BillingPackageId;
  period: BillingPeriod;
  status: SandboxContractStatus;
  amountBamMinor: number;
  amountEurMinor: number;
  paymentMethod?: "paypal" | "credits";
  cycleCreditMinor?: number;
  totalCycles: number;
  paidCycles: number;
  paidEurMinor: number;
  startsAt: string | null;
  endsAt: string | null;
  contractualEndsAt?: string | null;
  benefitsVersion?: number;
  nearbyDays?: number;
  featuredDays?: number;
  createdAt: string;
};

export type SandboxPackageQuote = {
  id: BillingPackageId;
  name: string;
  monthlyMinor: number;
  annualMinor: number;
  monthlyEurMinor: number;
  annualEurMinor: number;
};

export function awaitingFirstSandboxPayment(
  contract: Pick<SandboxPackageContract, "status" | "paidCycles">,
) {
  return (
    contract.paidCycles === 0 &&
    (contract.status === "APPROVED" ||
      contract.status === "ACTIVE" ||
      contract.status === "EXPIRED")
  );
}

function waitForPaymentReport(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

export async function followSandboxFirstPayment(
  id: string,
  signal: AbortSignal,
  refresh: (signal: AbortSignal) => Promise<SandboxPackageContract>,
  update: (contract: SandboxPackageContract) => void,
  wait = waitForPaymentReport,
) {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
  for (const delay of [2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) {
    if (deadline.aborted) return;
    await wait(delay, deadline);
    if (deadline.aborted) return;
    try {
      const contract = await refresh(deadline);
      if (deadline.aborted || contract.id !== id) return;
      update(contract);
      if (!awaitingFirstSandboxPayment(contract)) return;
    } catch {
      // The owner can still check the status manually after a failed background request.
      return;
    }
  }
}

export type PackageContract = SandboxPackageContract;

export function stoppedPayPalInstallments(
  contract: Pick<
    PackageContract,
    | "status"
    | "period"
    | "paymentMethod"
    | "startsAt"
    | "paidCycles"
    | "totalCycles"
    | "amountBamMinor"
  >,
) {
  if (
    contract.status !== "CANCELLED" ||
    contract.period !== "monthly" ||
    contract.paymentMethod !== "paypal" ||
    !contract.startsAt ||
    contract.paidCycles >= contract.totalCycles
  )
    return null;
  const count = contract.totalCycles - contract.paidCycles;
  return { count, amountBamMinor: count * contract.amountBamMinor };
}

export function walletPackageStatus(contract: SandboxPackageContract, now = Date.now()) {
  if (contract.paymentMethod !== "credits" || !contract.endsAt) return null;
  if (Date.parse(contract.endsAt) > now) return "Plaćeno";
  return contract.paidCycles < contract.totalCycles ? "Rata dospjela" : "Istekao";
}
