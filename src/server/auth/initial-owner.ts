import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { SafeAccountProfile } from "./accounts";

export class InitialOwnerError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super("Initial owner action could not be completed.");
    this.status = status;
    this.code = code;
  }
}

function ownerEmail(email: unknown): string {
  if (
    typeof email !== "string" ||
    email.trim().length > 254 ||
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)
  )
    throw new InitialOwnerError(400, "INVALID_EMAIL");
  return email.trim();
}

/** A read-only operator check; activation revalidates under its own lock. */
export async function inspectInitialOwner(pool: Pool, email: unknown) {
  const normalized = ownerEmail(email);
  try {
    const result = await pool.query<{
      owner_exists: boolean;
      id: string | null;
      emailVerified: boolean | null;
      role: string | null;
      approval: string | null;
    }>(
      `SELECT EXISTS(SELECT 1 FROM auth_user WHERE role='owner') AS owner_exists,
       u.id, u."emailVerified", u.role, u.approval
       FROM (SELECT 1) sentinel LEFT JOIN auth_user u ON lower(u.email)=lower($1)`,
      [normalized],
    );
    const row = result.rows[0];
    if (!row) throw new InitialOwnerError(503, "OWNER_BOOTSTRAP_UNAVAILABLE");
    if (row.owner_exists) return { eligible: false, code: "OWNER_ALREADY_EXISTS" } as const;
    if (!row.id) return { eligible: false, code: "ACCOUNT_NOT_FOUND" } as const;
    if (!row.emailVerified || row.role !== "member" || row.approval === "suspended")
      return { eligible: false, code: "OWNER_BOOTSTRAP_FORBIDDEN" } as const;
    return { eligible: true, code: "INITIAL_OWNER_READY" } as const;
  } catch (error) {
    if (error instanceof InitialOwnerError) throw error;
    throw new InitialOwnerError(503, "OWNER_BOOTSTRAP_UNAVAILABLE");
  }
}

/** Explicit operator call only. Never called by startup, signup or an HTTP route. */
export async function bootstrapInitialOwnerRecord(
  pool: Pool,
  email: unknown,
): Promise<SafeAccountProfile> {
  const normalized = ownerEmail(email);
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch {
    throw new InitialOwnerError(503, "OWNER_BOOTSTRAP_UNAVAILABLE");
  }
  let begun = false;
  let discard = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    begun = true;
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL statement_timeout = '3s'");
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [4278345, 2]);
    if ((await client.query("SELECT id FROM auth_user WHERE role='owner' LIMIT 1")).rows.length)
      throw new InitialOwnerError(409, "OWNER_ALREADY_EXISTS");
    const target = (
      await client.query<{
        id: string;
        emailVerified: boolean;
        role: string;
        approval: string;
      }>(
        'SELECT id,"emailVerified",role,approval FROM auth_user WHERE lower(email)=lower($1) FOR UPDATE',
        [normalized],
      )
    ).rows[0];
    if (!target) throw new InitialOwnerError(404, "ACCOUNT_NOT_FOUND");
    if (!target.emailVerified || target.role !== "member" || target.approval === "suspended")
      throw new InitialOwnerError(403, "OWNER_BOOTSTRAP_FORBIDDEN");
    const updated = await client.query(
      `UPDATE auth_user SET role='owner',approval='approved',"updatedAt"=clock_timestamp()
       WHERE id=$1 AND role='member' AND "emailVerified"=true AND approval=$2 RETURNING id`,
      [target.id, target.approval],
    );
    if (updated.rowCount !== 1) throw new InitialOwnerError(409, "OWNER_BOOTSTRAP_CONFLICT");
    await client.query('DELETE FROM auth_session WHERE "userId"=$1', [target.id]);
    await client.query(
      `INSERT INTO auth_account_audit
       (id,actor_user_id,target_user_id,action,previous_approval,next_approval,previous_role,next_role)
       VALUES($1,$2,$2,'bootstrap-owner',$3,'approved','member','owner')`,
      [randomUUID(), target.id, target.approval],
    );
    const profile = (
      await client.query<SafeAccountProfile>(
        `SELECT u.id,u.name,u.email,u."emailVerified",u.role,u.approval,
         COALESCE(p.locale,'bs') AS locale, COALESCE(p.appearance,'system') AS appearance
         FROM auth_user u LEFT JOIN auth_account_preferences p ON p.user_id=u.id WHERE u.id=$1`,
        [target.id],
      )
    ).rows[0];
    if (!profile) throw new InitialOwnerError(503, "OWNER_BOOTSTRAP_UNAVAILABLE");
    await client.query("COMMIT");
    begun = false;
    return profile;
  } catch (error) {
    if (begun) {
      try {
        await client.query("ROLLBACK");
      } catch {
        discard = true;
      }
    }
    if (error instanceof InitialOwnerError) throw error;
    throw new InitialOwnerError(503, "OWNER_BOOTSTRAP_UNAVAILABLE");
  } finally {
    client.release(discard);
  }
}
