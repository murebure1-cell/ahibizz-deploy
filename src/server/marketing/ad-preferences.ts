import { headers } from "next/headers";
import { AccountAccessError, accountTransaction, createAccountAccess } from "../auth/accounts";
import { getAuthDatabasePool, getAuthService } from "../auth/service";
export type AdGender = "women" | "men";
const eligible = (v: unknown): v is AdGender => v === "women" || v === "men";
export async function getViewerAdGender(): Promise<AdGender | null> {
  try {
    const h = await headers();
    if (!h.get("cookie")) return null;
    const auth = getAuthService(),
      pool = getAuthDatabasePool();
    if (!auth || !pool) return null;
    const session = await auth.api.getSession({
      headers: h,
      query: { disableCookieCache: true, disableRefresh: true },
    });
    if (!session?.session || session.session.userId !== session.user.id) return null;
    const found = await pool.query(
      `SELECT p.gender FROM ad_audience_preference p JOIN auth_user u ON u.id=p.account_id WHERE u.id=$1 AND u.approval='approved' AND u."emailVerified" AND u.role IN ('owner','member')`,
      [session.user.id],
    );
    return eligible(found.rows[0]?.gender) ? found.rows[0].gender : null;
  } catch {
    return null;
  }
}
export async function personalAdPreference(
  h: Headers,
  change?: unknown,
): Promise<{ gender: AdGender | null }> {
  const auth = getAuthService(),
    pool = getAuthDatabasePool();
  if (!auth || !pool) throw new AccountAccessError(503, "ACCOUNT_UNAVAILABLE");
  if (!h.get("X-AhiBizz-Account-ID")) throw new AccountAccessError(401, "ACCOUNT_IDENTITY_CHANGED");
  const access = createAccountAccess(auth),
    scope = await access.session(h);
  return accountTransaction(pool, async (client) => {
    const actor = await access.authority(
      client,
      scope,
      false,
      change === undefined ? "read" : "write",
    );
    const before =
      (
        await client.query<{ gender: AdGender }>(
          "SELECT gender FROM ad_audience_preference WHERE account_id=$1",
          [actor.id],
        )
      ).rows[0]?.gender ?? null;
    if (change === undefined) return { gender: before };
    const value = change as { gender?: unknown; expected?: unknown; consent?: unknown } | null;
    if (
      !value ||
      typeof value !== "object" ||
      Object.keys(value).length !== 3 ||
      !(eligible(value.gender) || value.gender === null) ||
      !(eligible(value.expected) || value.expected === null) ||
      value.consent !== (value.gender !== null)
    )
      throw new AccountAccessError(400, "INVALID_PREFERENCE");
    if (before === value.gender) return { gender: before };
    if (before !== value.expected) throw new AccountAccessError(409, "PREFERENCE_CHANGED");
    if (value.gender === null)
      await client.query("DELETE FROM ad_audience_preference WHERE account_id=$1", [actor.id]);
    else
      await client.query(
        "INSERT INTO ad_audience_preference(account_id,gender) VALUES($1,$2) ON CONFLICT(account_id) DO UPDATE SET gender=excluded.gender,consented_at=now()",
        [actor.id, value.gender],
      );
    return { gender: value.gender };
  });
}
