type Queryable = {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
};

export type AttemptRule = { windowSeconds: number; max: number };
export type AttemptDecision = { allowed: true } | { allowed: false; retryAfter: number };

/** Windows that ended this long ago are cleared out; far beyond the longest rule (one hour). */
const keepSeconds = 24 * 60 * 60;

/**
 * Counts one attempt against a key and says whether it is still within the rule.
 *
 * The counters live in auth_attempt_limit, a table of our own. In the sign-in library's
 * auth_rate_limit they were deleted about once a minute (see migration 0064), which turned a
 * fifteen-minute limit into a one-minute one.
 *
 * One atomic upsert per attempt: a fixed window that restarts once it has fully passed. Every
 * attempt is counted, also a refused one, so hammering a full window does not shorten it.
 */
export async function countAttempt(
  db: Queryable,
  key: string,
  rule: AttemptRule,
  now: () => number = Date.now,
): Promise<AttemptDecision> {
  const at = now();
  const windowMs = rule.windowSeconds * 1000;
  const { rows } = await db.query(
    `INSERT INTO auth_attempt_limit AS l (key, count, window_started_at)
     VALUES ($1, 1, to_timestamp($2::double precision / 1000))
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN EXCLUDED.window_started_at - l.window_started_at
                         >= make_interval(secs => $3::double precision / 1000) THEN 1
                    ELSE l.count + 1 END,
       window_started_at = CASE WHEN EXCLUDED.window_started_at - l.window_started_at
                                     >= make_interval(secs => $3::double precision / 1000)
                                THEN EXCLUDED.window_started_at
                                ELSE l.window_started_at END
     RETURNING count, round(extract(epoch FROM window_started_at) * 1000)::bigint AS "startedMs"`,
    [key, at, windowMs],
  );
  const row = rows[0] as { count: number; startedMs: string | number } | undefined;
  if (!row || row.count <= rule.max) return { allowed: true };
  const retryAfter = Math.ceil((Number(row.startedMs) + windowMs - at) / 1000);
  return { allowed: false, retryAfter: Math.max(1, retryAfter) };
}

/** Forgets a key, for a counter that should start afresh after a success. */
export async function clearAttempts(db: Queryable, key: string): Promise<void> {
  await db.query("DELETE FROM auth_attempt_limit WHERE key = $1", [key]);
}

/**
 * Clears out windows that ended long ago. Call it on a pool, outside any transaction: a failed
 * statement would abort a caller's transaction, and this is never worth failing an attempt over.
 */
export async function pruneAttemptLimits(db: Queryable): Promise<void> {
  await db.query(
    "DELETE FROM auth_attempt_limit WHERE window_started_at < now() - make_interval(secs => $1)",
    [keepSeconds],
  );
}
