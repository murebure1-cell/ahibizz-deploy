import type { Pool, PoolClient } from "pg";
import { type PackageBenefitsCatalog, readPackageBenefits } from "../../lib/package-benefits";
import { AccountAccessError, accountTransaction, createAccountAccess } from "../auth/accounts";
import type { AuthService } from "../auth/service";

export async function getPackageBenefits(
  db: Pick<Pool, "query"> | PoolClient,
): Promise<PackageBenefitsCatalog> {
  const schedule = (
    await db.query<PackageBenefitsCatalog>(
      "SELECT version,benefits FROM live_package_benefits ORDER BY version DESC LIMIT 1",
    )
  ).rows[0];
  if (!schedule) throw new AccountAccessError(503, "PACKAGES_UNAVAILABLE");
  return schedule;
}
export async function adminPackageBenefits(
  pool: Pool,
  auth: AuthService,
  headers: Headers,
  input?: unknown,
) {
  if (!headers.get("X-AhiBizz-Account-ID"))
    throw new AccountAccessError(401, "ACCOUNT_IDENTITY_CHANGED");
  const access = createAccountAccess(auth),
    session = await access.session(headers);
  return accountTransaction(pool, async (client) => {
    const actor = await access.authority(
      client,
      session,
      true,
      input === undefined ? "read" : "write",
    );
    if (input === undefined) return getPackageBenefits(client);
    const proposed = readPackageBenefits(input);
    if (!proposed || !input || typeof input !== "object" || Object.keys(input).length !== 2)
      throw new AccountAccessError(400, "INVALID_PACKAGE_BENEFITS");
    await client.query("LOCK TABLE live_package_benefits IN SHARE ROW EXCLUSIVE MODE");
    const current = await getPackageBenefits(client);
    if (proposed.version !== current.version)
      throw new AccountAccessError(409, "PACKAGE_BENEFITS_CHANGED");
    const data = await client.query<PackageBenefitsCatalog>(
      "INSERT INTO live_package_benefits(version,benefits,updated_by) VALUES($1,$2,$3) RETURNING version,benefits",
      [current.version + 1, JSON.stringify(proposed.benefits), actor.id],
    );
    return data.rows[0];
  });
}
