import type { Pool, PoolClient } from "pg";
import type {
  VerificationDecisionInput,
  VerificationKind,
  VerificationSnapshot,
} from "../lib/verification";
import { AccountAccessError, accountTransaction, createAccountAccess } from "./auth/accounts";
import { type AuthService, getAuthDatabasePool, getAuthService } from "./auth/service";

function fail(status: number, code: string): never {
  throw new AccountAccessError(status, code);
}

export function decisionInput(value: unknown): VerificationDecisionInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(400, "INVALID_VERIFICATION_INPUT");
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some((key) => !["verified", "expectedVersion", "reason"].includes(key)) ||
    typeof input.verified !== "boolean" ||
    typeof input.expectedVersion !== "number" ||
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 0 ||
    input.expectedVersion >= 2147483647 ||
    typeof input.reason !== "string" ||
    input.reason.length > 500 ||
    !input.reason.trim() ||
    /[\p{Cc}\p{Cf}]/u.test(input.reason.replace(/\r?\n/g, ""))
  )
    fail(400, "INVALID_VERIFICATION_INPUT");
  return {
    verified: input.verified,
    expectedVersion: input.expectedVersion,
    reason: input.reason.replace(/\r\n/g, "\n").trim(),
  };
}

export function verificationTarget(
  kind: string,
  id: string,
): { kind: VerificationKind; id: string } {
  if (kind === "person" && /^[A-Za-z0-9_-]{1,128}$/.test(id)) return { kind, id };
  if (
    kind === "business" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)
  )
    return { kind, id: id.toLowerCase() };
  return fail(400, "INVALID_VERIFICATION_INPUT");
}

type Target = { kind: VerificationKind; id: string };
type TargetState = {
  verified: boolean;
  version: number;
  eligible: boolean;
  ownerId: string;
  identity: string;
  subjectLabel: string;
};
async function lockTarget(client: PoolClient, target: Target) {
  const sql =
    target.kind === "person"
      ? `SELECT profile_verified AS verified, verification_version AS version, id AS "ownerId", name AS "subjectLabel", email AS identity,
          (approval='approved' AND "emailVerified") AS eligible FROM auth_user WHERE id=$1 FOR UPDATE`
      : `SELECT b.is_verified AS verified, b.verification_version AS version, b.owner_user_id AS "ownerId", b.title AS "subjectLabel", b.owner_user_id AS identity,
          (b.status<>'archived' AND u.approval='approved' AND u."emailVerified") AS eligible
        FROM directory_business b JOIN auth_user u ON u.id=b.owner_user_id WHERE b.id=$1 AND b.deleted_at IS NULL FOR UPDATE OF b`;
  return (await client.query<TargetState>(sql, [target.id])).rows[0];
}

export function createVerificationService({ pool, auth }: { pool: Pool; auth: AuthService }) {
  const access = createAccountAccess(auth);
  async function operation(
    headers: Headers,
    target: Target,
    command?: VerificationDecisionInput,
  ): Promise<VerificationSnapshot> {
    if (!headers.get("X-AhiBizz-Account-ID")) fail(401, "AUTHENTICATION_REQUIRED");
    const signed = await access.session(headers);
    if (signed.expectedAccountId !== signed.userId) fail(401, "ACCOUNT_IDENTITY_CHANGED");
    return accountTransaction(pool, async (client) => {
      const ownerHint =
        target.kind === "business"
          ? (
              await client.query<{ owner_user_id: string }>(
                "SELECT owner_user_id FROM directory_business WHERE id=$1 AND deleted_at IS NULL",
                [target.id],
              )
            ).rows[0]?.owner_user_id
          : target.id;
      // Use the same user-before-business lock order as ownership transfers.
      await client.query(
        `SELECT id FROM auth_user WHERE id=ANY($1::text[]) AND EXISTS(SELECT 1 FROM auth_user a WHERE a.id=$2 AND a.role='owner' AND a.approval='approved' AND a."emailVerified") ORDER BY id FOR UPDATE`,
        [[signed.userId, ownerHint ?? signed.userId], signed.userId],
      );
      const actor = await access.authority(client, signed, true);
      const state = await lockTarget(client, target);
      if (!state) fail(404, "NOT_FOUND");
      if (state.ownerId !== ownerHint) fail(409, "VERSION_CONFLICT");
      if (command) {
        if (state.version !== command.expectedVersion) fail(409, "VERSION_CONFLICT");
        if (state.verified === command.verified) fail(409, "VERIFICATION_UNCHANGED");
        if (command.verified && !state.eligible) fail(409, "TARGET_NOT_ELIGIBLE");
        const update =
          target.kind === "person"
            ? "UPDATE auth_user SET profile_verified=$2,verification_version=verification_version+1 WHERE id=$1"
            : "UPDATE directory_business SET is_verified=$2,verification_version=verification_version+1 WHERE id=$1";
        await client.query(update, [target.id, command.verified]);
        state.version++;
        state.verified = command.verified;
        await client.query(
          `INSERT INTO profile_verification_decision(kind,target_id,result_version,verified,actor_user_id,reason) VALUES ($1,$2,$3,$4,$5,$6)`,
          [target.kind, target.id, state.version, state.verified, actor.id, command.reason],
        );
      }
      const latest = (
        await client.query<{
          verified: boolean;
          reason: string;
          actorName: string | null;
          at: Date;
        }>(
          `SELECT d.verified,d.reason,u.name AS "actorName",d.decided_at AS at
         FROM profile_verification_decision d LEFT JOIN auth_user u ON u.id=d.actor_user_id
         WHERE d.kind=$1 AND d.target_id=$2 ORDER BY d.result_version DESC LIMIT 1`,
          [target.kind, target.id],
        )
      ).rows[0];
      // Row locks block concurrent revocation; check the actual expiry clock after every possible wait.
      await access.authority(client, signed, true);
      return {
        ...target,
        subjectLabel: state.subjectLabel,
        identity: state.identity,
        verified: state.verified,
        version: state.version,
        lastDecision: latest ? { ...latest, at: latest.at.toISOString() } : null,
      };
    });
  }
  return {
    read: (headers: Headers, kind: VerificationKind, id: string) =>
      operation(headers, verificationTarget(kind, id)),
    decide: (headers: Headers, kind: VerificationKind, id: string, input: unknown) =>
      operation(headers, verificationTarget(kind, id), decisionInput(input)),
  };
}

export function getVerificationService() {
  const auth = getAuthService(),
    pool = getAuthDatabasePool();
  return auth && pool ? createVerificationService({ auth, pool }) : null;
}
