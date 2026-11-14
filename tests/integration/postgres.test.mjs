import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { loadMigrations, runMigrations } from "../../scripts/migrate.mjs";
import { readDatabaseConfiguration } from "../../src/server/env.ts";

/** A separate CI database is mandatory; DATABASE_URL and PG* are not inputs. */
export function integrationConfiguration(env) {
  if (env.CI !== "true" || typeof env.AHIBIZZ_TEST_DATABASE_URL !== "string") {
    throw new Error("Explicit isolated CI database configuration is required.");
  }
  try {
    const url = new URL(env.AHIBIZZ_TEST_DATABASE_URL);
    if (
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      decodeURIComponent(url.pathname) !== "/ahibizz_ci" ||
      decodeURIComponent(url.username) !== "ahibizz_ci" ||
      !url.password
    ) {
      throw new Error("wrong target");
    }
    const configuration = readDatabaseConfiguration({
      DATABASE_URL: env.AHIBIZZ_TEST_DATABASE_URL,
    });
    if (!configuration) throw new Error("missing target");
    // Match the migration CLI, not the application's short request timeout.
    return { ...configuration, statement_timeout: 30000, query_timeout: 35000 };
  } catch {
    throw new Error("Only the loopback ahibizz_ci database and role are permitted.");
  }
}

async function tables(pool) {
  return (
    await pool.query(
      "SELECT schemaname, tablename FROM pg_catalog.pg_tables WHERE schemaname !~ '^pg_' AND schemaname <> 'information_schema' ORDER BY schemaname, tablename",
    )
  ).rows;
}

async function waitForBlockedMigrations(pool) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const result = await pool.query(
      "SELECT count(*)::integer AS waiting FROM pg_catalog.pg_stat_activity WHERE datname = current_database() AND application_name = $1 AND wait_event_type = 'Lock' AND wait_event = 'advisory'",
      ["ahibizz-next-ci"],
    );
    if (result.rows[0]?.waiting === 2) return;
    await delay(20);
  }
  throw new Error("Both migration runs must wait for the transaction advisory lock.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  test("real isolated PostgreSQL migrations, locking and rollback", {
    timeout: 45000,
  }, async (t) => {
    const configuration = integrationConfiguration(process.env);
    // This foundation test deliberately covers 0001 only. Feature migrations
    // have their own isolated-schema acceptance tests and must not change it.
    const migrations = (await loadMigrations()).filter(
      ({ version }) => version === "0001_platform.sql",
    );
    assert.equal(migrations.length, 1, "The original platform migration must remain available.");
    const { Pool } = await import("pg");
    const pool = new Pool({ ...configuration, application_name: "ahibizz-next-ci" });
    pool.on("error", () => {});
    try {
      assert.equal(
        (await pool.query("SELECT current_database() AS name, current_user AS role")).rows[0].name,
        "ahibizz_ci",
      );
      assert.equal((await pool.query("SELECT current_user AS role")).rows[0].role, "ahibizz_ci");
      assert.deepEqual(
        await tables(pool),
        [],
        "The CI database must start without user tables; nothing is deleted to make it empty.",
      );

      await t.test(
        "the actual initial migration creates only platform metadata, and repeats without writes",
        async () => {
          assert.deepEqual(await runMigrations({ pool, migrations }), {
            applied: ["0001_platform.sql"],
          });
          assert.deepEqual(await runMigrations({ pool, migrations }), { applied: [] });
          assert.deepEqual(await tables(pool), [
            { schemaname: "public", tablename: "platform_migrations" },
            { schemaname: "public", tablename: "platform_settings" },
          ]);
          const journal = await pool.query(
            "SELECT version, checksum FROM platform_migrations ORDER BY version",
          );
          assert.deepEqual(journal.rows, [
            { version: migrations[0].version, checksum: migrations[0].checksum },
          ]);
          assert.equal(
            (await pool.query("SELECT count(*)::integer AS rows FROM platform_settings")).rows[0]
              .rows,
            0,
          );
          const columns = await pool.query(
            "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'platform_settings' ORDER BY ordinal_position",
          );
          assert.deepEqual(columns.rows, [
            { column_name: "key", data_type: "text" },
            { column_name: "value", data_type: "jsonb" },
            { column_name: "updated_at", data_type: "timestamp with time zone" },
          ]);
        },
      );

      await t.test(
        "migration isolation overrides an inherited repeatable-read session",
        async () => {
          const client = await pool.connect();
          let observedIsolation;
          let reusable = false;
          try {
            await client.query("SET default_transaction_isolation = 'repeatable read'");
            await runMigrations({
              migrations,
              pool: {
                async connect() {
                  return {
                    async query(text, values) {
                      const result = await client.query(text, values);
                      if (text.startsWith("BEGIN")) {
                        observedIsolation = (await client.query("SHOW transaction_isolation"))
                          .rows[0].transaction_isolation;
                      }
                      return result;
                    },
                    release() {},
                  };
                },
              },
            });
            assert.equal(observedIsolation, "read committed");
            await client.query("RESET default_transaction_isolation");
            reusable = true;
          } finally {
            client.release(!reusable);
          }
        },
      );

      await t.test(
        "two real migration runs wait on the same advisory lock, then complete safely",
        async () => {
          const blocker = await pool.connect();
          let attempts;
          try {
            await blocker.query("BEGIN");
            await blocker.query("SELECT pg_advisory_xact_lock($1, $2)", [4278345, 1]);
            attempts = Promise.allSettled([
              runMigrations({ pool, migrations }),
              runMigrations({ pool, migrations }),
            ]);
            await waitForBlockedMigrations(pool);
          } finally {
            try {
              await blocker.query("ROLLBACK");
            } finally {
              blocker.release();
            }
            if (attempts) await attempts;
          }
          for (const result of await attempts) {
            assert.equal(result.status, "fulfilled");
            assert.deepEqual(result.value, { applied: [] });
          }
          assert.equal(
            (await pool.query("SELECT count(*)::integer AS rows FROM platform_migrations")).rows[0]
              .rows,
            1,
          );
        },
      );

      await t.test(
        "failed real DDL leaves neither a table nor an applied journal record",
        async () => {
          const sql = "CREATE TABLE ci_rollback_probe (id integer PRIMARY KEY); SELECT 1 / 0;";
          const failed = {
            version: "0002_ci_rollback.sql",
            sql,
            checksum: createHash("sha256").update(sql).digest("hex"),
          };
          await assert.rejects(
            runMigrations({ pool, migrations: [...migrations, failed] }),
            (error) => error.code === "22012",
          );
          assert.equal(
            (await pool.query("SELECT to_regclass('public.ci_rollback_probe') AS name")).rows[0]
              .name,
            null,
          );
          assert.deepEqual(
            (await pool.query("SELECT version, checksum FROM platform_migrations")).rows,
            [{ version: migrations[0].version, checksum: migrations[0].checksum }],
          );
          assert.deepEqual(await tables(pool), [
            { schemaname: "public", tablename: "platform_migrations" },
            { schemaname: "public", tablename: "platform_settings" },
          ]);
        },
      );
    } finally {
      await pool.end();
    }
  });
}
