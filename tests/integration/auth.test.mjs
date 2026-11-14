import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { loadMigrations, runMigrations } from "../../scripts/migrate.mjs";
import { integrationConfiguration } from "./postgres.test.mjs";

const baseURL = "https://auth-ci.ahibizz.invalid";
const email = "member@auth-fixture.invalid";
const pendingEmail = "pending@auth-fixture.invalid";
const password = "Only-a-fixture-password-194!";
const replacementPassword = "Replacement-fixture-password-295!";

class Cookies {
  values = new Map();

  read(response) {
    for (const line of response.headers.getSetCookie()) {
      const pair = line.split(";", 1)[0];
      const equals = pair.indexOf("=");
      const key = pair.slice(0, equals);
      const value = pair.slice(equals + 1);
      if (!value || /(?:^|;)\s*max-age=0(?:;|$)/i.test(line)) this.values.delete(key);
      else this.values.set(key, value);
    }
  }

  header() {
    return [...this.values].map(([key, value]) => `${key}=${value}`).join("; ");
  }

  clone() {
    const result = new Cookies();
    result.values = new Map(this.values);
    return result;
  }
}

async function outsideTables(pool, schema) {
  return (
    await pool.query(
      "SELECT schemaname, tablename FROM pg_catalog.pg_tables WHERE schemaname !~ '^pg_' AND schemaname <> 'information_schema' AND schemaname <> $1 ORDER BY schemaname, tablename",
      [schema],
    )
  ).rows;
}

async function exactSessionWaiter(pool, blockerPid, settled) {
  const deadline = Date.now() + 750;
  while (Date.now() < deadline) {
    const waiting = (
      await pool.query(
        "SELECT xact_start FROM pg_stat_activity WHERE datname=current_database() AND application_name='ahibizz-auth-ci' AND wait_event_type='Lock' AND $1=ANY(pg_blocking_pids(pid))",
        [blockerPid],
      )
    ).rows;
    if (waiting.length === 1) return waiting[0].xact_start;
    assert.equal(settled(), false, "The account action must wait on the exact held session row.");
    await delay(10);
  }
  throw new Error("Account authority did not reach the held exact-session lock.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  test("real isolated Better Auth account and session lifecycle", { timeout: 90000 }, async (t) => {
    // Guard the destination before importing/constructing any authentication service.
    const configuration = integrationConfiguration(process.env);
    const schema = `ci_auth_${randomBytes(10).toString("hex")}`;
    assert.match(schema, /^ci_auth_[a-f0-9]{20}$/);
    const { Pool } = await import("pg");
    const administration = new Pool({ ...configuration, max: 1 });
    administration.on("error", () => {});
    let pool;
    let created = false;
    let outside;
    const originalFetch = globalThis.fetch;
    let outboundAttempts = 0;
    try {
      assert.deepEqual(
        (await administration.query("SELECT current_database() AS db, current_user AS role")).rows,
        [{ db: "ahibizz_ci", role: "ahibizz_ci" }],
      );
      assert.equal(
        (
          await administration.query(
            "SELECT count(*)::integer AS n FROM pg_namespace WHERE nspname = $1",
            [schema],
          )
        ).rows[0].n,
        0,
      );
      outside = await outsideTables(administration, schema);
      await administration.query(`CREATE SCHEMA "${schema}"`);
      created = true;
      pool = new Pool({
        ...configuration,
        max: 5,
        options: `-c search_path=${schema}`,
        application_name: "ahibizz-auth-ci",
      });
      pool.on("error", () => {});
      assert.equal((await pool.query("SELECT current_schema() AS name")).rows[0].name, schema);
      const migrations = await loadMigrations();
      assert.deepEqual(
        migrations.map((row) => row.version),
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
      assert.deepEqual(await runMigrations({ pool, migrations }), {
        applied: migrations.map((row) => row.version),
      });
      assert.deepEqual(await runMigrations({ pool, migrations }), { applied: [] });
      for (const table of [
        "auth_user",
        "auth_session",
        "auth_account",
        "auth_verification",
        "auth_rate_limit",
        "auth_account_preferences",
        "auth_account_audit",
      ]) {
        assert.equal(
          (await pool.query(`SELECT count(*)::integer AS n FROM ${table}`)).rows[0].n,
          0,
        );
      }

      // Requests dispatch in-process to the real library handler. No external fetch or SMTP is used.
      globalThis.fetch = async () => {
        outboundAttempts++;
        throw new Error("Outbound HTTP is not permitted in the authentication fixture.");
      };
      const {
        createAuthService,
        readCurrentAuthUser,
        createAccountService,
        bootstrapInitialOwner,
        AccountAccessError,
      } = await import("../../src/server/auth/index.ts");
      const mail = [];
      const auth = createAuthService({
        pool,
        baseURL,
        secret: `ci-only-${randomBytes(32).toString("hex")}`,
        production: true,
        sendEmail: async (message) => {
          assert.ok([email, pendingEmail].includes(message.to));
          assert.equal(new URL(message.url).origin, baseURL);
          assert.ok(["verification", "password-reset"].includes(message.kind));
          mail.push(message);
        },
      });
      const { createAuthHttpHandler } = await import("../../src/server/auth-http.ts");
      const http = createAuthHttpHandler({
        auth,
        baseURL,
        readUser: (id) => readCurrentAuthUser(pool, id),
      });
      const accounts = createAccountService({ auth, pool });
      const { createAccountHttpHandler } = await import("../../src/server/account-http.ts");
      const accountHttp = createAccountHttpHandler({ service: accounts, baseURL });
      const accountHeaders = (cookies) =>
        new Headers({ origin: baseURL, cookie: cookies.header() });
      const denied = (operation, status, code) =>
        assert.rejects(
          operation,
          (error) =>
            error instanceof AccountAccessError &&
            error.status === status &&
            (!code || error.code === code),
        );
      async function request(method, route, { body, cookies, origin = baseURL } = {}) {
        const url = new URL(route, baseURL);
        assert.equal(url.origin, baseURL);
        const headers = new Headers({
          origin,
          "user-agent": "AhiBizz isolated authentication test",
        });
        if (body !== undefined) headers.set("content-type", "application/json");
        if (cookies?.header()) headers.set("cookie", cookies.header());
        const handler = url.pathname.startsWith("/api/auth/") ? http : accountHttp;
        const response = await handler(
          new Request(url, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        );
        cookies?.read(response);
        const data =
          (response.status < 300 || response.status >= 400) &&
          response.headers.get("content-type")?.includes("application/json")
            ? await response.clone().json()
            : null;
        assert.equal(response.headers.get("cache-control"), "no-store");
        if (response.ok && method === "POST") assert.deepEqual(data, { ok: true });
        assert.doesNotMatch(
          JSON.stringify(data),
          /"(?:token|password|accessToken|refreshToken)"\s*:/,
        );
        return { response, data };
      }
      async function session(cookies) {
        const result = await request("GET", "/api/auth/get-session", { cookies });
        assert.equal(result.response.status, 200);
        return result.data;
      }
      async function users() {
        return (
          await pool.query(
            'SELECT id, email, "emailVerified", role, approval FROM auth_user ORDER BY id',
          )
        ).rows;
      }
      const insertSession = (id) =>
        pool.query(
          'INSERT INTO auth_session (id, "expiresAt", token, "userId") VALUES ($1, now() + interval \'1 day\', $2, $3) RETURNING id',
          [`db-probe-${randomBytes(12).toString("hex")}`, randomBytes(24).toString("hex"), id],
        );
      const ineligibleInsert = (id) =>
        assert.rejects(
          () => insertSession(id),
          (error) => error.code === "28000",
        );
      const first = new Cookies();
      const second = new Cookies();
      let userId;
      let passwordHash;

      await t.test("account HTTP reads require an authenticated session", async () => {
        assert.equal((await request("GET", "/api/account")).response.status, 401);
        assert.equal((await request("GET", "/api/admin/accounts")).response.status, 401);
      });

      await t.test(
        "forged authority is rejected before creation; signup stores a pending unverified member",
        async () => {
          const forged = await request("POST", "/api/auth/sign-up/email", {
            body: {
              name: "Fixture Member",
              email,
              password,
              role: "owner",
              approval: "approved",
              emailVerified: true,
            },
          });
          assert.equal(forged.response.status, 400);
          assert.deepEqual(await users(), []);
          assert.equal(mail.length, 0);
          const signup = await request("POST", "/api/auth/sign-up/email", {
            body: { name: "Fixture Member", email, password },
            cookies: first,
          });
          assert.equal(signup.response.status, 200);
          const rows = await users();
          assert.equal(rows.length, 1);
          userId = rows[0].id;
          assert.deepEqual(rows[0], {
            id: userId,
            email,
            emailVerified: false,
            role: "member",
            approval: "pending",
          });
          assert.equal(mail.length, 1);
          assert.equal(mail[0].kind, "verification");
          passwordHash = (
            await pool.query(
              'SELECT password FROM auth_account WHERE "userId" = $1 AND "providerId" = $2',
              [userId, "credential"],
            )
          ).rows[0].password;
          assert.equal(typeof passwordHash, "string");
          assert.ok(passwordHash.length > 32 && !passwordHash.includes(password));
          assert.equal(await session(first), null);
          await ineligibleInsert(userId);
          await pool.query("UPDATE auth_user SET approval = 'approved' WHERE id = $1", [userId]);
          await ineligibleInsert(userId);
          await pool.query("UPDATE auth_user SET approval = 'pending' WHERE id = $1", [userId]);
        },
      );

      await t.test(
        "verification changes the real user but neither unverified nor pending login creates a session",
        async () => {
          assert.equal(
            (
              await request("POST", "/api/auth/sign-in/email", {
                body: { email, password },
                cookies: first,
              })
            ).response.status,
            403,
          );
          const verified = await request("GET", mail[0].url, { cookies: first });
          assert.ok([200, 302].includes(verified.response.status));
          assert.equal((await users())[0].emailVerified, true);
          assert.equal((await users())[0].approval, "pending");
          await ineligibleInsert(userId);
          assert.equal(
            (
              await request("POST", "/api/auth/sign-in/email", {
                body: { email, password },
                cookies: first,
              })
            ).response.status,
            403,
          );
          assert.equal(
            (await pool.query("SELECT count(*)::integer AS n FROM auth_session")).rows[0].n,
            0,
          );
        },
      );

      await t.test(
        "fixture-only approval permits two independent sessions and fresh user reads",
        async () => {
          assert.equal(
            (await pool.query("UPDATE auth_user SET approval = 'approved' WHERE id = $1", [userId]))
              .rowCount,
            1,
          );
          const probe = await insertSession(userId);
          assert.equal(probe.rowCount, 1);
          assert.equal(
            (await pool.query("DELETE FROM auth_session WHERE id = $1", [probe.rows[0].id]))
              .rowCount,
            1,
          );
          assert.equal(
            (
              await request("POST", "/api/auth/sign-in/email", {
                body: { email, password },
                cookies: first,
              })
            ).response.status,
            200,
          );
          const original = await auth.api.getSession({ headers: accountHeaders(first) });
          const exposed = await session(first);
          assert.equal(exposed.user.id, userId);
          assert.deepEqual(Object.keys(exposed.session), ["expiresAt"]);
          assert.equal(original.user.id, userId);
          assert.equal(original.user.role, "member");
          const lifetime = new Date(original.session.expiresAt).getTime() - Date.now();
          assert.ok(lifetime > 29 * 86400000 && lifetime <= 30 * 86400000);
          assert.equal(
            (
              await request("POST", "/api/auth/sign-in/email", {
                body: { email, password },
                cookies: second,
              })
            ).response.status,
            200,
          );
          const additional = await auth.api.getSession({ headers: accountHeaders(second) });
          assert.notEqual(original.session.id, additional.session.id);
          assert.equal(
            (await auth.api.getSession({ headers: accountHeaders(first) })).session.id,
            original.session.id,
          );
          assert.equal((await readCurrentAuthUser(pool, userId)).approval, "approved");
          const profile = await accounts.read(accountHeaders(first));
          assert.equal(profile.id, userId);
          assert.deepEqual(
            Object.keys(profile).sort(),
            [
              "appearance",
              "approval",
              "email",
              "emailVerified",
              "id",
              "locale",
              "name",
              "role",
            ].sort(),
          );
          assert.equal(
            (await pool.query("SELECT count(*)::integer AS n FROM auth_session")).rows[0].n,
            2,
          );
        },
      );

      await t.test(
        "current-session authority fields and cross-origin logout are rejected",
        async () => {
          const forged = await request("POST", "/api/auth/update-user", {
            body: { role: "owner", approval: "approved", emailVerified: true },
            cookies: second,
          });
          assert.equal(forged.response.status, 404);
          assert.equal((await users())[0].role, "member");
          const csrf = await request("POST", "/api/auth/sign-out", {
            body: {},
            cookies: second,
            origin: "https://untrusted.invalid",
          });
          assert.equal(csrf.response.status, 403);
          assert.equal((await session(second)).user.id, userId);
        },
      );

      await t.test(
        "logout revokes its persisted session while the second session stays signed in",
        async () => {
          const staleCookie = first.clone();
          assert.equal(
            (await request("POST", "/api/auth/sign-out", { body: {}, cookies: first })).response
              .status,
            200,
          );
          assert.equal(await session(staleCookie), null);
          await denied(() => accounts.read(accountHeaders(staleCookie)), 401);
          assert.equal((await session(second)).user.id, userId);
          assert.equal(
            (await pool.query("SELECT count(*)::integer AS n FROM auth_session")).rows[0].n,
            1,
          );
        },
      );

      await t.test(
        "captured reset link is single-use, changes the hash and revokes existing sessions",
        async () => {
          const reset = await request("POST", "/api/auth/request-password-reset", {
            body: { email, redirectTo: `${baseURL}/reset-password` },
          });
          assert.equal(reset.response.status, 200);
          assert.equal(mail.length, 2);
          assert.equal(mail[1].kind, "password-reset");
          const callback = await request("GET", mail[1].url);
          assert.equal(callback.response.status, 302);
          const target = new URL(callback.response.headers.get("location"), baseURL);
          assert.equal(target.origin, baseURL);
          const token = target.searchParams.get("token");
          assert.ok(token);
          const changed = await request("POST", "/api/auth/reset-password", {
            body: { token, newPassword: replacementPassword },
          });
          assert.equal(changed.response.status, 200);
          const currentHash = (
            await pool.query(
              'SELECT password FROM auth_account WHERE "userId" = $1 AND "providerId" = $2',
              [userId, "credential"],
            )
          ).rows[0].password;
          assert.notEqual(currentHash, passwordHash);
          assert.ok(currentHash.length > 32 && !currentHash.includes(replacementPassword));
          assert.equal(await session(second), null);
          await denied(() => accounts.read(accountHeaders(second)), 401);
          assert.equal(
            (await pool.query("SELECT count(*)::integer AS n FROM auth_session")).rows[0].n,
            0,
          );
          assert.equal(
            (
              await request("POST", "/api/auth/reset-password", {
                body: { token, newPassword: password },
              })
            ).response.status,
            400,
          );
          assert.equal(
            (await request("POST", "/api/auth/sign-in/email", { body: { email, password } }))
              .response.status,
            401,
          );
          assert.equal(
            (
              await request("POST", "/api/auth/sign-in/email", {
                body: { email, password: replacementPassword },
                cookies: first,
              })
            ).response.status,
            200,
          );
          assert.equal((await session(first)).user.id, userId);
        },
      );
      await t.test(
        "member profile edits persist but authority and owner tools remain protected",
        async () => {
          const headers = accountHeaders(first);
          const response = await request("PATCH", "/api/account", {
            cookies: first,
            body: {
              name: "  Updated Member  ",
              locale: "en",
              appearance: "dark",
            },
          });
          assert.equal(response.response.status, 200);
          const updated = response.data.account;
          assert.equal(updated.name, "Updated Member");
          assert.equal(updated.locale, "en");
          assert.equal(updated.appearance, "dark");
          assert.equal(updated.role, "member");
          assert.equal(updated.approval, "approved");
          assert.deepEqual(await accounts.read(headers), updated);
          assert.deepEqual((await request("GET", "/api/account", { cookies: first })).data, {
            account: updated,
          });
          assert.equal(
            (await request("GET", "/api/admin/accounts", { cookies: first })).response.status,
            403,
          );
          assert.equal(
            (
              await request("PATCH", "/api/account", {
                cookies: first,
                origin: "https://untrusted.invalid",
                body: { name: "Rejected Name" },
              })
            ).response.status,
            403,
          );
          assert.equal((await accounts.read(headers)).name, "Updated Member");
          await denied(() => accounts.update(headers, { role: "owner" }), 400, "UNEXPECTED_FIELD");
          await denied(
            () => accounts.update(headers, { email: pendingEmail }),
            400,
            "UNEXPECTED_FIELD",
          );
          await denied(() => accounts.listPending(headers), 403, "OWNER_REQUIRED");
          await denied(
            () => accounts.decide(headers, userId, { approval: "suspended", expected: "approved" }),
            403,
            "OWNER_REQUIRED",
          );
          await pool.query("UPDATE auth_user SET approval = 'suspended' WHERE id = $1", [userId]);
          await denied(() => accounts.read(headers), 403, "ACCOUNT_SUSPENDED");
          await ineligibleInsert(userId);
          assert.equal(await session(first), null);
          await pool.query("UPDATE auth_user SET approval = 'approved' WHERE id = $1", [userId]);
          assert.equal((await accounts.read(headers)).approval, "approved");
        },
      );
      await t.test(
        "explicit fixture owner bootstrap and approval CAS enforce fresh authority and revoke sessions",
        async () => {
          const signup = await request("POST", "/api/auth/sign-up/email", {
            body: { name: "Pending Member", email: pendingEmail, password },
          });
          assert.equal(signup.response.status, 200);
          assert.equal(mail.length, 3);
          assert.equal(mail[2].kind, "verification");
          assert.ok([200, 302].includes((await request("GET", mail[2].url)).response.status));
          const pendingId = (
            await pool.query("SELECT id FROM auth_user WHERE email = $1", [pendingEmail])
          ).rows[0].id;
          const owner = await bootstrapInitialOwner(pool, email);
          assert.equal(owner.role, "owner");
          await denied(() => accounts.read(accountHeaders(first)), 401);
          await denied(
            () => bootstrapInitialOwner(pool, pendingEmail),
            409,
            "OWNER_ALREADY_EXISTS",
          );
          assert.equal(
            (
              await request("POST", "/api/auth/sign-in/email", {
                body: { email, password: replacementPassword },
                cookies: first,
              })
            ).response.status,
            200,
          );
          const ownerHeaders = accountHeaders(first);
          const list = await accounts.listPending(ownerHeaders);
          assert.equal(list.limit, 100);
          assert.equal(list.truncated, false);
          assert.equal(list.accounts.length, 1);
          assert.equal(list.accounts[0].id, pendingId);
          assert.deepEqual(
            Object.keys(list.accounts[0]).sort(),
            [
              "appearance",
              "approval",
              "email",
              "emailVerified",
              "id",
              "locale",
              "name",
              "role",
            ].sort(),
          );
          await denied(
            () =>
              accounts.decide(ownerHeaders, owner.id, {
                approval: "suspended",
                expected: "approved",
              }),
            403,
            "OWNER_TARGET_FORBIDDEN",
          );
          assert.equal(
            (
              await accounts.decide(ownerHeaders, pendingId, {
                approval: "approved",
                expected: "pending",
              })
            ).approval,
            "approved",
          );
          await denied(
            () =>
              accounts.decide(ownerHeaders, pendingId, {
                approval: "approved",
                expected: "pending",
              }),
            409,
            "APPROVAL_CONFLICT",
          );
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::integer AS n FROM auth_account_audit WHERE target_user_id = $1",
                [pendingId],
              )
            ).rows[0].n,
            1,
          );
          const member = new Cookies();
          assert.equal(
            (
              await request("POST", "/api/auth/sign-in/email", {
                body: { email: pendingEmail, password },
                cookies: member,
              })
            ).response.status,
            200,
          );
          assert.equal((await accounts.read(accountHeaders(member))).approval, "approved");
          await denied(() => accounts.listPending(accountHeaders(member)), 403, "OWNER_REQUIRED");
          assert.equal(
            (
              await accounts.decide(ownerHeaders, pendingId, {
                approval: "suspended",
                expected: "approved",
              })
            ).approval,
            "suspended",
          );
          await denied(() => accounts.read(accountHeaders(member)), 401);
          assert.equal(await session(member), null);
          assert.equal(
            (
              await request("POST", "/api/auth/sign-in/email", {
                body: { email: pendingEmail, password },
                cookies: member,
              })
            ).response.status,
            403,
          );
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::integer AS n FROM auth_account_audit WHERE target_user_id = $1",
                [pendingId],
              )
            ).rows[0].n,
            2,
          );
        },
      );
      await t.test(
        "owner account pages filter all states, escape literal search and retain safe moderation",
        async () => {
          for (const [approval, count] of [
            ["pending", 105],
            ["approved", 31],
            ["suspended", 2],
          ]) {
            await pool.query(
              `INSERT INTO auth_user(id,name,email,"emailVerified",role,approval,"createdAt","updatedAt")
               SELECT $1::text||lpad(n::text,3,'0'),'Fixture listing '||$2::text||' '||lpad(n::text,3,'0'),
               $1::text||lpad(n::text,3,'0')||'@auth-fixture.invalid',true,'member',$2,
               '2000-01-01'::timestamptz,'2000-01-01'::timestamptz FROM generate_series(0,$3::integer-1) n`,
              [`listing-${approval}-`, approval, count],
            );
          }
          const literalRows = [
            ["listing-literal-match", "Needle %_!\\", "literal-match@auth-fixture.invalid"],
            ["listing-literal-wildcard", "Needle ABC!\\", "literal-wildcard@auth-fixture.invalid"],
            ["listing-email-match", "Email only", "literal%_!@auth-fixture.invalid"],
          ];
          for (const [id, name, address] of literalRows)
            await pool.query(
              `INSERT INTO auth_user(id,name,email,"emailVerified",role,approval) VALUES($1,$2,$3,true,'member','pending')`,
              [id, name, address],
            );
          const page = async (approval, number, q) => {
            const query = new URLSearchParams({ approval, page: String(number) });
            if (q !== undefined) query.set("q", q);
            const result = await request("GET", `/api/admin/accounts?${query}`, { cookies: first });
            assert.equal(result.response.status, 200);
            assert.deepEqual(Object.keys(result.data).sort(), [
              "accounts",
              "approval",
              "hasMore",
              "limit",
              "page",
            ]);
            assert.equal(result.data.approval, approval);
            assert.equal(result.data.page, number);
            assert.equal(result.data.limit, 30);
            for (const account of result.data.accounts) {
              assert.equal(account.approval, approval);
              assert.deepEqual(Object.keys(account).sort(), [
                "appearance",
                "approval",
                "email",
                "emailVerified",
                "id",
                "locale",
                "name",
                "role",
              ]);
            }
            return result.data;
          };
          const ids = [];
          for (let number = 1; number <= 4; number++) {
            const result = await page("pending", number, "Fixture listing");
            assert.equal(result.accounts.length, number < 4 ? 30 : 15);
            assert.equal(result.hasMore, number < 4);
            ids.push(...result.accounts.map((account) => account.id));
          }
          assert.deepEqual(
            ids,
            Array.from({ length: 105 }, (_, n) => `listing-pending-${String(n).padStart(3, "0")}`),
          );
          assert.deepEqual((await page("pending", 5, "Fixture listing")).accounts, []);
          assert.equal((await page("pending", 5, "Fixture listing")).hasMore, false);
          const approvedFirst = await page("approved", 1, "Fixture listing");
          assert.equal(approvedFirst.accounts.length, 30);
          assert.equal(approvedFirst.hasMore, true);
          assert.equal((await page("approved", 2, "Fixture listing")).accounts.length, 1);
          assert.equal((await page("suspended", 1, "Fixture listing")).accounts.length, 2);
          assert.deepEqual(
            (await page("pending", 1, "%_!")).accounts.map((account) => account.id).sort(),
            ["listing-email-match", "listing-literal-match"],
          );
          assert.deepEqual(
            (await page("pending", 1, "!\\")).accounts.map((account) => account.id).sort(),
            ["listing-literal-match", "listing-literal-wildcard"],
          );
          assert.equal(
            (await page("pending", 1, "LITERAL-MATCH@AUTH-FIXTURE.INVALID")).accounts[0].id,
            "listing-literal-match",
          );
          assert.deepEqual((await page("pending", 1, "' OR true --")).accounts, []);
          const legacy = await request("GET", "/api/admin/accounts", { cookies: first });
          assert.equal(legacy.data.accounts.length, 100);
          assert.equal(legacy.data.limit, 100);
          assert.equal(legacy.data.truncated, true);
          const owner = (await page("approved", 1, email)).accounts[0];
          assert.equal(owner.role, "owner");
          assert.equal(
            (
              await request("PATCH", `/api/admin/accounts/${owner.id}`, {
                cookies: first,
                body: { approval: "suspended", expected: "approved" },
              })
            ).response.status,
            403,
          );
          const targetId = (
            await pool.query("SELECT id FROM auth_user WHERE email=$1", [pendingEmail])
          ).rows[0].id;
          assert.equal(
            (
              await request("PATCH", `/api/admin/accounts/${targetId}`, {
                cookies: first,
                body: { approval: "approved", expected: "suspended" },
              })
            ).response.status,
            200,
          );
          const member = new Cookies();
          assert.equal(
            (
              await request("POST", "/api/auth/sign-in/email", {
                cookies: member,
                body: { email: pendingEmail, password },
              })
            ).response.status,
            200,
          );
          const privatePath = "/api/admin/accounts?approval=approved&page=1";
          const nonowner = await request("GET", privatePath, { cookies: member });
          assert.equal(nonowner.response.status, 403);
          assert.equal(nonowner.data.code, "OWNER_REQUIRED");
          assert.equal(
            (
              await request("PATCH", `/api/admin/accounts/${targetId}`, {
                cookies: first,
                body: { approval: "suspended", expected: "approved" },
              })
            ).response.status,
            200,
          );
          const revoked = await request("GET", privatePath, { cookies: member });
          assert.equal(revoked.response.status, 401);
          assert.equal(revoked.data.code, "AUTHENTICATION_REQUIRED");
        },
      );
      await t.test(
        "account read, update, admin list and decision reject expiry during the exact session-row wait",
        async () => {
          const headers = accountHeaders(first);
          const current = await auth.api.getSession({
            headers,
            query: { disableCookieCache: true, disableRefresh: true },
          });
          assert.equal(current.user.role, "owner");
          const target = (
            await pool.query("SELECT id, approval FROM auth_user WHERE email=$1", [pendingEmail])
          ).rows[0];
          assert.equal(target.approval, "suspended");
          const snapshot = async () => ({
            users: (
              await pool.query(
                'SELECT id,name,"emailVerified",role,approval,"updatedAt" FROM auth_user ORDER BY id',
              )
            ).rows,
            preferences: (
              await pool.query("SELECT * FROM auth_account_preferences ORDER BY user_id")
            ).rows,
            profiles: (await pool.query("SELECT * FROM personal_profile ORDER BY user_id")).rows,
            audit: (await pool.query("SELECT * FROM auth_account_audit ORDER BY id")).rows,
          });
          const actions = [
            ["read", () => request("GET", "/api/account", { cookies: first })],
            [
              "update",
              () =>
                request("PATCH", "/api/account", {
                  cookies: first,
                  body: { name: "Must not save after session expiry" },
                }),
            ],
            ["admin list", () => request("GET", "/api/admin/accounts", { cookies: first })],
            [
              "filtered admin list",
              () =>
                request("GET", "/api/admin/accounts?approval=approved&page=1", { cookies: first }),
            ],
            [
              "admin decision",
              () =>
                request("PATCH", `/api/admin/accounts/${target.id}`, {
                  cookies: first,
                  body: { approval: "approved", expected: "suspended" },
                }),
            ],
          ];
          for (const [label, action] of actions) {
            const before = await snapshot();
            const expiry = (
              await pool.query(
                `UPDATE auth_session SET "expiresAt"=clock_timestamp()+interval '500 milliseconds' WHERE id=$1 AND "userId"=$2 AND token=$3 RETURNING "expiresAt"`,
                [current.session.id, current.user.id, current.session.token],
              )
            ).rows[0].expiresAt;
            const locker = await pool.connect();
            let pending;
            let settled = false;
            try {
              await locker.query("BEGIN");
              await locker.query("SELECT id FROM auth_session WHERE id=$1 FOR UPDATE", [
                current.session.id,
              ]);
              const blockerPid = (await locker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
              pending = action().then(
                (value) => {
                  settled = true;
                  return { value };
                },
                (error) => {
                  settled = true;
                  return { error };
                },
              );
              const transactionStart = await exactSessionWaiter(pool, blockerPid, () => settled);
              assert.ok(
                expiry > transactionStart,
                `${label}: session was valid at transaction start`,
              );
              // The tuple stays unchanged; its real expiry passes while its row is locked.
              await pool.query(
                "SELECT pg_sleep(greatest(0,extract(epoch from ($1::timestamptz-clock_timestamp())))+0.03)",
                [expiry],
              );
              assert.equal(settled, false, `${label}: the exact session lock is still held`);
            } finally {
              await locker.query("ROLLBACK");
              locker.release();
            }
            try {
              const outcome = await pending;
              assert.equal(outcome.error, undefined, label);
              assert.equal(outcome.value.response.status, 401, label);
              assert.equal(outcome.value.data.code, "AUTHENTICATION_REQUIRED", label);
              assert.deepEqual(
                await snapshot(),
                before,
                `${label}: no account/profile/audit change`,
              );
              assert.equal(
                (
                  await pool.query('SELECT "expiresAt" FROM auth_session WHERE id=$1', [
                    current.session.id,
                  ])
                ).rows[0].expiresAt.getTime(),
                expiry.getTime(),
                `${label}: service preflight did not refresh the session`,
              );
            } finally {
              await pool.query(
                `UPDATE auth_session SET "expiresAt"=clock_timestamp()+interval '1 day' WHERE id=$1`,
                [current.session.id],
              );
            }
          }
        },
      );
      assert.ok(
        (await pool.query("SELECT count(*)::integer AS n FROM auth_rate_limit")).rows[0].n > 0,
      );
      assert.equal(outboundAttempts, 0);
      assert.deepEqual(await outsideTables(administration, schema), outside);
    } finally {
      globalThis.fetch = originalFetch;
      try {
        if (pool) await pool.end();
        if (created) {
          const owner = (
            await administration.query(
              "SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname = $1",
              [schema],
            )
          ).rows[0]?.owner;
          assert.equal(
            owner,
            "ahibizz_ci",
            "Only this test's newly created schema may be removed.",
          );
          await administration.query(`DROP SCHEMA "${schema}" CASCADE`);
          assert.equal(
            (
              await administration.query(
                "SELECT count(*)::integer AS n FROM pg_namespace WHERE nspname = $1",
                [schema],
              )
            ).rows[0].n,
            0,
          );
        }
      } finally {
        await administration.end();
      }
    }
  });
}
