import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readDatabaseConfiguration } from "../src/server/env.ts";

const directory = fileURLToPath(new URL("../db/migrations/", import.meta.url));
const validName = (name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name);
const digest = (sql) => createHash("sha256").update(sql).digest("hex");
export class MigrationError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export async function loadMigrations(folder = directory) {
  const root = await lstat(folder);
  if (!root.isDirectory() || root.isSymbolicLink())
    throw new MigrationError("migration_directory_invalid");
  const names = (await readdir(folder)).filter((name) => name.endsWith(".sql")).sort();
  if (
    !names.length ||
    names.some((name) => !validName(name)) ||
    new Set(names.map((name) => name.slice(0, 4))).size !== names.length
  )
    throw new MigrationError("migration_names_invalid");
  return Promise.all(
    names.map(async (version) => {
      const file = path.join(folder, version),
        stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 1_048_576)
        throw new MigrationError("migration_file_invalid");
      const sql = await readFile(file, "utf8");
      return Object.freeze({ version, sql, checksum: digest(sql) });
    }),
  );
}

/** One checked-out connection owns the lock, all DDL and the journal transaction. */
export async function runMigrations({ pool, migrations }) {
  const files = migrations.map(({ version, sql, checksum }) => ({ version, sql, checksum }));
  if (
    !files.length ||
    files.some(
      (row) =>
        !validName(row.version) || typeof row.sql !== "string" || digest(row.sql) !== row.checksum,
    ) ||
    new Set(files.map((row) => row.version.slice(0, 4))).size !== files.length ||
    files.map((row) => row.version).join() !==
      files
        .map((row) => row.version)
        .sort()
        .join()
  )
    throw new MigrationError("migration_input_invalid");
  const client = await pool.connect();
  let begun = false,
    discard = false;
  try {
    // A waiter must read a new journal snapshot after the lock holder commits.
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    begun = true;
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [4278345, 1]);
    await client.query(
      "CREATE TABLE IF NOT EXISTS platform_migrations (version text PRIMARY KEY, checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'), applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const existing = (
      await client.query("SELECT version, checksum FROM platform_migrations ORDER BY version")
    ).rows;
    if (
      existing.length > files.length ||
      existing.some(
        (row, index) =>
          row.version !== files[index]?.version || row.checksum !== files[index]?.checksum,
      )
    )
      throw new MigrationError("migration_history_mismatch");
    const applied = [];
    for (const file of files.slice(existing.length)) {
      await client.query(file.sql);
      await client.query("INSERT INTO platform_migrations (version, checksum) VALUES ($1, $2)", [
        file.version,
        file.checksum,
      ]);
      applied.push(file.version);
    }
    await client.query("COMMIT");
    begun = false;
    return { applied };
  } catch (error) {
    if (begun) {
      try {
        await client.query("ROLLBACK");
      } catch {
        discard = true;
        throw new MigrationError("migration_rollback_failed");
      }
    }
    throw error;
  } finally {
    client.release(discard);
  }
}

async function main() {
  if (process.argv.length !== 2) throw new MigrationError("migration_arguments_invalid");
  const configuration = readDatabaseConfiguration();
  if (!configuration) throw new MigrationError("database_unconfigured");
  const migrations = await loadMigrations();
  const { Pool } = await import("pg");
  const pool = new Pool({
    ...configuration,
    max: 1,
    statement_timeout: 30000,
    query_timeout: 35000,
  });
  pool.on("error", () => console.error("Database pool reported a background error."));
  try {
    console.log(JSON.stringify({ status: "ok", ...(await runMigrations({ pool, migrations })) }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        status: "error",
        code: error instanceof MigrationError ? error.code : "migration_failed",
      }),
    );
    process.exitCode = 1;
  });
}
