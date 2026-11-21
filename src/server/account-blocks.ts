import type { Pool, PoolClient } from "pg";
import type { BlockedPeople, BlockState } from "../lib/account-blocks";
import { AccountAccessError, accountTransaction, createAccountAccess } from "./auth/accounts";
import { type AuthService, getAuthDatabasePool, getAuthService } from "./auth/service";

type Query = Pick<PoolClient, "query">;

export async function contactBlocked(client: Query, actor: string, target: string) {
  const result = await client.query<{ blocked: boolean }>(
    "SELECT people_contact_blocked($1,$2) AS blocked",
    [actor, target],
  );
  return result.rows[0]?.blocked === true;
}

async function blockState(client: Query, actor: string, target: string) {
  const result = await client.query<BlockState>(
    `SELECT COALESCE((SELECT blocked FROM people_block WHERE actor_id=$1 AND target_id=u.id),false) AS "blockedByMe",
      NOT people_contact_blocked($1,u.id) AS "canContact",
      COALESCE((SELECT version FROM people_block WHERE actor_id=$1 AND target_id=u.id),0) AS version
      FROM auth_user u WHERE u.id=$2 AND (
        (u.approval='approved' AND u."emailVerified" AND EXISTS (SELECT 1 FROM personal_profile p WHERE p.user_id=u.id AND p.is_public))
        OR EXISTS (SELECT 1 FROM people_block WHERE actor_id=$1 AND target_id=u.id)
        OR EXISTS (SELECT 1 FROM message_thread t WHERE (t.left_user_id=$1 AND t.right_user_id=u.id) OR (t.right_user_id=$1 AND t.left_user_id=u.id))
      )`,
    [actor, target],
  );
  if (!result.rows[0]) throw new AccountAccessError(404, "PERSON_NOT_FOUND");
  return result.rows[0];
}

// The caller holds both auth-user locks in the same order as messaging and connections.
export async function writePeopleBlock(
  client: Query,
  actor: string,
  target: string,
  blocked: boolean,
) {
  await client.query(
    `INSERT INTO people_block(actor_id,target_id,blocked) VALUES($1,$2,$3)
     ON CONFLICT (actor_id,target_id) DO UPDATE
     SET blocked=excluded.blocked,version=people_block.version+1,updated_at=clock_timestamp()
     WHERE people_block.blocked<>excluded.blocked`,
    [actor, target, blocked],
  );
  // Keep queued push behavior and existing conversation metadata in sync with migrated blocks.
  await client.query(
    `UPDATE message_thread_member member SET blocked=$3,updated_at=clock_timestamp()
     FROM message_thread t WHERE member.thread_id=t.id AND t.kind='person' AND member.user_id=$1
       AND ((t.left_user_id=$1 AND t.right_user_id=$2) OR (t.right_user_id=$1 AND t.left_user_id=$2))
       AND member.blocked<>$3`,
    [actor, target, blocked],
  );
}

export function createAccountBlocksService(auth: AuthService, pool: Pool) {
  const access = createAccountAccess(auth);
  return {
    async list(headers: Headers, page: number): Promise<BlockedPeople> {
      const current = await access.session(headers);
      return accountTransaction(pool, async (client) => {
        const actor = await access.authority(client, current, false, "read");
        return readAccountBlocks(client, actor.id, page);
      });
    },
    async searchFilter(headers: Headers) {
      const current = await access.session(headers);
      return accountTransaction(pool, async (client) => {
        const actor = await access.authority(client, current, false, "read");
        return (await hideBlockedBusinesses(client, actor.id)) ? actor.id : null;
      });
    },
    async changeSearchFilter(headers: Headers, enabled: boolean) {
      const current = await access.session(headers);
      if (current.expectedAccountId === null)
        throw new AccountAccessError(401, "ACCOUNT_IDENTITY_CHANGED");
      return accountTransaction(pool, async (client) => {
        const actor = await access.authority(client, current);
        await client.query(
          `INSERT INTO auth_account_preferences(user_id,hide_blocked_businesses) VALUES ($1,$2)
           ON CONFLICT (user_id) DO UPDATE SET hide_blocked_businesses=excluded.hide_blocked_businesses,updated_at=clock_timestamp()`,
          [actor.id, enabled],
        );
        return { hideInSearch: enabled };
      });
    },
    async state(headers: Headers, target: string) {
      const current = await access.session(headers);
      return accountTransaction(pool, async (client) => {
        const actor = await access.authority(client, current, false, "read");
        if (actor.id === target) throw new AccountAccessError(400, "SELF_BLOCK");
        return blockState(client, actor.id, target);
      });
    },
    async set(headers: Headers, target: string, blocked: boolean, expected: number) {
      const current = await access.session(headers);
      if (current.expectedAccountId === null)
        throw new AccountAccessError(401, "ACCOUNT_IDENTITY_CHANGED");
      if (current.userId === target) throw new AccountAccessError(400, "SELF_BLOCK");
      return accountTransaction(pool, async (client) => {
        await client.query(
          "SELECT id FROM auth_user WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE",
          [[current.userId, target]],
        );
        const actor = await access.authority(client, current);
        const before = await blockState(client, actor.id, target);
        if (before.version !== expected)
          throw new AccountAccessError(409, "BLOCK_VERSION_CONFLICT");
        if (before.blockedByMe !== blocked)
          await writePeopleBlock(client, actor.id, target, blocked);
        return blockState(client, actor.id, target);
      });
    },
  };
}

async function readAccountBlocks(
  client: Query,
  actor: string,
  page: number,
): Promise<BlockedPeople> {
  const size = 20;
  const { rows } = await client.query<BlockedPeople["items"][number]>(
    `SELECT b.target_id AS id,u.name,b.version FROM people_block b JOIN auth_user u ON u.id=b.target_id
      WHERE b.actor_id=$1 AND b.blocked ORDER BY b.updated_at DESC,b.target_id LIMIT $2 OFFSET $3`,
    [actor, size + 1, (page - 1) * size],
  );
  return {
    items: rows.slice(0, size),
    page,
    hasMore: rows.length > size,
    hideInSearch: await hideBlockedBusinesses(client, actor),
  };
}
async function hideBlockedBusinesses(client: Query, actor: string) {
  const { rows } = await client.query<{ enabled: boolean }>(
    "SELECT hide_blocked_businesses AS enabled FROM auth_account_preferences WHERE user_id=$1",
    [actor],
  );
  return rows[0]?.enabled === true;
}

export async function getSearchBlockViewer(headers: Headers): Promise<string | null> {
  if (!headers.get("cookie")) return null;
  try {
    const auth = getAuthService(),
      pool = getAuthDatabasePool();
    return auth && pool ? await createAccountBlocksService(auth, pool).searchFilter(headers) : null;
  } catch {
    return null;
  }
}
