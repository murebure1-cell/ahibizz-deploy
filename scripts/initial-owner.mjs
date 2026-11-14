import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  bootstrapInitialOwnerRecord,
  InitialOwnerError,
  inspectInitialOwner,
} from "../src/server/auth/initial-owner.ts";
import { readDatabaseConfiguration } from "../src/server/env.ts";

/** Operator-only CLI. No activation on startup and no credentials in arguments/output. */
export async function initialOwnerCommand(args, env = process.env) {
  if (args.length === 1 && args[0] === "--help")
    return {
      exitCode: 0,
      body: {
        status: "help",
        commands: [
          "node scripts/initial-owner.mjs --check",
          "node scripts/initial-owner.mjs --activate",
        ],
        requiredEnvironment: ["DATABASE_URL", "AHIBIZZ_INITIAL_OWNER_EMAIL"],
        activation: "Explicitly activates only an existing verified member when no owner exists.",
      },
    };
  if (args.length !== 1 || !["--check", "--activate"].includes(args[0]))
    return { exitCode: 1, body: { status: "error", code: "OWNER_ARGUMENTS_INVALID" } };
  if (!env.AHIBIZZ_INITIAL_OWNER_EMAIL?.trim())
    return { exitCode: 1, body: { status: "error", code: "OWNER_EMAIL_UNCONFIGURED" } };
  let pool;
  try {
    const configuration = readDatabaseConfiguration(env);
    if (!configuration)
      return { exitCode: 1, body: { status: "error", code: "DATABASE_UNCONFIGURED" } };
    const { Pool } = await import("pg");
    pool = new Pool({ ...configuration, max: 1, query_timeout: 5000, statement_timeout: 4000 });
    // The pg driver may emit background errors; never echo connection details.
    pool.on("error", () => {});
    if (args[0] === "--check") {
      const result = await inspectInitialOwner(pool, env.AHIBIZZ_INITIAL_OWNER_EMAIL);
      return {
        exitCode: result.eligible ? 0 : 2,
        body: { status: result.eligible ? "ready" : "blocked", code: result.code },
      };
    }
    await bootstrapInitialOwnerRecord(pool, env.AHIBIZZ_INITIAL_OWNER_EMAIL);
    return { exitCode: 0, body: { status: "ok", code: "INITIAL_OWNER_ACTIVATED" } };
  } catch (error) {
    return {
      exitCode: 1,
      body: {
        status: "error",
        code: error instanceof InitialOwnerError ? error.code : "OWNER_BOOTSTRAP_UNAVAILABLE",
      },
    };
  } finally {
    await pool?.end().catch(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await initialOwnerCommand(process.argv.slice(2));
  console.log(JSON.stringify(result.body));
  process.exitCode = result.exitCode;
}
