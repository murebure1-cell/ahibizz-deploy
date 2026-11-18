import type { VerificationKind, VerificationSnapshot } from "../../lib/verification";
import { AdminRequestError, record } from "./responses";

export function readVerification(
  value: unknown,
  kind: VerificationKind,
  id: string,
): VerificationSnapshot {
  if (
    !record(value) ||
    value.kind !== kind ||
    value.id !== id ||
    typeof value.subjectLabel !== "string" ||
    !value.subjectLabel.trim() ||
    typeof value.identity !== "string" ||
    !value.identity.trim() ||
    (kind === "business" && !/^[A-Za-z0-9_-]{1,128}$/.test(value.identity)) ||
    typeof value.verified !== "boolean" ||
    typeof value.version !== "number" ||
    !Number.isSafeInteger(value.version) ||
    value.version < 0
  )
    throw new AdminRequestError(502);
  const { verified, version, lastDecision, subjectLabel, identity } = value;
  const profile = { kind, id, verified, version, subjectLabel, identity };
  if (lastDecision === null) return { ...profile, lastDecision: null };
  if (
    !record(lastDecision) ||
    lastDecision.verified !== verified ||
    (lastDecision.reason !== null && typeof lastDecision.reason !== "string") ||
    (lastDecision.actorName !== null && typeof lastDecision.actorName !== "string") ||
    typeof lastDecision.at !== "string" ||
    !Number.isFinite(Date.parse(lastDecision.at))
  ) {
    throw new AdminRequestError(502);
  }
  return {
    ...profile,
    lastDecision: {
      verified,
      at: lastDecision.at,
      actorName: lastDecision.actorName,
      reason: lastDecision.reason,
    },
  };
}
