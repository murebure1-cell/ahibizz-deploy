import { randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { AccountAccessError, accountTransaction, createAccountAccess } from "./accounts";
import type { AuthService } from "./service";

/**
 * The separate "AhiBizz administracija" account (owner's decision of 2026-11-26).
 *
 * 1. The founder, still the owner, creates it: an approved owner account with its own address
 *    and no password, plus a one-time link (one hour) on which he chooses that password himself.
 * 2. Signed in as the administration, he hands the administration over: his own account
 *    becomes an ordinary personal account with the founder mark.
 * Every step is an owner action on a locked row with an audit entry; nothing here is reachable
 * by sign-up, and no password ever passes through this code.
 */
export const administrationEmail = "administracija@ahibizz.com";
export const administrationName = "AhiBizz administracija";
/** What the administration types instead of its address on the sign-in form. */
export const administrationSignInName = "administrator";
const linkLifetimeSeconds = 3600;

export type AdministrationState = {
  /** Which account is asking. */
  actor: "founder-owner" | "administration";
  administration: { email: string; passwordSet: boolean } | null;
  /** The personal account that still holds the owner role, if the hand-over is not done. */
  handOverPending: boolean;
};

type Actor = { id: string; role: string; account_kind: string };

async function actorRow(client: PoolClient, id: string) {
  const row = (
    await client.query<Actor>(
      "SELECT id, role, account_kind FROM auth_user WHERE id=$1 AND erased_at IS NULL FOR UPDATE",
      [id],
    )
  ).rows[0];
  if (!row || row.role !== "owner") throw new AccountAccessError(403, "OWNER_REQUIRED");
  return row;
}

async function administrationRow(client: PoolClient) {
  return (
    await client.query<{ id: string; email: string; password_set: boolean }>(
      `SELECT u.id, u.email, EXISTS (SELECT 1 FROM auth_account a WHERE a."userId"=u.id
         AND a."providerId"='credential' AND a.password IS NOT NULL) AS password_set
       FROM auth_user u WHERE u.account_kind='administration' FOR UPDATE`,
    )
  ).rows[0];
}

async function personalOwners(client: PoolClient) {
  return (
    await client.query<{ id: string; approval: string }>(
      "SELECT id, approval FROM auth_user WHERE role='owner' AND account_kind='personal' AND erased_at IS NULL ORDER BY \"createdAt\", id FOR UPDATE",
    )
  ).rows;
}

/** A fresh one-time link to choose the administration's password; earlier links stop working. */
async function setupLink(client: PoolClient, userId: string, baseURL: string) {
  await client.query(
    "DELETE FROM auth_verification WHERE identifier LIKE 'reset-password:%' AND value=$1",
    [userId],
  );
  const token = randomBytes(24).toString("base64url");
  await client.query(
    `INSERT INTO auth_verification (id, identifier, value, "expiresAt")
     VALUES ($1, $2, $3, clock_timestamp() + make_interval(secs => $4))`,
    [randomUUID(), `reset-password:${token}`, userId, linkLifetimeSeconds],
  );
  const origin = new URL(baseURL).origin;
  return `${origin}/api/auth/reset-password/${token}?callbackURL=${encodeURIComponent("/nova-lozinka")}`;
}

async function owner(auth: AuthService, pool: Pool, headers: Headers) {
  const access = createAccountAccess(auth);
  const current = await access.session(headers);
  return { access, current, pool };
}

export async function readAdministration(
  auth: AuthService,
  pool: Pool,
  headers: Headers,
): Promise<AdministrationState> {
  const { access, current } = await owner(auth, pool, headers);
  return accountTransaction(pool, async (client) => {
    await access.authority(client, current, true, "write");
    const actor = await actorRow(client, current.userId);
    const administration = await administrationRow(client);
    const pending = (await personalOwners(client)).length > 0;
    return {
      actor: actor.account_kind === "administration" ? "administration" : "founder-owner",
      administration: administration
        ? { email: administration.email, passwordSet: administration.password_set }
        : null,
      handOverPending: pending,
    };
  });
}

/** Step 1: the founder creates the administration account and gets its one-time link. */
export async function createAdministration(
  auth: AuthService,
  pool: Pool,
  headers: Headers,
  baseURL: string,
) {
  const { access, current } = await owner(auth, pool, headers);
  return accountTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [4278345, 3]);
    await access.authority(client, current, true, "write");
    const actor = await actorRow(client, current.userId);
    if (actor.account_kind !== "personal") throw new AccountAccessError(403, "OWNER_REQUIRED");
    if (await administrationRow(client)) throw new AccountAccessError(409, "ADMINISTRATION_EXISTS");
    const taken = await client.query("SELECT 1 FROM auth_user WHERE lower(email)=lower($1)", [
      administrationEmail,
    ]);
    if (taken.rowCount) throw new AccountAccessError(409, "ADMINISTRATION_EMAIL_TAKEN");
    const id = randomUUID();
    await client.query(
      `INSERT INTO auth_user (id, name, email, "emailVerified", role, approval, account_kind)
       VALUES ($1, $2, $3, true, 'owner', 'approved', 'administration')`,
      [id, administrationName, administrationEmail],
    );
    await client.query(
      `INSERT INTO auth_account_audit
       (id,actor_user_id,target_user_id,action,previous_approval,next_approval,previous_role,next_role)
       VALUES ($1,$2,$3,'create-administration','pending','approved','member','owner')`,
      [randomUUID(), actor.id, id],
    );
    return { link: await setupLink(client, id, baseURL) };
  });
}

/** A new one-time link, for example when the first one expired before it was used. */
export async function renewAdministrationLink(
  auth: AuthService,
  pool: Pool,
  headers: Headers,
  baseURL: string,
) {
  const { access, current } = await owner(auth, pool, headers);
  return accountTransaction(pool, async (client) => {
    await access.authority(client, current, true, "write");
    await actorRow(client, current.userId);
    const administration = await administrationRow(client);
    if (!administration) throw new AccountAccessError(404, "ADMINISTRATION_NOT_FOUND");
    return { link: await setupLink(client, administration.id, baseURL) };
  });
}

/**
 * Step 2, signed in as the administration: every personal account that still holds the owner
 * role becomes an ordinary account. The first of them, the founder's, gets the founder mark.
 */
export async function handOverAdministration(auth: AuthService, pool: Pool, headers: Headers) {
  const { access, current } = await owner(auth, pool, headers);
  return accountTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [4278345, 3]);
    await access.authority(client, current, true, "write");
    const actor = await actorRow(client, current.userId);
    if (actor.account_kind !== "administration")
      throw new AccountAccessError(403, "ADMINISTRATION_REQUIRED");
    const owners = await personalOwners(client);
    if (!owners.length) throw new AccountAccessError(409, "HAND_OVER_DONE");
    const hasFounder = (await client.query("SELECT 1 FROM auth_user WHERE founder")).rowCount;
    for (const [index, person] of owners.entries()) {
      await client.query(
        `UPDATE auth_user SET role='member', founder=(founder OR $2), "updatedAt"=clock_timestamp()
         WHERE id=$1`,
        [person.id, !hasFounder && index === 0],
      );
      await client.query(
        `INSERT INTO auth_account_audit
         (id,actor_user_id,target_user_id,action,previous_approval,next_approval,previous_role,next_role)
         VALUES ($1,$2,$3,'hand-over-administration',$4,$4,'owner','member')`,
        [randomUUID(), actor.id, person.id, person.approval],
      );
    }
    return { ok: true as const };
  });
}

/** The administration's address for the sign-in name "administrator", if that account exists. */
export async function administrationSignInEmail(
  database: {
    query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  },
  name: unknown,
) {
  if (typeof name !== "string" || name.trim().toLowerCase() !== administrationSignInName)
    return null;
  const row = (
    await database.query(
      "SELECT email FROM auth_user WHERE account_kind='administration' AND erased_at IS NULL",
    )
  ).rows[0];
  return typeof row?.email === "string" ? row.email : null;
}
