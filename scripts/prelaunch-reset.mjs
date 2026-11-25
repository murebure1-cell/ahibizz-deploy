// Operator command for the one-time reset before launch, for a deployment where the owner cannot
// reach the page. It runs inside the application container:
//
//   node scripts/prelaunch-reset.mjs plan
//   node scripts/prelaunch-reset.mjs apply --confirm <digest printed by plan>
//
// "plan" changes nothing. "apply" recomputes the plan in the same transaction that deletes and
// refuses when it no longer matches the confirmed digest, so only what was shown is removed.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readDatabaseConfiguration } from "../src/server/env.ts";
import {
  applyPrelaunchResetPlan,
  prelaunchResetClosesAt,
  readPrelaunchResetPlan,
} from "./prelaunch-reset-core.mjs";

const usage =
  "Usage: node scripts/prelaunch-reset.mjs plan | apply --confirm <64 hex digest from plan>";
class ResetError extends Error {
  constructor(code, detail) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

/** What the operator sees: who stays, what goes, and the digest that authorizes exactly this. */
export function describePlan(plan) {
  return {
    stays: plan.owners.map((owner) => owner.email),
    accounts: plan.accounts,
    businesses: plan.businesses,
    rows: plan.tables.filter((table) => table.rows > 0),
    emptyTables: plan.tables.filter((table) => table.rows === 0).length,
    blockers: plan.blockers,
    digest: plan.digest,
  };
}

export function readArguments(argv) {
  if (argv.length === 1 && argv[0] === "plan") return { command: "plan" };
  if (
    argv.length === 3 &&
    argv[0] === "apply" &&
    argv[1] === "--confirm" &&
    /^[a-f0-9]{64}$/.test(argv[2])
  )
    return { command: "apply", digest: argv[2] };
  throw new ResetError("reset_arguments_invalid");
}

async function main(argv) {
  if (argv.length === 1 && argv[0] === "--help") {
    console.log(usage);
    return;
  }
  const request = readArguments(argv);
  if (Date.now() >= prelaunchResetClosesAt) throw new ResetError("reset_closed");
  const configuration = readDatabaseConfiguration();
  if (!configuration) throw new ResetError("database_unconfigured");
  const { Pool } = await import("pg");
  const pool = new Pool({ ...configuration, max: 1 });
  pool.on("error", () => console.error("Database pool reported a background error."));
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '60s'");
    const plan = await readPrelaunchResetPlan(client);
    if (request.command === "plan") {
      await client.query("ROLLBACK");
      console.log(JSON.stringify({ status: "plan", ...describePlan(plan) }));
      return;
    }
    if (plan.digest !== request.digest) throw new ResetError("plan_changed", describePlan(plan));
    if (plan.blockers.length) throw new ResetError("reset_blocked", describePlan(plan));
    const result = await applyPrelaunchResetPlan(client, plan, "operator-command");
    await client.query("COMMIT");
    console.log(JSON.stringify({ status: "applied", ...result, stays: describePlan(plan).stays }));
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      discard = true;
    }
    throw error;
  } finally {
    client.release(discard);
    await pool.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    const known = error instanceof ResetError;
    console.error(
      JSON.stringify({
        status: "error",
        code: known ? error.code : "reset_failed",
        ...(known && error.detail ? { current: error.detail } : {}),
        ...(known && error.code === "reset_arguments_invalid" ? { usage } : {}),
      }),
    );
    process.exitCode = 1;
  });
}
