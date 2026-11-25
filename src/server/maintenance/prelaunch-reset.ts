import type { Pool, PoolClient } from "pg";
import {
  applyPrelaunchResetPlan,
  type PrelaunchResetPlan,
  prelaunchResetClosesAt,
  readPrelaunchResetPlan,
} from "../../../scripts/prelaunch-reset-core.mjs";
import { AccountAccessError, createAccountAccess } from "../auth/accounts";
import { type AuthService, getAuthDatabasePool, getAuthService } from "../auth/service";

/**
 * Owner-only access to the one-time reset before launch. The rules about what stays and what goes
 * live in scripts/prelaunch-reset-core.mjs, shared with the operator command.
 * Remove this module and its page after the reset has been used.
 */
export { type PrelaunchResetPlan, prelaunchResetClosesAt };

async function transaction<T>(pool: Pool, body: (client: PoolClient) => Promise<T>): Promise<T> {
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch {
    throw new AccountAccessError(503, "ACCOUNT_UNAVAILABLE");
  }
  let discard = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '60s'");
    const result = await body(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      discard = true;
    }
    if (error instanceof AccountAccessError) throw error;
    throw new AccountAccessError(503, "RESET_UNAVAILABLE");
  } finally {
    client.release(discard);
  }
}

export function createPrelaunchReset(auth: AuthService, pool: Pool, now = () => Date.now()) {
  const access = createAccountAccess(auth);
  function open() {
    if (now() >= prelaunchResetClosesAt) throw new AccountAccessError(410, "RESET_CLOSED");
  }
  return {
    /** Counts only; nothing is changed. */
    async plan(headers: Headers) {
      open();
      const current = await access.session(headers);
      return transaction(pool, async (client) => {
        const operator = await access.authority(client, current, true, "read");
        const { kept: _kept, digest: _digest, ...plan } = await readPrelaunchResetPlan(client);
        return { plan: plan satisfies PrelaunchResetPlan, operatorId: operator.id };
      });
    },
    /** The signed-in owner repeats their own email. Everything happens in one transaction. */
    async apply(headers: Headers, confirmedEmail: unknown) {
      open();
      if (typeof confirmedEmail !== "string" || confirmedEmail.length > 254)
        throw new AccountAccessError(400, "INVALID_RESET_CONFIRMATION");
      const current = await access.session(headers);
      return transaction(pool, async (client) => {
        const operator = await access.authority(client, current, true);
        if (confirmedEmail.trim().toLowerCase() !== operator.email.toLowerCase())
          throw new AccountAccessError(400, "INVALID_RESET_CONFIRMATION");
        const plan = await readPrelaunchResetPlan(client);
        if (plan.blockers.length || !plan.kept.includes(operator.id))
          throw new AccountAccessError(409, "RESET_BLOCKED");
        return applyPrelaunchResetPlan(client, plan, operator.id, now());
      });
    },
  };
}

export function getPrelaunchReset() {
  const auth = getAuthService(),
    pool = getAuthDatabasePool();
  return auth && pool ? createPrelaunchReset(auth, pool) : null;
}
