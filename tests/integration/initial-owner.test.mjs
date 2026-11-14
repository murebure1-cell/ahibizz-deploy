import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadMigrations, runMigrations } from "../../scripts/migrate.mjs";
import { integrationConfiguration } from "./postgres.test.mjs";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));
const cli = path.join(root, "scripts", "initial-owner.mjs");
const addresses = {
  target: "target@initial-owner-fixture.invalid",
  other: "other@initial-owner-fixture.invalid",
  unverified: "unverified@initial-owner-fixture.invalid",
  suspended: "suspended@initial-owner-fixture.invalid",
  absent: "absent@initial-owner-fixture.invalid",
  concurrentA: "concurrent-a@initial-owner-fixture.invalid",
  concurrentB: "concurrent-b@initial-owner-fixture.invalid",
};

async function tables(pool) {
  return (
    await pool.query(
      "SELECT schemaname,tablename FROM pg_catalog.pg_tables WHERE schemaname !~ '^pg_' AND schemaname <> 'information_schema' ORDER BY schemaname,tablename",
    )
  ).rows;
}

async function snapshot(pool) {
  return {
    users: (
      await pool.query(
        'SELECT id,role,approval,"emailVerified","updatedAt" FROM auth_user ORDER BY id',
      )
    ).rows,
    sessions: (
      await pool.query('SELECT id,"userId",token,"expiresAt" FROM auth_session ORDER BY id')
    ).rows,
    preferences: (await pool.query("SELECT * FROM auth_account_preferences ORDER BY user_id")).rows,
    audit: (await pool.query("SELECT * FROM auth_account_audit ORDER BY id")).rows,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  test("actual operator-only initial-owner CLI against isolated PostgreSQL", {
    timeout: 120000,
  }, async (t) => {
    const configuration = integrationConfiguration(process.env);
    const suffix = randomBytes(10).toString("hex");
    const { Pool } = await import("pg");
    const administration = new Pool({ ...configuration, max: 1 });
    administration.on("error", () => {});
    const scopes = [];
    let outside;
    try {
      assert.deepEqual(
        (await administration.query("SELECT current_database() AS db,current_user AS role")).rows,
        [{ db: "ahibizz_ci", role: "ahibizz_ci" }],
      );
      outside = await tables(administration);
      const migrations = await loadMigrations();
      assert.deepEqual(
        migrations.map(({ version }) => version),
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
        ],
      );

      async function scope(label) {
        const schema = `ci_initial_owner_${label}_${suffix}`;
        assert.match(schema, /^ci_initial_owner_[a-z]+_[a-f0-9]{20}$/);
        assert.equal(
          (
            await administration.query(
              "SELECT count(*)::integer AS n FROM pg_namespace WHERE nspname=$1",
              [schema],
            )
          ).rows[0].n,
          0,
        );
        await administration.query(`CREATE SCHEMA "${schema}"`);
        const state = { schema, pool: null };
        scopes.push(state);
        const pool = new Pool({
          ...configuration,
          options: `-c search_path=${schema},public`,
          application_name: `initial-owner-ci-${label}-${suffix}`,
        });
        pool.on("error", () => {});
        state.pool = pool;
        assert.equal((await pool.query("SELECT current_schema() AS name")).rows[0].name, schema);
        assert.deepEqual(await runMigrations({ pool, migrations }), {
          applied: migrations.map(({ version }) => version),
        });
        return state;
      }

      async function command(state, args, email = addresses.target, overrides = {}) {
        const env = {
          ...process.env,
          DATABASE_URL: process.env.AHIBIZZ_TEST_DATABASE_URL,
          AHIBIZZ_INITIAL_OWNER_EMAIL: email,
          // pg must honor this setting in the real, separate Node CLI process.
          // No database URL options or unsafe live target can enter the fixture.
          PGOPTIONS: `-c search_path=${state.schema},public`,
          ...overrides,
        };
        delete env.NODE_OPTIONS;
        delete env.DATABASE_SSL_MODE;
        for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
        let outcome;
        try {
          const result = await execute(process.execPath, [cli, ...args], {
            cwd: root,
            env,
            timeout: 15000,
            maxBuffer: 65536,
          });
          outcome = { exitCode: 0, ...result };
        } catch (error) {
          if (!Number.isInteger(error.code) || error.signal) throw error;
          outcome = { exitCode: error.code, stdout: error.stdout, stderr: error.stderr };
        }
        assert.equal(outcome.stderr, "", "Operator output must not print a stack or secrets.");
        const output = outcome.stdout.trim();
        assert.equal(output.split("\n").length, 1, "CLI prints one bounded safe JSON result.");
        for (const privateValue of [
          ...Object.values(addresses),
          "initial-owner-target-id",
          "initial-owner-session-token",
          configuration.connectionString,
          new URL(configuration.connectionString).password,
        ]) {
          if (privateValue) assert.equal(output.includes(privateValue), false);
        }
        const body = JSON.parse(output);
        assert.equal(typeof body.status, "string");
        if (body.status !== "help") assert.deepEqual(Object.keys(body).sort(), ["code", "status"]);
        return { exitCode: outcome.exitCode, body };
      }

      const primary = await scope("primary");
      const pool = primary.pool;
      for (const [id, email, verified, approval] of [
        ["initial-owner-target-id", addresses.target, true, "approved"],
        ["initial-owner-other-id", addresses.other, true, "approved"],
        ["initial-owner-unverified-id", addresses.unverified, false, "pending"],
        ["initial-owner-suspended-id", addresses.suspended, true, "suspended"],
      ]) {
        await pool.query(
          'INSERT INTO auth_user(id,name,email,"emailVerified",approval) VALUES($1,$2,$3,$4,$5)',
          [id, "Isolated initial-owner fixture", email, verified, approval],
        );
      }
      await pool.query(
        "INSERT INTO auth_session(id,\"userId\",token,\"expiresAt\") VALUES($1,$2,$3,clock_timestamp()+interval '1 day'),($4,$2,$5,clock_timestamp()+interval '1 day'),($6,$7,$8,clock_timestamp()+interval '1 day')",
        [
          "target-session-a",
          "initial-owner-target-id",
          "initial-owner-session-token-a",
          "target-session-b",
          "initial-owner-session-token-b",
          "other-session",
          "initial-owner-other-id",
          "initial-owner-other-session-token",
        ],
      );
      // Model an existing verified pending member with stale sessions. An explicit
      // activation must approve it and remove only its sessions atomically.
      await pool.query("UPDATE auth_user SET approval='pending' WHERE id=$1", [
        "initial-owner-target-id",
      ]);
      await pool.query(
        "INSERT INTO auth_account_preferences(user_id,locale,appearance) VALUES($1,'de','light')",
        ["initial-owner-target-id"],
      );

      await t.test(
        "invalid arguments and missing configuration never activate an account",
        async () => {
          const before = await snapshot(pool);
          for (const args of [
            [],
            ["--unknown"],
            ["--activate", "--check"],
            ["--activate", "extra"],
          ]) {
            assert.deepEqual(await command(primary, args), {
              exitCode: 1,
              body: { status: "error", code: "OWNER_ARGUMENTS_INVALID" },
            });
          }
          assert.deepEqual(await command(primary, ["--activate"], ""), {
            exitCode: 1,
            body: { status: "error", code: "OWNER_EMAIL_UNCONFIGURED" },
          });
          assert.deepEqual(
            await command(primary, ["--activate"], addresses.target, { DATABASE_URL: undefined }),
            { exitCode: 1, body: { status: "error", code: "DATABASE_UNCONFIGURED" } },
          );
          assert.deepEqual(await command(primary, ["--activate"], "not-an-email"), {
            exitCode: 1,
            body: { status: "error", code: "INVALID_EMAIL" },
          });
          const help = await command(primary, ["--help"], "", { DATABASE_URL: undefined });
          assert.equal(help.exitCode, 0);
          assert.equal(help.body.status, "help");
          assert.deepEqual(await snapshot(pool), before);
        },
      );

      for (const [label, email, code] of [
        ["absent", addresses.absent, "ACCOUNT_NOT_FOUND"],
        ["unverified", addresses.unverified, "OWNER_BOOTSTRAP_FORBIDDEN"],
        ["suspended", addresses.suspended, "OWNER_BOOTSTRAP_FORBIDDEN"],
      ]) {
        await t.test(`${label} accounts cannot be activated by either CLI mode`, async () => {
          const before = await snapshot(pool);
          assert.deepEqual(await command(primary, ["--check"], email), {
            exitCode: 2,
            body: { status: "blocked", code },
          });
          assert.deepEqual(await command(primary, ["--activate"], email), {
            exitCode: 1,
            body: { status: "error", code },
          });
          assert.deepEqual(await snapshot(pool), before);
        });
      }

      await t.test(
        "PGOPTIONS scopes the actual CLI check and its eligible result is read-only",
        async () => {
          const before = await snapshot(pool);
          assert.deepEqual(await command(primary, ["--check"], addresses.target.toUpperCase()), {
            exitCode: 0,
            body: { status: "ready", code: "INITIAL_OWNER_READY" },
          });
          assert.deepEqual(await snapshot(pool), before);
          assert.equal(
            before.users.find(({ id }) => id === "initial-owner-target-id").role,
            "member",
          );
          assert.equal(before.audit.length, 0);
          assert.equal(before.sessions.length, 3);
        },
      );

      await t.test(
        "audit write failure rolls back owner activation and target session deletion",
        async () => {
          const before = await snapshot(pool);
          await pool.query(
            "CREATE FUNCTION ci_owner_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated audit rejection'; END; $$; CREATE TRIGGER ci_owner_reject_audit BEFORE INSERT ON auth_account_audit FOR EACH ROW EXECUTE FUNCTION ci_owner_reject_audit()",
          );
          try {
            assert.deepEqual(await command(primary, ["--activate"]), {
              exitCode: 1,
              body: { status: "error", code: "OWNER_BOOTSTRAP_UNAVAILABLE" },
            });
            assert.deepEqual(await snapshot(pool), before);
          } finally {
            await pool.query(
              "DROP TRIGGER ci_owner_reject_audit ON auth_account_audit; DROP FUNCTION ci_owner_reject_audit()",
            );
          }
        },
      );

      await t.test(
        "explicit activation approves one owner, revokes only its sessions and audits once",
        async () => {
          const before = await snapshot(pool);
          assert.deepEqual(await command(primary, ["--activate"]), {
            exitCode: 0,
            body: { status: "ok", code: "INITIAL_OWNER_ACTIVATED" },
          });
          const after = await snapshot(pool);
          assert.deepEqual(
            after.users.map(({ id, role, approval, emailVerified }) => ({
              id,
              role,
              approval,
              emailVerified,
            })),
            before.users.map(({ id, role, approval, emailVerified }) => ({
              id,
              role: id === "initial-owner-target-id" ? "owner" : role,
              approval: id === "initial-owner-target-id" ? "approved" : approval,
              emailVerified,
            })),
          );
          assert.deepEqual(
            after.sessions,
            before.sessions.filter(({ userId }) => userId !== "initial-owner-target-id"),
          );
          assert.deepEqual(after.preferences, before.preferences);
          assert.equal(after.audit.length, 1);
          const audit = after.audit[0];
          assert.equal(audit.actor_user_id, "initial-owner-target-id");
          assert.equal(audit.target_user_id, "initial-owner-target-id");
          assert.equal(audit.action, "bootstrap-owner");
          assert.equal(audit.previous_role, "member");
          assert.equal(audit.next_role, "owner");
          assert.equal(audit.previous_approval, "pending");
          assert.equal(audit.next_approval, "approved");
          assert.deepEqual(
            after.users.filter(({ id }) => id !== "initial-owner-target-id"),
            before.users.filter(({ id }) => id !== "initial-owner-target-id"),
          );
        },
      );

      await t.test(
        "repeat checks and activation refuse an existing owner without further writes",
        async () => {
          const before = await snapshot(pool);
          assert.deepEqual(await command(primary, ["--check"]), {
            exitCode: 2,
            body: { status: "blocked", code: "OWNER_ALREADY_EXISTS" },
          });
          for (const email of [addresses.target, addresses.other]) {
            assert.deepEqual(await command(primary, ["--activate"], email), {
              exitCode: 1,
              body: { status: "error", code: "OWNER_ALREADY_EXISTS" },
            });
          }
          assert.deepEqual(await snapshot(pool), before);
        },
      );

      await t.test(
        "two competing actual CLI processes activate only one initial owner",
        async () => {
          const concurrent = await scope("concurrent");
          for (const [id, email] of [
            ["concurrent-a", addresses.concurrentA],
            ["concurrent-b", addresses.concurrentB],
          ]) {
            await concurrent.pool.query(
              'INSERT INTO auth_user(id,name,email,"emailVerified") VALUES($1,$2,$3,true)',
              [id, "Isolated competing owner fixture", email],
            );
          }
          const results = await Promise.all([
            command(concurrent, ["--activate"], addresses.concurrentA),
            command(concurrent, ["--activate"], addresses.concurrentB),
          ]);
          assert.equal(results.filter(({ exitCode }) => exitCode === 0).length, 1);
          assert.deepEqual(
            results.find(({ exitCode }) => exitCode !== 0),
            { exitCode: 1, body: { status: "error", code: "OWNER_ALREADY_EXISTS" } },
          );
          const actual = await snapshot(concurrent.pool);
          assert.equal(actual.users.filter(({ role }) => role === "owner").length, 1);
          assert.equal(
            actual.users.filter(({ role, approval }) => role === "member" && approval === "pending")
              .length,
            1,
          );
          assert.equal(actual.audit.length, 1);
          const winner = actual.users.find(({ role }) => role === "owner");
          assert.equal(winner.approval, "approved");
          assert.equal(actual.audit[0].target_user_id, winner.id);
          assert.equal(actual.audit[0].actor_user_id, winner.id);
          assert.equal(actual.sessions.length, 0);
        },
      );
    } finally {
      try {
        for (const { schema, pool } of scopes.reverse()) {
          if (pool) await pool.end();
          assert.match(schema, /^ci_initial_owner_[a-z]+_[a-f0-9]{20}$/);
          assert.equal(
            (
              await administration.query(
                "SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname=$1",
                [schema],
              )
            ).rows[0]?.owner,
            "ahibizz_ci",
          );
          await administration.query(`DROP SCHEMA "${schema}" CASCADE`);
          assert.equal(
            (
              await administration.query(
                "SELECT count(*)::integer AS n FROM pg_namespace WHERE nspname=$1",
                [schema],
              )
            ).rows[0].n,
            0,
          );
        }
        if (outside) assert.deepEqual(await tables(administration), outside);
      } finally {
        await administration.end();
      }
    }
  });
}
