import { canonicalSavedSearch, type SavedSearch } from "../lib/saved-search";
import { AccountAccessError, accountTransaction, createAccountAccess } from "./auth/accounts";
import { getAuthDatabasePool, getAuthService } from "./auth/service";

export async function readSavedSearches(headers: Headers, command?: unknown) {
  const auth = getAuthService(),
    pool = getAuthDatabasePool();
  if (!auth || !pool) throw new AccountAccessError(503, "ACCOUNT_UNAVAILABLE");
  const access = createAccountAccess(auth);
  const scope = await access.session(headers);
  const mutate = command !== undefined;
  if (mutate && !headers.get("X-AhiBizz-Account-ID"))
    throw new AccountAccessError(401, "ACCOUNT_IDENTITY_CHANGED");
  return accountTransaction(pool, async (client) => {
    const user = await access.authority(client, scope, false, mutate ? "write" : "read");
    if (mutate) {
      if (!command || typeof command !== "object" || Array.isArray(command))
        throw new AccountAccessError(400, "INVALID_SEARCH");
      const body = command as Record<string, unknown>;
      const filters = canonicalSavedSearch(body.filters);
      if (!filters) throw new AccountAccessError(400, "INVALID_SEARCH");
      if (body.action === "remove" && Object.keys(body).length === 2) {
        await client.query(
          "DELETE FROM directory_saved_search WHERE account_id=$1 AND filters=$2",
          [user.id, filters],
        );
      } else if (
        body.action === "save" &&
        Object.keys(body).length === 3 &&
        typeof body.label === "string"
      ) {
        const label = body.label.trim();
        if (!label || label.length > 100 || /\p{Cc}/u.test(label))
          throw new AccountAccessError(400, "INVALID_SEARCH");
        const result = await client.query(
          `INSERT INTO directory_saved_search(account_id,filters,label)
          SELECT $1,$2,$3 WHERE (SELECT COUNT(*) FROM directory_saved_search WHERE account_id=$1)<30
            OR EXISTS (SELECT 1 FROM directory_saved_search WHERE account_id=$1 AND filters=$2)
          ON CONFLICT(account_id,filters) DO UPDATE SET label=EXCLUDED.label`,
          [user.id, filters, label],
        );
        if (!result.rowCount) throw new AccountAccessError(409, "SEARCH_LIMIT");
      } else throw new AccountAccessError(400, "INVALID_SEARCH");
    }
    return {
      accountId: user.id,
      searches: (
        await client.query<SavedSearch>(
          "SELECT filters,label FROM directory_saved_search WHERE account_id=$1 ORDER BY created_at DESC,filters LIMIT 30",
          [user.id],
        )
      ).rows,
    };
  });
}
