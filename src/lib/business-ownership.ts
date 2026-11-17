import type { DirectoryBusiness } from "../server/directory/types";

export type OwnershipPerson = { id: string; name: string; email: string };
export type OwnershipReceipt = {
  requestId: string;
  businessId: string;
  previousOwnerId: string;
  targetAccountId: string;
  previousVersion: number;
  resultVersion: number;
  recordedAt: string;
};
export type OwnershipSnapshot = {
  business: DirectoryBusiness;
  currentOwner: OwnershipPerson;
  receipt: OwnershipReceipt | null;
};
export type OwnershipLookup = OwnershipSnapshot & { candidate: OwnershipPerson };
export type OwnershipCommand = {
  expectedVersion: number;
  targetAccountId: string;
  targetEmail: string;
  idempotencyKey: string;
  note?: string;
};
