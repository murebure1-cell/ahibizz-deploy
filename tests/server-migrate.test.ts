import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";

const { runMigrations, loadMigrations } = await import(
  new URL("../scripts/migrate.mjs", import.meta.url).href
);
const sql = "CREATE TABLE fixture_only (id integer PRIMARY KEY);";
const file = {
  version: "0001_fixture.sql",
  sql,
  checksum: createHash("sha256").update(sql).digest("hex"),
};

function fixture(
  existing: { version: string; checksum: string }[] = [],
  failSql = false,
  failRollback = false,
) {
  const calls: { text: string; values: unknown[] }[] = [],
    releases: boolean[] = [];
  let connects = 0,
    durable = [...existing],
    transaction = [...existing];
  return {
    calls,
    releases,
    get connects() {
      return connects;
    },
    get rows() {
      return durable;
    },
    pool: {
      async connect() {
        connects++;
        return {
          async query(text: string, values: unknown[] = []) {
            calls.push({ text, values });
            if (text === "BEGIN ISOLATION LEVEL READ COMMITTED") transaction = [...durable];
            if (text.startsWith("SELECT version")) return { rows: transaction };
            if (text === sql && failSql) throw new Error("simulated DDL failure");
            if (text.startsWith("INSERT INTO platform_migrations"))
              transaction.push({ version: values[0] as string, checksum: values[1] as string });
            if (text === "COMMIT") durable = transaction;
            if (text === "ROLLBACK" && failRollback) throw new Error("connection lost");
            return { rows: [] };
          },
          release(discard: boolean) {
            releases.push(discard);
          },
        };
      },
    },
  };
}

test("migration lock, DDL and journal share one transaction and replay is a no-op", async () => {
  const f = fixture();
  assert.deepEqual(await runMigrations({ pool: f.pool, migrations: [file] }), {
    applied: [file.version],
  });
  assert.equal(f.connects, 1);
  assert.equal(f.calls[0]?.text, "BEGIN ISOLATION LEVEL READ COMMITTED");
  assert.ok(
    f.calls.findIndex((x) => /pg_advisory_xact_lock/.test(x.text)) <
      f.calls.findIndex((x) => x.text.startsWith("CREATE TABLE")),
  );
  assert.equal(f.calls.at(-1)?.text, "COMMIT");
  assert.deepEqual(f.rows, [{ version: file.version, checksum: file.checksum }]);
  const second = fixture(f.rows);
  assert.deepEqual(await runMigrations({ pool: second.pool, migrations: [file] }), { applied: [] });
  assert.equal(
    second.calls.some((x) => x.text === sql || x.text.startsWith("INSERT")),
    false,
  );
  assert.deepEqual(second.releases, [false]);
});

test("changed or unknown migration history fails before DDL and rolls back", async () => {
  for (const existing of [
    [{ version: file.version, checksum: "0".repeat(64) }],
    [{ version: "0002_unknown.sql", checksum: file.checksum }],
  ]) {
    const f = fixture(existing);
    await assert.rejects(
      runMigrations({ pool: f.pool, migrations: [file] }),
      /migration_history_mismatch/,
    );
    assert.equal(
      f.calls.some((x) => x.text === sql),
      false,
    );
    assert.equal(f.calls.at(-1)?.text, "ROLLBACK");
    assert.deepEqual(f.releases, [false]);
  }
});

test("DDL failure does not commit a journal row; rollback failure discards the connection", async () => {
  const f = fixture([], true);
  await assert.rejects(
    runMigrations({ pool: f.pool, migrations: [file] }),
    /simulated DDL failure/,
  );
  assert.equal(
    f.calls.some((x) => x.text === "COMMIT"),
    false,
  );
  assert.deepEqual(f.rows, []);
  const lost = fixture([], true, true);
  await assert.rejects(
    runMigrations({ pool: lost.pool, migrations: [file] }),
    /migration_rollback_failed/,
  );
  assert.deepEqual(lost.releases, [true]);
});

test("bad input is rejected before any connection; real initial SQL has a fixed checksum", async () => {
  const f = fixture();
  await assert.rejects(
    runMigrations({ pool: f.pool, migrations: [{ ...file, checksum: "0".repeat(64) }] }),
    /migration_input_invalid/,
  );
  assert.equal(f.connects, 0);
  const files = await loadMigrations();
  assert.deepEqual(
    files.map((row: { version: string }) => row.version),
    [
      "0001_platform.sql",
      "0002_auth.sql",
      "0003_account_management.sql",
      "0004_directory.sql",
      "0005_booking.sql",
      "0006_personal_profiles.sql",
      "0007_people_connections.sql",
      "0008_business_media.sql",
      "0009_messaging.sql",
      "0010_billing.sql",
      "0011_business_details.sql",
      "0012_business_reviews.sql",
      "0013_business_favorites.sql",
      "0014_business_ownership.sql",
      "0015_profile_verification.sql",
      "0016_vehicle_rentals.sql",
      "0017_accommodation.sql",
      "0018_directory_revisions.sql",
      "0019_account_approval_email.sql",
      "0020_push_devices.sql",
      "0021_paypal_checkout.sql",
      "0022_dodo_test_checkout.sql",
      "0023_sandbox_package_contracts.sql",
      "0024_sandbox_subscription_settlement_hold.sql",
      "0025_support_requests.sql",
      "0026_community_rules.sql",
      "0027_live_package_contracts.sql",
      "0028_marketing_offers.sql",
      "0029_marketing_online_checkout.sql",
    ],
  );
  assert.equal(files[0].version, "0001_platform.sql");
  assert.equal(files[0].checksum, createHash("sha256").update(files[0].sql).digest("hex"));
});

test("unconfigured migration CLI fails without connecting or exposing a database URL", () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("../scripts/migrate.mjs", import.meta.url))],
    { env: { ...process.env, DATABASE_URL: "" }, encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /database_unconfigured/);
  assert.equal(result.stdout, "");
});
