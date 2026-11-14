import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const command = fileURLToPath(new URL("../scripts/initial-owner.mjs", import.meta.url));
function run(args: string[], extra: Record<string, string> = {}) {
  const env = { ...process.env };
  for (const name of [
    "DATABASE_URL",
    "DATABASE_SSL_MODE",
    "AHIBIZZ_INITIAL_OWNER_EMAIL",
    "PGOPTIONS",
  ])
    delete env[name];
  const result = spawnSync(process.execPath, [command, ...args], {
    env: { ...env, ...extra },
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.stderr.includes("postgres://"), false);
  return {
    exit: result.status,
    body: JSON.parse(result.stdout),
    raw: result.stdout + result.stderr,
  };
}

test("packaged Node operator CLI help works without auth, mail, database or TypeScript loader", () => {
  const result = run(["--help"]);
  assert.equal(result.exit, 0);
  assert.equal(result.body.status, "help");
  assert.deepEqual(result.body.requiredEnvironment, [
    "DATABASE_URL",
    "AHIBIZZ_INITIAL_OWNER_EMAIL",
  ]);
});

test("owner activation requires an exact explicit mode and configured target, never ambient startup", () => {
  for (const args of [
    [],
    ["--activate", "--check"],
    ["--email", "person@example.invalid"],
    ["--apply"],
  ]) {
    const result = run(args);
    assert.equal(result.exit, 1);
    assert.deepEqual(result.body, { status: "error", code: "OWNER_ARGUMENTS_INVALID" });
  }
  for (const mode of ["--activate", "--check"]) {
    const missingTarget = run([mode]);
    assert.equal(missingTarget.exit, 1);
    assert.equal(missingTarget.body.code, "OWNER_EMAIL_UNCONFIGURED");
    const missingDatabase = run([mode], {
      AHIBIZZ_INITIAL_OWNER_EMAIL: "operator@example.invalid",
    });
    assert.equal(missingDatabase.exit, 1);
    assert.equal(missingDatabase.body.code, "DATABASE_UNCONFIGURED");
  }
});

test("invalid database configuration has a redacted operator result without leaking the target or credentials", () => {
  const email = "private-operator@example.invalid";
  const secret = "private-fixture-secret";
  const result = run(["--activate"], {
    AHIBIZZ_INITIAL_OWNER_EMAIL: email,
    DATABASE_URL: `postgresql://fixture:${secret}@invalid.example.invalid/db?unknown=1`,
  });
  assert.equal(result.exit, 1);
  assert.deepEqual(result.body, { status: "error", code: "OWNER_BOOTSTRAP_UNAVAILABLE" });
  for (const value of [email, secret, "invalid.example.invalid", "unknown=1"])
    assert.equal(result.raw.includes(value), false);
});
