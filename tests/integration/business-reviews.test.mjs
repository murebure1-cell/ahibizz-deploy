import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { loadMigrations, runMigrations } from "../../scripts/migrate.mjs";
import { integrationConfiguration } from "./postgres.test.mjs";

const baseURL = "https://reviews-ci.ahibizz.invalid",
  password = "Reviews-only-fixture-password-994!";
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  test("real isolated business reviews, private authors, CAS and moderation", {
    timeout: 120000,
  }, async (t) => {
    const configuration = integrationConfiguration(process.env),
      suffix = randomBytes(10).toString("hex"),
      schema = `ci_reviews_${suffix}`,
      applicationName = `reviews-ci-${suffix}`;
    assert.match(schema, /^ci_reviews_[a-f0-9]{20}$/);
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
      assert.ok(migrations.some((row) => row.version === "0012_business_reviews.sql"));
      await runMigrations({ pool, migrations });
      assert.deepEqual(await runMigrations({ pool, migrations }), { applied: [] });
      globalThis.fetch = async () => {
        outbound++;
        throw new Error("No outbound network in isolated reviews test.");
      };
      const {
        createAuthService,
        createAccountService,
        bootstrapInitialOwner,
        readCurrentAuthUser,
      } = await import("../../src/server/auth/index.ts");
      const { createAuthHttpHandler } = await import("../../src/server/auth-http.ts");
      const { createReviewsService } = await import("../../src/server/reviews/index.ts");
      const { createReviewsHttpHandler } = await import("../../src/server/reviews-http.ts");
      const { businessReviewsProjection } = await import("../../src/server/reviews/projection.ts");
      const captured = new Map(),
        emails = ["admin", "business-owner", "alice", "bob"].map(
          (v) => `${v}@reviews-fixture.invalid`,
        );
      const auth = createAuthService({
        pool,
        baseURL,
        production: true,
        secret: `reviews-${randomBytes(32).toString("hex")}`,
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
        service = createReviewsService({ accounts, auth, pool }),
        http = createReviewsHttpHandler({ service, baseURL });
      const category = randomUUID(),
        business = randomUUID(),
        other = randomUUID();
      await pool.query("INSERT INTO directory_category(id,name,slug) VALUES($1,$2,$3)", [
        category,
        "Isolated reviews",
        "isolated-reviews",
      ]);
      for (const [id, who] of [
        [business, owner],
        [other, admin],
      ])
        await pool.query(
          "INSERT INTO directory_business(id,owner_user_id,title,category_id,status,published_at) VALUES($1,$2,'Isolated review business',$3,'published',now())",
          [id, who.user.id, category],
        );
      const input = (
        rating = 5,
        text = "Stvarno probno iskustvo.",
        version = 0,
        key = randomUUID(),
      ) => ({ rating, text, expectedVersion: version, idempotencyKey: key });
      const version = (value, key = randomUUID()) => ({
        expectedVersion: value,
        idempotencyKey: key,
      });
      const moderate = (hidden, value) => ({
        ...version(value),
        hidden,
        reason: hidden ? "Provjeren neprimjeren sadržaj." : "Ponovna provjera završena.",
      });
      const denied = (fn, status, code) =>
        assert.rejects(fn, (error) => error.status === status && (!code || error.code === code));
      const total = async (id = business) => (await service.list(id)).summary;
      let a, b;
      await t.test("public reads are empty, anonymous, and non-inserting", async () => {
        assert.deepEqual(await service.list(business), {
          items: [],
          page: 1,
          hasMore: false,
          summary: { count: 0, sum: 0 },
        });
        assert.equal(
          (await pool.query("SELECT count(*)::integer AS n FROM business_review")).rows[0].n,
          0,
        );
      });
      await t.test("anonymous and forged authority cannot mutate", async () => {
        await denied(
          () =>
            service.save(
              new Headers({ "x-user-id": alice.user.id, "x-role": "owner" }),
              business,
              input(),
            ),
          401,
        );
      });
      await t.test("owner role and ordinary business owner cannot self review", async () => {
        await denied(
          () => service.save(owner.headers, business, input()),
          403,
          "OWN_BUSINESS_REVIEW",
        );
        await denied(() => service.save(admin.headers, other, input()), 403, "OWN_BUSINESS_REVIEW");
        assert.equal((await service.own(owner.headers, business)).canReview, false);
      });
      await t.test("pending suspended and unverified actors cannot write", async () => {
        for (const patch of [
          "approval='pending'",
          "approval='suspended'",
          '"emailVerified"=false',
        ]) {
          await pool.query(`UPDATE auth_user SET ${patch} WHERE id=$1`, [alice.user.id]);
          await denied(() => service.save(alice.headers, business, input()), 403);
          await pool.query('UPDATE auth_user SET approval=$2,"emailVerified"=true WHERE id=$1', [
            alice.user.id,
            "approved",
          ]);
        }
      });
      await t.test(
        "private author writes one current row and receipt replay is identical",
        async () => {
          const command = input();
          a = await service.save(alice.headers, business, command);
          assert.deepEqual(await service.save(alice.headers, business, command), a);
          assert.equal(a.version, 1);
          assert.equal(
            (await pool.query("SELECT count(*)::integer AS n FROM business_review")).rows[0].n,
            1,
          );
          assert.equal(
            (await pool.query("SELECT count(*)::integer AS n FROM business_review_event")).rows[0]
              .n,
            1,
          );
          assert.deepEqual((await service.list(business)).items[0].author, {
            id: null,
            name: "Korisnik AhiBizza",
            photoVersion: null,
          });
        },
      );
      await t.test("public opt-in author appears without email birth date or role", async () => {
        await pool.query(
          "INSERT INTO personal_profile(user_id,version,is_public,birth_date) VALUES($1,1,true,'1990-01-01')",
          [bob.user.id],
        );
        b = await service.save(bob.headers, business, input(3));
        const listed = await service.list(business);
        assert.deepEqual(listed.summary, { count: 2, sum: 8 });
        const author = listed.items.find((r) => r.id === b.id).author;
        assert.deepEqual(author, { id: bob.user.id, name: bob.user.name, photoVersion: null });
        assert.equal(
          /email|birthDate|birth_date|owner_user_id/.test(JSON.stringify(listed)),
          false,
        );
      });
      await t.test("badges are counted from what an account has really done", async () => {
        const { readBadgeCounts } = await import("../../src/server/account-badges.ts");
        assert.equal(await readBadgeCounts(pool, "no-such-account"), null);
        const reviewer = await readBadgeCounts(pool, bob.user.id);
        assert.equal(reviewer.reviews, 1);
        assert.equal(reviewer.reviewedCategories, 1);
        assert.equal(reviewer.profileComplete, false);
        assert.equal(reviewer.saves, 0);
        assert.equal(reviewer.topRated, false);
        assert.equal(reviewer.visits, 0);
        assert.ok(reviewer.rank >= 1 && reviewer.rank <= 4);
        assert.ok(reviewer.joinedAt.includes("T"));
        const ranks = [];
        for (const actor of actors) ranks.push((await readBadgeCounts(pool, actor.user.id)).rank);
        assert.deepEqual([...ranks].sort(), [1, 2, 3, 4]);
        assert.equal((await readBadgeCounts(pool, owner.user.id)).topRated, false);
      });
      await t.test(
        "the owner answers a review, nobody else can, and the answer is public",
        async () => {
          const { listReviewReplies, saveReviewReply } = await import(
            "../../src/server/review-replies.ts"
          );
          assert.deepEqual(await listReviewReplies(pool, business), []);
          assert.equal(await saveReviewReply(pool, alice.user.id, b.id, "Nije moje."), false);
          assert.equal(await saveReviewReply(pool, admin.user.id, b.id, "Ni moje."), false);
          assert.equal(await saveReviewReply(pool, owner.user.id, randomUUID(), "Nema je."), false);
          assert.equal(
            await saveReviewReply(pool, owner.user.id, b.id, "Hvala na recenziji."),
            true,
          );
          assert.equal(await saveReviewReply(pool, owner.user.id, b.id, "Hvala, vidimo se."), true);
          const listed = await listReviewReplies(pool, business);
          assert.equal(listed.length, 1);
          assert.equal(listed[0].reviewId, b.id);
          assert.equal(listed[0].text, "Hvala, vidimo se.");
          assert.deepEqual(await listReviewReplies(pool, other), []);
          // An answer is shown only while its review is: hide the business and it is gone.
          await pool.query("UPDATE directory_business SET status='draft' WHERE id=$1", [business]);
          assert.deepEqual(await listReviewReplies(pool, business), []);
          assert.equal(await saveReviewReply(pool, owner.user.id, b.id, "Skriveno."), false);
          await pool.query("UPDATE directory_business SET status='published' WHERE id=$1", [
            business,
          ]);
          assert.equal(await saveReviewReply(pool, alice.user.id, b.id, ""), false);
          assert.equal((await listReviewReplies(pool, business)).length, 1);
          assert.equal(await saveReviewReply(pool, owner.user.id, b.id, ""), true);
          assert.deepEqual(await listReviewReplies(pool, business), []);
        },
      );
      await t.test(
        "turning profile private removes name and profile link immediately",
        async () => {
          await pool.query("UPDATE personal_profile SET is_public=false WHERE user_id=$1", [
            bob.user.id,
          ]);
          assert.deepEqual((await service.list(business)).items.find((r) => r.id === b.id).author, {
            id: null,
            name: "Korisnik AhiBizza",
            photoVersion: null,
          });
        },
      );
      await t.test("author can edit through CAS, stale commands conflict", async () => {
        a = await service.save(alice.headers, business, input(4, "Ispravljeno iskustvo.", 1));
        assert.equal(a.version, 2);
        await denied(
          () => service.save(alice.headers, business, input(1, "Staro", 1)),
          409,
          "VERSION_CONFLICT",
        );
        assert.deepEqual(await total(), { count: 2, sum: 7 });
      });
      await t.test(
        "same idempotency key with different intent never duplicates or changes rating",
        async () => {
          const key = randomUUID(),
            command = input(4, "Isto iskustvo.", 2, key);
          a = await service.save(alice.headers, business, command);
          await denied(
            () => service.save(alice.headers, business, { ...command, rating: 1 }),
            409,
            "IDEMPOTENCY_CONFLICT",
          );
          assert.equal((await service.own(alice.headers, business)).review.rating, 4);
        },
      );
      await t.test("two simultaneous first reviews produce one row and one conflict", async () => {
        const results = await Promise.allSettled([
          service.save(alice.headers, other, input(5)),
          service.save(alice.headers, other, input(4)),
        ]);
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        assert.equal(results.find((r) => r.status === "rejected").reason.code, "VERSION_CONFLICT");
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::integer AS n FROM business_review WHERE business_id=$1 AND author_user_id=$2",
              [other, alice.user.id],
            )
          ).rows[0].n,
          1,
        );
      });
      await t.test("simultaneous identical commands replay one persisted receipt", async () => {
        const command = input(4, "Dupli zahtjev.", 1),
          results = await Promise.all([
            service.save(alice.headers, other, command),
            service.save(alice.headers, other, command),
          ]);
        assert.deepEqual(results[0], results[1]);
        assert.equal(results[0].version, 2);
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::integer AS n FROM business_review_command WHERE actor_user_id=$1 AND request_id=$2",
              [alice.user.id, command.idempotencyKey],
            )
          ).rows[0].n,
          1,
        );
      });
      await t.test("withdraw is soft idempotent and excluded from aggregate", async () => {
        const command = version(a.version);
        a = await service.withdraw(alice.headers, business, command);
        assert.deepEqual(await service.withdraw(alice.headers, business, command), a);
        assert.equal((await service.own(alice.headers, business)).review.withdrawn, true);
        assert.deepEqual(await total(), { count: 1, sum: 3 });
        assert.equal(
          (
            await pool.query("SELECT count(*)::integer AS n FROM business_review WHERE id=$1", [
              a.id,
            ])
          ).rows[0].n,
          1,
        );
      });
      await t.test("author can restore withdrawn review on same row with fresh CAS", async () => {
        const id = a.id;
        a = await service.save(alice.headers, business, input(5, "Ponovo objavljeno.", a.version));
        assert.equal(a.id, id);
        assert.deepEqual(await total(), { count: 2, sum: 8 });
      });
      await t.test(
        "business owner cannot moderate another user rating or read admin list",
        async () => {
          await denied(
            () => service.moderate(owner.headers, a.id, moderate(true, a.version)),
            403,
            "OWNER_REQUIRED",
          );
          await denied(() => service.moderationList(owner.headers), 403, "OWNER_REQUIRED");
          await denied(
            () =>
              service.save(bob.headers, business, { ...input(), author_user_id: alice.user.id }),
            400,
          );
        },
      );
      await t.test(
        "admin hide is audited, idempotent, preserves rating and excludes summary",
        async () => {
          const command = moderate(true, a.version);
          a = await service.moderate(admin.headers, a.id, command);
          assert.deepEqual(await service.moderate(admin.headers, a.id, command), a);
          assert.deepEqual(await total(), { count: 1, sum: 3 });
          const own = (await service.own(alice.headers, business)).review;
          assert.equal(own.hidden, true);
          assert.equal(own.rating, 5);
          const event = (
            await pool.query(
              "SELECT reason,previous_rating,next_rating FROM business_review_event WHERE review_id=$1 AND action='hide'",
              [a.id],
            )
          ).rows[0];
          assert.equal(event.reason, command.reason);
          assert.equal(event.previous_rating, event.next_rating);
          assert.equal(
            (await service.moderationList(admin.headers)).items.find((r) => r.id === a.id).hidden,
            true,
          );
        },
      );
      await t.test(
        "author cannot bypass moderation by editing but can withdraw hidden review",
        async () => {
          await denied(
            () =>
              service.save(alice.headers, business, input(5, "Pokušaj zaobilaženja.", a.version)),
            403,
            "REVIEW_HIDDEN",
          );
          a = await service.withdraw(alice.headers, business, version(a.version));
          assert.deepEqual(await total(), { count: 1, sum: 3 });
        },
      );
      await t.test(
        "admin restores visibility without reversing author withdrawal or score",
        async () => {
          a = await service.moderate(admin.headers, a.id, moderate(false, a.version));
          assert.equal((await service.own(alice.headers, business)).review.withdrawn, true);
          assert.deepEqual(await total(), { count: 1, sum: 3 });
        },
      );
      await t.test(
        "directory summary projection and public list share exact visibility",
        async () => {
          const projected = (
            await pool.query(
              `SELECT ${businessReviewsProjection("b")} FROM directory_business b WHERE b.id=$1`,
              [business],
            )
          ).rows[0].reviews;
          assert.deepEqual(projected, await total());
        },
      );
      await t.test(
        "owner transfer excludes former customer review, admin housekeeping remains possible",
        async () => {
          const row = (await service.own(alice.headers, other)).review;
          await pool.query("UPDATE directory_business SET owner_user_id=$2 WHERE id=$1", [
            other,
            alice.user.id,
          ]);
          assert.deepEqual(await total(other), { count: 0, sum: 0 });
          await denied(
            () => service.save(alice.headers, other, input(5, "Vlastito", row.version)),
            403,
            "OWN_BUSINESS_REVIEW",
          );
          const hidden = await service.moderate(admin.headers, row.id, moderate(true, row.version));
          assert.equal(hidden.version, row.version + 1);
          await service.withdraw(alice.headers, other, version(hidden.version));
        },
      );
      await t.test(
        "unpublished and unapproved-owner businesses are not publicly readable or writable",
        async () => {
          await pool.query("UPDATE directory_business SET status='draft' WHERE id=$1", [business]);
          await denied(() => service.list(business), 404);
          await denied(
            () => service.save(bob.headers, business, input(4, "Nije javno", b.version)),
            404,
          );
          await pool.query("UPDATE directory_business SET status='published' WHERE id=$1", [
            business,
          ]);
          await pool.query("UPDATE auth_user SET approval='suspended' WHERE id=$1", [
            owner.user.id,
          ]);
          await denied(() => service.list(business), 404);
          await pool.query("UPDATE auth_user SET approval='approved' WHERE id=$1", [owner.user.id]);
        },
      );
      await t.test(
        "unapproved author disappears from public rows and aggregate immediately",
        async () => {
          await pool.query("UPDATE auth_user SET approval='suspended' WHERE id=$1", [bob.user.id]);
          assert.deepEqual(await total(), { count: 0, sum: 0 });
          await pool.query("UPDATE auth_user SET approval='approved' WHERE id=$1", [bob.user.id]);
          assert.deepEqual(await total(), { count: 1, sum: 3 });
        },
      );
      await t.test("actor binding rejects session-account changes", async () => {
        const h = new Headers(bob.headers);
        h.set("X-AhiBizz-Account-ID", alice.user.id);
        await denied(
          () => service.save(h, business, input(4, "Promijenjen nalog", b.version)),
          401,
          "ACCOUNT_IDENTITY_CHANGED",
        );
      });
      await t.test("real HTTP enforces CSRF without touching business state", async () => {
        const response = await http(
          new Request(`${baseURL}/api/reviews/businesses/${business}/own`, {
            method: "PUT",
            headers: {
              ...Object.fromEntries(bob.headers),
              origin: "https://evil.invalid",
              "content-type": "application/json",
            },
            body: JSON.stringify(input(1, "Ne smije", b.version)),
          }),
        );
        assert.equal(response.status, 403);
        assert.deepEqual(await total(), { count: 1, sum: 3 });
      });
      await t.test(
        "revoked session after a held authority lock cannot persist a review",
        async () => {
          const lock = await pool.connect();
          await lock.query("BEGIN");
          await lock.query("SELECT id FROM auth_user WHERE id=$1 FOR UPDATE", [bob.user.id]);
          const pending = service.save(
            bob.headers,
            business,
            input(1, "Opozvana sesija", b.version),
          );
          let waited = false;
          for (let n = 0; n < 80; n++) {
            const count = (
              await pool.query(
                "SELECT count(*)::integer AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1 AND wait_event_type='Lock'",
                [applicationName],
              )
            ).rows[0].n;
            if (count > 0) {
              waited = true;
              break;
            }
            await delay(10);
          }
          assert.equal(waited, true);
          await lock.query("DELETE FROM auth_session WHERE id=$1", [bob.session.id]);
          await lock.query("COMMIT");
          lock.release();
          await denied(() => pending, 401, "AUTHENTICATION_REQUIRED");
          assert.deepEqual(await total(), { count: 1, sum: 3 });
        },
      );
      assert.equal(outbound, 0);
      assert.equal(captured.size, 4);
      assert.deepEqual(await outside(), baseline);
    } finally {
      globalThis.fetch = originalFetch;
      if (pool) await pool.end();
      if (created) {
        assert.match(schema, /^ci_reviews_[a-f0-9]{20}$/);
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
