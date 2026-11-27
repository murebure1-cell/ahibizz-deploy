import type { Pool, PoolClient } from "pg";
import { type AccountChoices, accountChoiceKeys } from "../lib/account-choices";
import { AccountAccessError, accountTransaction, createAccountAccess } from "./auth/accounts";
import type { AuthService } from "./auth/service";

const columns = {
  showCity: "show_city",
  showFriendCount: "show_friend_count",
  pushMessages: "push_messages",
  pushBookings: "push_bookings",
  pushReels: "push_reels",
} as const satisfies Record<keyof AccountChoices, string>;

async function readChoices(client: Pick<PoolClient, "query">, user: string) {
  const row = (
    await client.query<AccountChoices>(
      `SELECT show_city AS "showCity",show_friend_count AS "showFriendCount",push_messages AS "pushMessages",
        push_bookings AS "pushBookings",push_reels AS "pushReels"
       FROM auth_account_preferences WHERE user_id=$1`,
      [user],
    )
  ).rows[0];
  return (
    row ?? {
      showCity: true,
      showFriendCount: true,
      pushMessages: true,
      pushBookings: true,
      pushReels: true,
    }
  );
}

/** Only known keys with true or false; at least one. */
export function readChoiceChange(input: unknown): Partial<AccountChoices> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new AccountAccessError(400, "INVALID_REQUEST");
  const entries = Object.entries(input);
  if (
    entries.length === 0 ||
    entries.some(
      ([key, value]) =>
        !(accountChoiceKeys as readonly string[]).includes(key) || typeof value !== "boolean",
    )
  )
    throw new AccountAccessError(400, "INVALID_REQUEST");
  return Object.fromEntries(entries) as Partial<AccountChoices>;
}

export function createAccountChoicesService(auth: AuthService, pool: Pool) {
  const access = createAccountAccess(auth);
  return {
    async read(headers: Headers): Promise<AccountChoices> {
      const current = await access.session(headers);
      return accountTransaction(pool, async (client) => {
        const actor = await access.authority(client, current, false, "read");
        return readChoices(client, actor.id);
      });
    },
    async change(headers: Headers, input: unknown): Promise<AccountChoices> {
      const change = readChoiceChange(input);
      const current = await access.session(headers);
      if (current.expectedAccountId === null)
        throw new AccountAccessError(401, "ACCOUNT_IDENTITY_CHANGED");
      return accountTransaction(pool, async (client) => {
        const actor = await access.authority(client, current);
        const keys = Object.keys(change) as (keyof AccountChoices)[];
        const names = keys.map((key) => columns[key]);
        await client.query(
          `INSERT INTO auth_account_preferences(user_id,${names.join(",")}) VALUES ($1,${keys.map((_, i) => `$${i + 2}`).join(",")})
           ON CONFLICT (user_id) DO UPDATE SET ${names.map((name) => `${name}=excluded.${name}`).join(",")},updated_at=clock_timestamp()`,
          [actor.id, ...keys.map((key) => change[key])],
        );
        return readChoices(client, actor.id);
      });
    },
  };
}
