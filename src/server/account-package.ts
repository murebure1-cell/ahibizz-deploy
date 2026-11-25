import type { Pool, PoolClient } from "pg";
import {
  type AccountPackageInput,
  type AccountPackageSnapshot,
  isPackageId,
  type PackageId,
  packageBusinessLimit,
} from "../lib/packages";
import { AccountAccessError, accountTransaction, createAccountAccess } from "./auth/accounts";
import { type AuthService, getAuthDatabasePool, getAuthService } from "./auth/service";

function fail(status: number, code: string): never {
  throw new AccountAccessError(status, code);
}

export type BusinessAllowance = { package: PackageId; limit: number; used: number };

/**
 * How many businesses this account keeps and how many its package allows. The caller holds the
 * account's row lock, which a package change takes as well, so the answer cannot go stale inside
 * the caller's transaction.
 */
export async function readBusinessAllowance(
  client: Pick<PoolClient, "query">,
  accountId: string,
): Promise<BusinessAllowance> {
  const row = (
    await client.query<{ package: string; used: number }>(
      `SELECT COALESCE((SELECT package FROM account_package WHERE user_id=$1),'basic') AS package,
         (SELECT count(*)::integer FROM directory_business
           WHERE owner_user_id=$1 AND status<>'archived') AS used`,
      [accountId],
    )
  ).rows[0];
  if (!row || !isPackageId(row.package)) throw new Error("Account package unavailable");
  return { package: row.package, limit: packageBusinessLimit(row.package), used: row.used };
}

export function packageInput(value: unknown): AccountPackageInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(400, "INVALID_PACKAGE_INPUT");
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some((key) => !["package", "expectedVersion", "reason"].includes(key)) ||
    !isPackageId(input.package) ||
    typeof input.expectedVersion !== "number" ||
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 0 ||
    input.expectedVersion >= 2147483646 ||
    typeof input.reason !== "string" ||
    input.reason.length > 500 ||
    !input.reason.trim() ||
    /[\p{Cc}\p{Cf}]/u.test(input.reason.replace(/\r?\n/g, ""))
  )
    fail(400, "INVALID_PACKAGE_INPUT");
  return {
    package: input.package,
    expectedVersion: input.expectedVersion,
    reason: input.reason.replace(/\r\n/g, "\n").trim(),
  };
}

export function packageTarget(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) fail(400, "INVALID_PACKAGE_INPUT");
  return id;
}

export function createAccountPackageService({ pool, auth }: { pool: Pool; auth: AuthService }) {
  const access = createAccountAccess(auth);
  async function operation(
    headers: Headers,
    targetId: string,
    command?: AccountPackageInput,
  ): Promise<AccountPackageSnapshot> {
    if (!headers.get("X-AhiBizz-Account-ID")) fail(401, "AUTHENTICATION_REQUIRED");
    const signed = await access.session(headers);
    if (signed.expectedAccountId !== signed.userId) fail(401, "ACCOUNT_IDENTITY_CHANGED");
    return accountTransaction(pool, async (client) => {
      // Accounts lock in id order everywhere; the target's lock also fences its business quota.
      await client.query(
        `SELECT id FROM auth_user WHERE id=ANY($1::text[]) AND EXISTS(SELECT 1 FROM auth_user a WHERE a.id=$2 AND a.role='owner' AND a.approval='approved' AND a."emailVerified") ORDER BY id FOR UPDATE`,
        [[signed.userId, targetId], signed.userId],
      );
      const actor = await access.authority(client, signed, true);
      const target = (
        await client.query<{ name: string; email: string; role: string }>(
          "SELECT name,email,role FROM auth_user WHERE id=$1 AND erased_at IS NULL",
          [targetId],
        )
      ).rows[0];
      if (!target) fail(404, "NOT_FOUND");
      // The administrator account has no business limit, so it holds no package.
      if (target.role !== "member") fail(409, "TARGET_NOT_ELIGIBLE");
      const held = (
        await client.query<{ package: PackageId; version: number }>(
          "SELECT package,version FROM account_package WHERE user_id=$1 FOR UPDATE",
          [targetId],
        )
      ).rows[0] ?? { package: "basic" as const, version: 0 };
      const allowance = await readBusinessAllowance(client, targetId);
      if (command) {
        if (held.version !== command.expectedVersion) fail(409, "VERSION_CONFLICT");
        if (held.package === command.package) fail(409, "PACKAGE_UNCHANGED");
        if (allowance.used > packageBusinessLimit(command.package))
          fail(409, "PACKAGE_BELOW_USAGE");
        const version = held.version + 1;
        await client.query(
          `INSERT INTO account_package(user_id,package,version) VALUES($1,$2,$3)
           ON CONFLICT(user_id) DO UPDATE SET package=EXCLUDED.package,version=EXCLUDED.version,updated_at=now()`,
          [targetId, command.package, version],
        );
        await client.query(
          `INSERT INTO account_package_decision(user_id,result_version,previous_package,package,actor_user_id,reason)
           VALUES($1,$2,$3,$4,$5,$6)`,
          [targetId, version, held.package, command.package, actor.id, command.reason],
        );
        held.package = command.package;
        held.version = version;
      }
      const latest = (
        await client.query<{
          previousPackage: PackageId;
          package: PackageId;
          reason: string;
          actorName: string | null;
          at: Date;
        }>(
          `SELECT d.previous_package AS "previousPackage",d.package,d.reason,u.name AS "actorName",d.decided_at AS at
           FROM account_package_decision d LEFT JOIN auth_user u ON u.id=d.actor_user_id
           WHERE d.user_id=$1 ORDER BY d.result_version DESC LIMIT 1`,
          [targetId],
        )
      ).rows[0];
      // Row locks block a concurrent revocation; check the session clock again after any wait.
      await access.authority(client, signed, true);
      return {
        id: targetId,
        subjectLabel: target.name,
        identity: target.email,
        package: held.package,
        version: held.version,
        businesses: allowance.used,
        businessLimit: packageBusinessLimit(held.package),
        lastDecision: latest ? { ...latest, at: latest.at.toISOString() } : null,
      };
    });
  }
  return {
    read: (headers: Headers, id: string) => operation(headers, packageTarget(id)),
    decide: (headers: Headers, id: string, input: unknown) =>
      operation(headers, packageTarget(id), packageInput(input)),
  };
}

export type AccountPackageService = ReturnType<typeof createAccountPackageService>;
export function getAccountPackageService(): AccountPackageService | null {
  const auth = getAuthService(),
    pool = getAuthDatabasePool();
  return auth && pool ? createAccountPackageService({ auth, pool }) : null;
}
