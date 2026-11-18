export type VerificationKind = "person" | "business";

export type VerificationDecisionInput = {
  verified: boolean;
  expectedVersion: number;
  reason: string;
};

export type VerificationSnapshot = {
  kind: VerificationKind;
  id: string;
  subjectLabel: string;
  identity: string;
  verified: boolean;
  version: number;
  lastDecision: {
    verified: boolean;
    reason: string | null;
    actorName: string | null;
    at: string;
  } | null;
};
