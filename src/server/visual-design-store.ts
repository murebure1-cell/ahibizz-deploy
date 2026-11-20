import { unstable_cache } from "next/cache";
import type { Pool } from "pg";
import { cache } from "react";
import { defaultVisualDesign, parseVisualDesign, type VisualDesign } from "../lib/visual-design";
import { AccountAccessError, accountTransaction, createAccountAccess } from "./auth/accounts";
import { type AuthService, getAuthDatabasePool, getAuthService } from "./auth/service";
import { getDatabase } from "./db";

const settingKey = "appearance.visual_design";
export const visualDesignTag = "ahibizz-visual-design";
export type VisualDesignState = { revision: number; draft: VisualDesign; published: VisualDesign };

function blankState(): VisualDesignState {
  return { revision: 0, draft: defaultVisualDesign(), published: defaultVisualDesign() };
}
function storedState(value: unknown): VisualDesignState {
  if (!value || typeof value !== "object") throw new AccountAccessError(503, "DESIGN_UNAVAILABLE");
  const { revision, draft, published } = value as Record<string, unknown>;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0)
    throw new AccountAccessError(503, "DESIGN_UNAVAILABLE");
  try {
    return { revision, draft: parseVisualDesign(draft), published: parseVisualDesign(published) };
  } catch {
    throw new AccountAccessError(503, "DESIGN_UNAVAILABLE");
  }
}

export function createVisualDesignStore(auth: AuthService, pool: Pool) {
  const access = createAccountAccess(auth);
  return {
    async read(headers: Headers) {
      const session = await access.session(headers);
      return accountTransaction(pool, async (client) => {
        const actor = await access.authority(client, session, true);
        const { rows } = await client.query("SELECT value FROM platform_settings WHERE key=$1", [
          settingKey,
        ]);
        return { actor: actor.id, state: rows.length ? storedState(rows[0].value) : blankState() };
      });
    },
    async write(headers: Headers, expected: number, input: unknown, mode: "draft" | "publish") {
      if (!Number.isSafeInteger(expected) || expected < 0 || !["draft", "publish"].includes(mode))
        throw new AccountAccessError(400, "INVALID_DESIGN");
      let design: VisualDesign;
      try {
        design = parseVisualDesign(input);
      } catch {
        throw new AccountAccessError(400, "INVALID_DESIGN");
      }
      const session = await access.session(headers);
      return accountTransaction(pool, async (client) => {
        await access.authority(client, session, true);
        await client.query(
          "INSERT INTO platform_settings(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO NOTHING",
          [settingKey, JSON.stringify(blankState())],
        );
        const { rows } = await client.query(
          "SELECT value FROM platform_settings WHERE key=$1 FOR UPDATE",
          [settingKey],
        );
        const current = storedState(rows[0].value);
        if (expected !== current.revision) throw new AccountAccessError(409, "DESIGN_CHANGED");
        const next = {
          revision: expected + 1,
          draft: design,
          published: mode === "publish" ? design : current.published,
        };
        await client.query(
          "UPDATE platform_settings SET value=$2::jsonb,updated_at=now() WHERE key=$1",
          [settingKey, JSON.stringify(next)],
        );
        return next;
      });
    },
  };
}

export function getVisualDesignStore() {
  const auth = getAuthService(),
    pool = getAuthDatabasePool();
  return auth && pool ? createVisualDesignStore(auth, pool) : null;
}

const published = unstable_cache(
  async () => {
    const db = getDatabase();
    if (!db.configured()) return defaultVisualDesign();
    const { rows } = await db.query(
      "SELECT value->'published' AS published FROM platform_settings WHERE key=$1",
      [settingKey],
    );
    return rows[0] ? parseVisualDesign(rows[0].published) : defaultVisualDesign();
  },
  [settingKey],
  { tags: [visualDesignTag], revalidate: 60 },
);

export const readPublishedDesign = cache(async (): Promise<VisualDesign> => {
  try {
    return await published();
  } catch {
    return defaultVisualDesign();
  }
});
