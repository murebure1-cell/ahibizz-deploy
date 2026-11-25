import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadMigrations, runMigrations } from "../../scripts/migrate.mjs";
import { integrationConfiguration } from "./postgres.test.mjs";

const baseURL = "https://reset-ci.ahibizz.invalid",
  password = "Reset-only-fixture-password-417!";
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  test("prelaunch reset keeps the owner and platform content and removes everything else", {
    timeout: 120000,
  }, async () => {
    const configuration = integrationConfiguration(process.env),
      suffix = randomBytes(10).toString("hex"),
      schema = `ci_reset_${suffix}`;
    assert.match(schema, /^ci_reset_[a-f0-9]{20}$/);
    const { Pool } = await import("pg"),
      administration = new Pool({ ...configuration, max: 1 });
    administration.on("error", () => {});
    let pool,
      created = false;
    const originalFetch = globalThis.fetch;
    const outside = async () =>
      (
        await administration.query(
          "SELECT schemaname,tablename FROM pg_catalog.pg_tables WHERE schemaname !~ '^pg_' AND schemaname <> 'information_schema' AND schemaname <> $1 ORDER BY schemaname,tablename",
          [schema],
        )
      ).rows;
    let baseline;
    try {
      assert.deepEqual(
        (await administration.query("SELECT current_database() AS db,current_user AS role")).rows,
        [{ db: "ahibizz_ci", role: "ahibizz_ci" }],
      );
      baseline = await outside();
      await administration.query(`CREATE SCHEMA "${schema}"`);
      created = true;
      pool = new Pool({
        ...configuration,
        max: 6,
        options: `-c search_path=${schema}`,
        application_name: `reset-ci-${suffix}`,
      });
      pool.on("error", () => {});
      assert.equal((await pool.query("SELECT current_schema() AS name")).rows[0].name, schema);
      await runMigrations({ pool, migrations: await loadMigrations() });
      globalThis.fetch = async () => {
        throw new Error("No outbound network in the isolated reset test.");
      };
      const {
        createAuthService,
        createAccountService,
        bootstrapInitialOwner,
        readCurrentAuthUser,
      } = await import("../../src/server/auth/index.ts");
      const { createAuthHttpHandler } = await import("../../src/server/auth-http.ts");
      const { createFavoritesService } = await import("../../src/server/favorites/service.ts");
      const { createPrelaunchReset, prelaunchResetClosesAt } = await import(
        "../../src/server/maintenance/prelaunch-reset.ts"
      );
      const captured = new Map(),
        emails = ["admin", "business-owner", "alice", "bob"].map(
          (name) => `${name}@reset-fixture.invalid`,
        );
      const auth = createAuthService({
        pool,
        baseURL,
        production: true,
        secret: `reset-${randomBytes(32).toString("hex")}`,
        sendEmail: async (message) => {
          captured.set(message.to, message);
        },
      });
      const authHttp = createAuthHttpHandler({
          auth,
          baseURL,
          readUser: (id) => readCurrentAuthUser(pool, id),
        }),
        accounts = createAccountService({ auth, pool });
      const requestAuth = async (method, url, body) =>
        authHttp(
          new Request(new URL(url, baseURL), {
            method,
            headers: { origin: baseURL, "content-type": "application/json" },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          }),
        );
      const actors = [];
      for (const [index, email] of emails.entries()) {
        assert.equal(
          (
            await requestAuth("POST", "/api/auth/sign-up/email", {
              name: `Reset fixture ${index}`,
              email,
              password,
            })
          ).status,
          200,
        );
        assert.ok([200, 302].includes((await requestAuth("GET", captured.get(email).url)).status));
        if (index === 0) await bootstrapInitialOwner(pool, email);
        else {
          const user = (await accounts.listPending(actors[0].headers)).accounts.find(
            (row) => row.email === email,
          );
          assert.ok(user);
          await accounts.decide(actors[0].headers, user.id, {
            approval: "approved",
            expected: "pending",
          });
        }
        const signed = await requestAuth("POST", "/api/auth/sign-in/email", { email, password });
        assert.equal(signed.status, 200);
        const cookie = signed.headers
            .getSetCookie()
            .map((line) => line.split(";", 1)[0])
            .join("; "),
          headers = new Headers({ origin: baseURL, cookie });
        const session = await auth.api.getSession({ headers });
        headers.set("X-AhiBizz-Account-ID", session.user.id);
        actors.push({ headers, user: session.user });
      }
      const [admin, owner, alice] = actors;

      const category = randomUUID(),
        published = randomUUID(),
        draft = randomUUID();
      await pool.query(
        "INSERT INTO directory_category(id,name,slug) VALUES($1,'Reset fixture','reset-fixture')",
        [category],
      );
      for (const [id, status] of [
        [published, "published"],
        [draft, "draft"],
      ])
        await pool.query(
          "INSERT INTO directory_business(id,owner_user_id,title,category_id,status,published_at) VALUES($1,$2,'Reset fixture business',$3,$4,CASE WHEN $4='published' THEN now() ELSE NULL END)",
          [id, owner.user.id, category, status],
        );
      await createFavoritesService({ accounts, auth, pool }).set(alice.headers, published, {
        saved: true,
        expectedVersion: 0,
        idempotencyKey: randomUUID(),
      });
      await pool.query(
        "INSERT INTO platform_settings(key,value) VALUES('reset.fixture','{\"kept\":true}'::jsonb)",
      );
      const count = async (table) =>
        (await pool.query(`SELECT count(*)::integer AS n FROM ${table}`)).rows[0].n;
      const denied = (run, status, code) =>
        assert.rejects(run, (error) => error.status === status && (!code || error.code === code));

      const reset = createPrelaunchReset(auth, pool);
      await denied(() => reset.plan(new Headers()), 401);
      await denied(() => reset.plan(alice.headers), 403, "OWNER_REQUIRED");
      await denied(() => reset.apply(alice.headers, alice.user.email), 403, "OWNER_REQUIRED");

      const { plan, operatorId } = await reset.plan(admin.headers);
      assert.equal(operatorId, admin.user.id);
      assert.deepEqual(plan.owners, [{ id: admin.user.id, email: admin.user.email }]);
      assert.equal(plan.accounts, 3);
      assert.equal(plan.businesses, 2);
      assert.deepEqual(plan.blockers, []);
      const named = new Set(plan.tables.map((table) => table.name));
      for (const table of ["directory_business", "business_favorite", "auth_account_audit"])
        assert.ok(named.has(table), `${table} is emptied`);
      for (const table of [
        "auth_user",
        "auth_session",
        "auth_account",
        "directory_category",
        "blog_article",
        "platform_settings",
        "promotion_price",
        "account_erasure_receipt",
      ])
        assert.equal(named.has(table), false, `${table} is kept`);
      assert.equal(plan.tables.find((table) => table.name === "business_favorite").rows, 1);
      assert.equal(await count("auth_user"), 4);

      await denied(() => reset.apply(admin.headers, "someone@else.invalid"), 400);
      await denied(() => reset.apply(admin.headers, null), 400);
      assert.equal(await count("auth_user"), 4);
      assert.equal(await count("directory_business"), 2);

      assert.deepEqual(await reset.apply(admin.headers, ` ${admin.user.email.toUpperCase()} `), {
        accounts: 3,
        businesses: 2,
      });
      assert.deepEqual((await pool.query("SELECT id,role FROM auth_user")).rows, [
        { id: admin.user.id, role: "owner" },
      ]);
      for (const table of ["directory_business", "business_favorite", "auth_account_audit"])
        assert.equal(await count(table), 0, `${table} is empty`);
      assert.equal(await count("directory_category"), 1);
      assert.deepEqual(
        (await pool.query('SELECT DISTINCT "userId" AS id FROM auth_session')).rows,
        [{ id: admin.user.id }],
      );
      assert.deepEqual(
        (await pool.query('SELECT DISTINCT "userId" AS id FROM auth_account')).rows,
        [{ id: admin.user.id }],
      );
      assert.equal(
        (await pool.query("SELECT value FROM platform_settings WHERE key='reset.fixture'")).rows[0]
          .value.kept,
        true,
      );
      const receipt = (
        await pool.query(
          "SELECT value FROM platform_settings WHERE key='maintenance.prelaunch_reset'",
        )
      ).rows[0].value;
      assert.equal(receipt.operatorId, admin.user.id);
      assert.equal(receipt.accounts, 3);
      assert.equal(receipt.businesses, 2);

      // The owner stays signed in, the others cannot return, and a repeat removes nothing.
      assert.equal((await auth.api.getSession({ headers: admin.headers })).user.id, admin.user.id);
      await denied(() => reset.plan(alice.headers), 401);
      assert.deepEqual(await reset.apply(admin.headers, admin.user.email), {
        accounts: 0,
        businesses: 0,
      });

      const closed = createPrelaunchReset(auth, pool, () => prelaunchResetClosesAt);
      await denied(() => closed.plan(admin.headers), 410, "RESET_CLOSED");
      await denied(() => closed.apply(admin.headers, admin.user.email), 410, "RESET_CLOSED");
      assert.deepEqual(await outside(), baseline);
    } finally {
      globalThis.fetch = originalFetch;
      if (pool) await pool.end();
      if (created) {
        assert.match(schema, /^ci_reset_[a-f0-9]{20}$/);
        await administration.query(`DROP SCHEMA "${schema}" CASCADE`);
      }
      await administration.end();
    }
  });
}
