import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { loadMigrations, runMigrations } from "../../scripts/migrate.mjs";
import { integrationConfiguration } from "./postgres.test.mjs";

const baseURL = "https://favorites-ci.ahibizz.invalid",
  password = "Favorites-only-fixture-password-994!";
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  test("real isolated business favorites, actor privacy, CAS and publication filtering", {
    timeout: 120000,
  }, async (t) => {
    const configuration = integrationConfiguration(process.env),
      suffix = randomBytes(10).toString("hex"),
      schema = `ci_favorites_${suffix}`,
      applicationName = `favorites-ci-${suffix}`;
    assert.match(schema, /^ci_favorites_[a-f0-9]{20}$/);
    const { Pool } = await import("pg"),
      administration = new Pool({ ...configuration, max: 1 });
    administration.on("error", () => {});
    let pool,
      created = false;
    const originalFetch = globalThis.fetch;
    let outbound = 0;
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
      assert.equal(
        (
          await administration.query(
            "SELECT count(*)::integer AS n FROM pg_namespace WHERE nspname=$1",
            [schema],
          )
        ).rows[0].n,
        0,
      );
      baseline = await outside();
      await administration.query(`CREATE SCHEMA "${schema}"`);
      created = true;
      pool = new Pool({
        ...configuration,
        max: 6,
        options: `-c search_path=${schema}`,
        application_name: applicationName,
      });
      pool.on("error", () => {});
      assert.equal((await pool.query("SELECT current_schema() AS name")).rows[0].name, schema);
      const migrations = await loadMigrations();
      assert.ok(migrations.some((row) => row.version === "0013_business_favorites.sql"));
      await runMigrations({ pool, migrations });
      assert.deepEqual(await runMigrations({ pool, migrations }), { applied: [] });
      globalThis.fetch = async () => {
        outbound++;
        throw new Error("No outbound network in isolated favorites test.");
      };
      const {
        createAuthService,
        createAccountService,
        bootstrapInitialOwner,
        readCurrentAuthUser,
      } = await import("../../src/server/auth/index.ts");
      const { createAuthHttpHandler } = await import("../../src/server/auth-http.ts");
      const { createFavoritesService } = await import("../../src/server/favorites/service.ts");
      const { createFavoritesHttpHandler } = await import("../../src/server/favorites-http.ts");
      const captured = new Map(),
        emails = ["admin", "business-owner", "alice", "bob"].map(
          (v) => `${v}@favorites-fixture.invalid`,
        );
      const auth = createAuthService({
        pool,
        baseURL,
        production: true,
        secret: `favorites-${randomBytes(32).toString("hex")}`,
        sendEmail: async (message) => {
          assert.ok(emails.includes(message.to));
          assert.equal(message.kind, "verification");
          assert.equal(new URL(message.url).origin, baseURL);
          assert.equal(captured.has(message.to), false);
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
              name: `Review fixture ${index}`,
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
        assert.ok(cookie);
        const session = await auth.api.getSession({ headers });
        headers.set("X-AhiBizz-Account-ID", session.user.id);
        actors.push({ headers, user: session.user, session: session.session });
      }

      const [admin, owner, alice, bob] = actors,
        service = createFavoritesService({ accounts, auth, pool }),
        http = createFavoritesHttpHandler({ service, baseURL });
      const category = randomUUID(),
        business = randomUUID(),
        hidden = randomUUID();
      await pool.query(
        "INSERT INTO directory_category(id,name,slug) VALUES($1,'Favorites fixture','favorites-fixture')",
        [category],
      );
      for (const [id, status] of [
        [business, "published"],
        [hidden, "draft"],
      ])
        await pool.query(
          "INSERT INTO directory_business(id,owner_user_id,title,category_id,status,published_at) VALUES($1,$2,'Favorite fixture business',$3,$4,CASE WHEN $4='published' THEN now() ELSE NULL END)",
          [id, owner.user.id, category, status],
        );
      const command = (saved, expectedVersion, key = randomUUID()) => ({
        saved,
        expectedVersion,
        idempotencyKey: key,
      });
      const denied = (fn, status, code) =>
        assert.rejects(fn, (error) => error.status === status && (!code || error.code === code));
      const count = async () =>
        (await pool.query("SELECT count(*)::integer AS n FROM business_favorite")).rows[0].n;
      let saved;
      await t.test("batch state reads are private, bounded and do not insert", async () => {
        assert.deepEqual(await service.states(alice.headers, [business, hidden]), {
          accountId: alice.user.id,
          items: [{ businessId: business, saved: false, version: 0 }],
        });
        assert.equal(await count(), 0);
        await denied(() => service.states(new Headers(), [business]), 401);
        await denied(
          () =>
            service.states(new Headers({ "x-role": "owner", "x-user-id": alice.user.id }), [
              business,
            ]),
          401,
        );
        await denied(
          () =>
            service.states(
              alice.headers,
              Array.from({ length: 51 }, () => randomUUID()),
            ),
          400,
        );
      });
      await t.test(
        "missing or mismatched expected actor cannot mutate or read a saved list",
        async () => {
          const missing = new Headers(alice.headers);
          missing.delete("X-AhiBizz-Account-ID");
          await denied(() => service.set(missing, business, command(true, 0)), 400);
          await denied(() => service.list(missing), 400);
          const changed = new Headers(bob.headers);
          changed.set("X-AhiBizz-Account-ID", alice.user.id);
          await denied(
            () => service.set(changed, business, command(true, 0)),
            401,
            "ACCOUNT_IDENTITY_CHANGED",
          );
          await denied(() => service.states(changed, [business]), 401, "ACCOUNT_IDENTITY_CHANGED");
        },
      );
      await t.test(
        "saving is durable, account scoped and exactly replayable without another version",
        async () => {
          const input = command(true, 0);
          saved = (await service.set(alice.headers, business, input)).items[0];
          assert.deepEqual(saved, { businessId: business, saved: true, version: 1 });
          assert.deepEqual((await service.set(alice.headers, business, input)).items[0], saved);
          assert.deepEqual((await service.states(bob.headers, [business])).items, [
            { businessId: business, saved: false, version: 0 },
          ]);
          assert.equal(
            (await pool.query("SELECT count(*)::integer AS n FROM business_favorite_command"))
              .rows[0].n,
            1,
          );
          await denied(
            () => service.set(alice.headers, business, { ...input, saved: false }),
            409,
            "IDEMPOTENCY_CONFLICT",
          );
        },
      );
      await t.test(
        "concurrent contradictory commands against one displayed version cannot both succeed",
        async () => {
          const a = command(false, saved.version),
            b = command(true, saved.version);
          const results = await Promise.allSettled([
            service.set(alice.headers, business, a),
            service.set(alice.headers, business, b),
          ]);
          assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
          assert.equal(
            results.filter((r) => r.status === "rejected" && r.reason.code === "VERSION_CONFLICT")
              .length,
            1,
          );
          saved = (await service.states(alice.headers, [business])).items[0];
          assert.equal(saved.version, 2);
        },
      );
      await t.test(
        "old receipts and old versions do not resurrect a removed favorite",
        async () => {
          const on = command(true, saved.version);
          saved = (await service.set(alice.headers, business, on)).items[0];
          const off = command(false, saved.version);
          saved = (await service.set(alice.headers, business, off)).items[0];
          assert.equal(saved.saved, false);
          await denied(() => service.set(alice.headers, business, on), 409, "VERSION_CONFLICT");
          await denied(
            () => service.set(alice.headers, business, command(true, 0)),
            409,
            "VERSION_CONFLICT",
          );
          assert.equal((await service.states(alice.headers, [business])).items[0].saved, false);
          assert.equal((await service.list(alice.headers)).items.length, 0);
        },
      );
      await t.test(
        "unknown and unpublished businesses cannot be saved or expose state",
        async () => {
          await denied(() => service.set(alice.headers, randomUUID(), command(true, 0)), 404);
          await denied(() => service.set(alice.headers, hidden, command(true, 0)), 404);
          await denied(() => service.set(alice.headers, hidden, command(false, 0)), 404);
          assert.deepEqual((await service.states(alice.headers, [hidden])).items, []);
        },
      );
      await t.test(
        "a published profile disappears on withdrawal and returns only with public eligibility",
        async () => {
          saved = (await service.set(alice.headers, business, command(true, saved.version)))
            .items[0];
          await pool.query("UPDATE directory_business SET status='draft' WHERE id=$1", [business]);
          assert.deepEqual((await service.states(alice.headers, [business])).items, []);
          assert.equal((await service.list(alice.headers)).items.length, 0);
          await denied(
            () => service.set(alice.headers, business, command(true, saved.version)),
            404,
          );
          saved = (await service.set(alice.headers, business, command(false, saved.version)))
            .items[0];
          assert.equal(saved.saved, false);
          await pool.query("UPDATE directory_business SET status='published' WHERE id=$1", [
            business,
          ]);
          saved = (await service.set(alice.headers, business, command(true, saved.version)))
            .items[0];
          assert.equal((await service.list(alice.headers)).items.length, 1);
          for (const patch of ["approval='suspended'", '"emailVerified"=false']) {
            await pool.query(`UPDATE auth_user SET ${patch} WHERE id=$1`, [owner.user.id]);
            assert.equal((await service.list(alice.headers)).items.length, 0);
            assert.deepEqual((await service.states(alice.headers, [business])).items, []);
            await pool.query(
              "UPDATE auth_user SET approval='approved',\"emailVerified\"=true WHERE id=$1",
              [owner.user.id],
            );
          }
        },
      );
      await t.test("saved list never leaks owner identifiers or moderation feedback", async () => {
        const page = await service.list(alice.headers);
        assert.equal(page.accountId, alice.user.id);
        assert.equal(page.items[0].id, business);
        for (const key of [
          "ownerId",
          "status",
          "version",
          "archivedAt",
          "updatedAt",
          "moderationReturn",
          "email",
          "approval",
        ])
          assert.equal(Object.hasOwn(page.items[0], key), false, key);
        assert.equal((await service.list(bob.headers)).items.length, 0);
      });
      await t.test(
        "pending suspended and unverified actors lose both reads and writes",
        async () => {
          for (const patch of [
            "approval='pending'",
            "approval='suspended'",
            '"emailVerified"=false',
          ]) {
            await pool.query(`UPDATE auth_user SET ${patch} WHERE id=$1`, [alice.user.id]);
            await denied(() => service.states(alice.headers, [business]), 403);
            await denied(() => service.list(alice.headers), 403);
            await denied(
              () => service.set(alice.headers, business, command(false, saved.version)),
              403,
            );
            await pool.query(
              "UPDATE auth_user SET approval='approved',\"emailVerified\"=true WHERE id=$1",
              [alice.user.id],
            );
          }
        },
      );
      await t.test("stable bounded pages include only eligible saved profiles", async () => {
        for (let i = 0; i < 22; i++) {
          const id = randomUUID();
          await pool.query(
            "INSERT INTO directory_business(id,owner_user_id,title,category_id,status,published_at) VALUES($1,$2,$3,$4,'published',now())",
            [id, admin.user.id, `Favorite ${i}`, category],
          );
          await service.set(alice.headers, id, command(true, 0));
        }
        const first = await service.list(alice.headers, 1),
          second = await service.list(alice.headers, 2);
        assert.equal(first.items.length, 20);
        assert.equal(first.hasMore, true);
        assert.equal(second.items.length, 3);
        assert.equal(second.hasMore, false);
        assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 23);
        await denied(() => service.list(alice.headers, 1001), 400);
      });
      await t.test(
        "DB constraints preserve immutable pair identity and monotonic versions",
        async () => {
          await assert.rejects(
            () =>
              pool.query(
                "UPDATE business_favorite SET version=version+2 WHERE user_id=$1 AND business_id=$2",
                [alice.user.id, business],
              ),
            (error) => error.code === "23514",
          );
          await assert.rejects(
            () =>
              pool.query(
                "UPDATE business_favorite SET user_id=$1,version=version+1 WHERE user_id=$2 AND business_id=$3",
                [bob.user.id, alice.user.id, business],
              ),
            (error) => error.code === "23514",
          );
          assert.equal(
            (await service.states(alice.headers, [business])).items[0].version,
            saved.version,
          );
        },
      );
      await t.test("HTTP enforces same-origin JSON and no-store without a mutation", async () => {
        const response = await http(
          new Request(`${baseURL}/api/favorites/businesses/${business}`, {
            method: "PUT",
            headers: {
              ...Object.fromEntries(alice.headers),
              origin: "https://foreign.invalid",
              "content-type": "application/json",
            },
            body: JSON.stringify(command(false, saved.version)),
          }),
        );
        assert.equal(response.status, 403);
        const read = await http(
          new Request(`${baseURL}/api/favorites?page=1`, { headers: alice.headers }),
        );
        assert.equal(read.status, 200);
        assert.equal(read.headers.get("Cache-Control"), "no-store");
        assert.equal((await read.json()).items.length, 20);
      });
      await t.test(
        "session revoked while waiting on authority locks cannot persist a favorite",
        async () => {
          const lock = await pool.connect();
          await lock.query("BEGIN");
          await lock.query("SELECT id FROM auth_user WHERE id=$1 FOR UPDATE", [bob.user.id]);
          const pending = service.set(bob.headers, business, command(true, 0));
          let waited = false;
          try {
            for (let n = 0; n < 80; n++) {
              const row = (
                await pool.query(
                  "SELECT count(*)::integer AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1 AND wait_event_type='Lock'",
                  [applicationName],
                )
              ).rows[0];
              if (row.n > 0) {
                waited = true;
                break;
              }
              await delay(10);
            }
            assert.equal(waited, true);
            await lock.query("DELETE FROM auth_session WHERE id=$1", [bob.session.id]);
            await lock.query("COMMIT");
          } finally {
            try {
              await lock.query("ROLLBACK");
            } finally {
              lock.release();
            }
          }
          await denied(() => pending, 401, "AUTHENTICATION_REQUIRED");
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::integer AS n FROM business_favorite WHERE user_id=$1",
                [bob.user.id],
              )
            ).rows[0].n,
            0,
          );
        },
      );
      assert.equal(outbound, 0);
      assert.equal(captured.size, 4);
      assert.deepEqual(await outside(), baseline);
    } finally {
      globalThis.fetch = originalFetch;
      if (pool) await pool.end();
      if (created) {
        assert.match(schema, /^ci_favorites_[a-f0-9]{20}$/);
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
      }
      await administration.end();
    }
  });
}
