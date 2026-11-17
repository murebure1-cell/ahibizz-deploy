import { type FavoriteCommand, favoriteId } from "./favorites";
export type FavoriteIntent = { accountId: string; businessId: string; command: FavoriteCommand };
export type FavoriteStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
function validActor(actor: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(actor)) throw new Error("favorite_recovery_unavailable");
}
function key(actor: string, id: string) {
  validActor(actor);
  if (!favoriteId(id)) throw new Error("favorite_recovery_unavailable");
  return `ahibizz.favorite.pending.v1.${actor}.${id}`;
}
export function readFavoriteIntent(
  storage: FavoriteStorage,
  actor: string,
  id: string,
): FavoriteIntent | null {
  const raw = storage.getItem(key(actor, id));
  if (raw === null) return null;
  if (raw.length > 1024) throw new Error("favorite_recovery_unavailable");
  const value = JSON.parse(raw) as FavoriteIntent;
  if (
    !value ||
    typeof value !== "object" ||
    value.accountId !== actor ||
    value.businessId !== id ||
    !value.command ||
    typeof value.command !== "object" ||
    Object.keys(value).length !== 3 ||
    Object.keys(value.command).length !== 3 ||
    typeof value.command.saved !== "boolean" ||
    !Number.isInteger(value.command.expectedVersion) ||
    value.command.expectedVersion < 0 ||
    value.command.expectedVersion > 2147483646 ||
    !favoriteId(value.command.idempotencyKey)
  )
    throw new Error("favorite_recovery_unavailable");
  return {
    accountId: actor,
    businessId: id,
    command: {
      saved: value.command.saved,
      expectedVersion: value.command.expectedVersion,
      idempotencyKey: value.command.idempotencyKey,
    },
  };
}
export function writeFavoriteIntent(storage: FavoriteStorage, intent: FavoriteIntent) {
  const name = key(intent.accountId, intent.businessId),
    existing = readFavoriteIntent(storage, intent.accountId, intent.businessId),
    raw = JSON.stringify(intent);
  if (existing && JSON.stringify(existing) !== raw) throw new Error("favorite_pending_conflict");
  storage.setItem(name, raw);
  if (storage.getItem(name) !== raw) throw new Error("favorite_recovery_unavailable");
  return readFavoriteIntent(storage, intent.accountId, intent.businessId) as FavoriteIntent;
}
export function clearFavoriteIntent(storage: FavoriteStorage, intent: FavoriteIntent) {
  const current = readFavoriteIntent(storage, intent.accountId, intent.businessId);
  if (current?.command.idempotencyKey === intent.command.idempotencyKey)
    storage.removeItem(key(intent.accountId, intent.businessId));
}
