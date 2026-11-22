// Local abandonment policy, not the PayPal create-request idempotency window.
// A timeout alone never closes a contract: the server must inspect the provider
// and use its checked unpaid-only cancellation path before saving a terminal status.
export const approvalAttemptMaxAgeMs = 72 * 60 * 60 * 1000;

type ApprovalAttempt = {
  status: string;
  paymentMethod?: string;
  paidCycles: number;
  paidEurMinor: number;
  reportedCycles?: number;
  createdAt: string;
};

export function staleSubscriptionApproval(contract: ApprovalAttempt, now = Date.now()) {
  return (
    contract.paymentMethod !== "credits" &&
    contract.status === "APPROVAL_PENDING" &&
    contract.paidCycles === 0 &&
    contract.paidEurMinor === 0 &&
    (contract.reportedCycles ?? 0) === 0 &&
    now - Date.parse(contract.createdAt) >= approvalAttemptMaxAgeMs
  );
}
