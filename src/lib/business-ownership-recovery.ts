import type { OwnershipCommand, OwnershipReceipt, OwnershipSnapshot } from "./business-ownership";

export type OwnershipIntent = { command: OwnershipCommand; previousOwnerId: string };
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const account = /^[A-Za-z0-9_-]{1,128}$/;
function key(actor: string, business: string) {
  if (
    typeof actor !== "string" ||
    !account.test(actor) ||
    typeof business !== "string" ||
    !uuid.test(business)
  )
    throw new Error("invalid_journal_scope");
  return `ahibizz:ownership:v1:${actor}:${business}`;
}
export function readOwnershipIntent(
  store: Store,
  actor: string,
  business: string,
): OwnershipIntent | null {
  const raw = store.getItem(key(actor, business));
  if (raw === null) return null;
  if (raw.length > 2048) throw new Error("invalid_ownership_journal");
  const value = JSON.parse(raw) as {
    version: number;
    actor: string;
    business: string;
    intent: OwnershipIntent;
  };
  const intent = value?.intent,
    command = intent?.command;
  if (
    value?.version !== 1 ||
    value.actor !== actor ||
    value.business !== business ||
    typeof intent?.previousOwnerId !== "string" ||
    !account.test(intent.previousOwnerId) ||
    !command ||
    !Number.isInteger(command.expectedVersion) ||
    command.expectedVersion < 1 ||
    command.expectedVersion > 2147483646 ||
    typeof command.targetAccountId !== "string" ||
    !account.test(command.targetAccountId) ||
    typeof command.targetEmail !== "string" ||
    command.targetEmail.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(command.targetEmail) ||
    !uuid.test(command.idempotencyKey) ||
    command.note !== undefined ||
    Object.keys(command).sort().join(",") !==
      "expectedVersion,idempotencyKey,targetAccountId,targetEmail"
  )
    throw new Error("invalid_ownership_journal");
  return intent;
}
export function retainOwnershipIntent(
  store: Store,
  actor: string,
  business: string,
  intent: OwnershipIntent,
) {
  const prior = readOwnershipIntent(store, actor, business);
  if (prior && JSON.stringify(prior) !== JSON.stringify(intent))
    throw new Error("pending_ownership_journal");
  const raw = JSON.stringify({ version: 1, actor, business, intent });
  store.setItem(key(actor, business), raw);
  if (store.getItem(key(actor, business)) !== raw) throw new Error("ownership_journal_not_saved");
}
export function forgetOwnershipIntent(
  store: Store,
  actor: string,
  business: string,
  intent: OwnershipIntent,
) {
  const prior = readOwnershipIntent(store, actor, business);
  if (prior?.command.idempotencyKey === intent.command.idempotencyKey)
    store.removeItem(key(actor, business));
}
export function ownershipReceiptMatches(
  intent: OwnershipIntent,
  receipt: OwnershipReceipt,
): boolean {
  return (
    receipt.requestId === intent.command.idempotencyKey &&
    receipt.previousOwnerId === intent.previousOwnerId &&
    receipt.targetAccountId === intent.command.targetAccountId &&
    receipt.previousVersion === intent.command.expectedVersion &&
    receipt.resultVersion === intent.command.expectedVersion + 1
  );
}
export function ownershipIntentState(intent: OwnershipIntent, current: OwnershipSnapshot) {
  if (current.receipt)
    return ownershipReceiptMatches(intent, current.receipt) ? "confirmed" : "invalid";
  if (current.business.version > intent.command.expectedVersion) return "superseded";
  if (
    current.business.version === intent.command.expectedVersion &&
    current.business.ownerId === intent.previousOwnerId
  )
    return "unchanged";
  return "invalid";
}
