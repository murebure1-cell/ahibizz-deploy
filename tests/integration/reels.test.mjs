import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { loadMigrations, runMigrations } from "../../scripts/migrate.mjs";
import { createReelEngagementService } from "../../src/server/reels/engagement.ts";
import { readReelFeed } from "../../src/server/reels/service.ts";
import { createSupportRequests } from "../../src/server/support-requests.ts";
import { integrationConfiguration } from "./postgres.test.mjs";

const secret = "test-reels-engagement-only-secret-0000001";

test("isolated Reel feed and engagement stay bounded, authorized, and idempotent", {
  timeout: 45000,
}, async (t) => {
  const config = integrationConfiguration(process.env);
  const schema = `ci_reels_${randomBytes(10).toString("hex")}`;
  const admin = new Pool({ ...config, max: 1 });
  let pool;
  let created = false;
  try {
    assert.deepEqual(
      (await admin.query("SELECT current_database() AS db,current_user AS role")).rows,
      [{ db: "ahibizz_ci", role: "ahibizz_ci" }],
    );
    await admin.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    pool = new Pool({ ...config, options: `-c search_path=${schema}` });
    assert.equal((await pool.query("SELECT current_schema() AS schema")).rows[0].schema, schema);
    const migrations = await loadMigrations();
    assert.ok(migrations.some((migration) => migration.version === "0050_reel_reports.sql"));
    assert.deepEqual(
      (await runMigrations({ pool, migrations })).applied,
      migrations.map((row) => row.version),
    );
    const accounts = ["fixture-one", "fixture-two", "fixture-viewer", "fixture-moderator"];
    const signed = new Map();
    for (const account of accounts) {
      await pool.query(
        "INSERT INTO auth_user(id,name,email,\"emailVerified\",approval,role) VALUES($1,$1,$2,true,'approved',$3)",
        [
          account,
          `${account}@fixture.invalid`,
          account === "fixture-moderator" ? "owner" : "member",
        ],
      );
      const session = { id: randomUUID(), token: randomUUID(), userId: account };
      await pool.query(
        'INSERT INTO auth_session(id,token,"userId","expiresAt") VALUES($1,$2,$3,clock_timestamp()+interval \'1 hour\')',
        [session.id, session.token, account],
      );
      signed.set(account, {
        session,
        user: { id: account },
      });
    }
    const auth = {
      api: {
        async getSession({ headers }) {
          const who = headers.get("cookie")?.match(/^fixture=(fixture-[a-z]+)(?:;|$)/)?.[1];
          return signed.get(who) ?? null;
        },
      },
    };
    const { readOrWrite } = createReelEngagementService(auth, pool, secret);
    const actor = new Headers({
      cookie: "fixture=fixture-viewer",
      "X-AhiBizz-Account-ID": "fixture-viewer",
    });
    const category = randomUUID();
    await pool.query(
      "INSERT INTO directory_category(id,slug,name) VALUES($1,'reels-test','Reels Test')",
      [category],
    );
    const studio = randomUUID();
    const otherStudio = randomUUID();
    const pendingStudio = randomUUID();
    for (const [business, owner, status] of [
      [studio, accounts[0], "published"],
      [otherStudio, accounts[1], "published"],
      [pendingStudio, accounts[1], "pending"],
    ]) {
      await pool.query(
        "INSERT INTO directory_business(id,owner_user_id,title,category_id,status) VALUES($1,$2,'Fixture', $3,$4)",
        [business, owner, category, status],
      );
    }
    const clips = [];
    for (let index = 0; index < 15; index++) {
      const id = randomUUID();
      const business = index % 2 ? studio : otherStudio;
      const at = new Date(Date.UTC(2026, 10, 19, 0, index)).toISOString();
      await pool.query(
        `INSERT INTO business_reel(id,business_id,submitted_by,title,status,source_size,duration_ms,
          has_poster,reviewed_at,published_at)
         VALUES($1,$2,$3,'Clip','published',32,3000,false,$4,$4)`,
        [id, business, index % 2 ? accounts[0] : accounts[1], at],
      );
      clips.unshift({ id, business });
    }
    const hidden = randomUUID();
    await pool.query(
      `INSERT INTO business_reel(id,business_id,submitted_by,title,status,source_size,duration_ms,
       has_poster,reviewed_at,published_at)
       VALUES($1,$2,$3,'Hidden reel','published',32,3000,false,clock_timestamp(),clock_timestamp())`,
      [hidden, pendingStudio, accounts[1]],
    );

    async function collect(origin, business = null, viewer = null) {
      let cursor = origin;
      const encountered = [];
      for (let page = 0; page < 5; page++) {
        const next = await readReelFeed(cursor, business, viewer, origin, pool);
        assert.ok(next.items.length <= 6);
        assert.ok(next.items.every((row) => row.id !== hidden && row.publishedAt.endsWith("Z")));
        encountered.push(...next.items.map(({ id }) => id));
        assert.equal(new Set(encountered).size, encountered.length);
        if (!next.next) return encountered;
        assert.equal(next.next, next.items.at(-1).id);
        cursor = next.next;
      }
      assert.fail("Fixture cursor should finish in at most five pages");
    }
    await t.test("the selected Reel continues older and then wraps once to the rest", async () => {
      const middle = 4;
      assert.deepEqual(
        await collect(clips[middle].id),
        [...clips.slice(middle + 1), ...clips.slice(0, middle)].map(({ id }) => id),
      );
      assert.deepEqual(
        await collect(clips.at(-1).id),
        clips.slice(0, -1).map(({ id }) => id),
      );
      assert.deepEqual(
        await collect(clips[1].id, studio),
        clips
          .filter((item) => item.business === studio && item.id !== clips[1].id)
          .map(({ id }) => id),
      );
      assert.deepEqual(await readReelFeed(randomUUID(), studio, null, randomUUID(), pool), {
        items: [],
        next: null,
      });
      assert.deepEqual(await readReelFeed(clips[0].id, studio, null, clips[0].id, pool), {
        items: [],
        next: null,
      });
    });

    await t.test(
      "one authenticated like is written despite retries and guest writes are rejected",
      async () => {
        const reel = clips[0].id;
        const initial = await readOrWrite(actor, reel, null, true);
        assert.deepEqual(initial, {
          stats: { views: 0, likes: 0, liked: false, canLike: true, accountId: accounts[2] },
          cookie: null,
        });
        const liked = await Promise.all(
          Array.from({ length: 4 }, () =>
            readOrWrite(actor, reel, { action: "like", liked: true }, true),
          ),
        );
        assert.ok(liked.every(({ stats }) => stats.likes === 1 && stats.liked));
        const guest = await readOrWrite(new Headers(), reel, null, true);
        assert.deepEqual(guest.stats, {
          views: 0,
          likes: 1,
          liked: false,
          canLike: false,
          accountId: null,
        });
        await assert.rejects(
          readOrWrite(new Headers(), reel, { action: "like", liked: true }, true),
          { status: 401, code: "AUTHENTICATION_REQUIRED" },
        );
        await assert.rejects(
          readOrWrite(
            new Headers({
              cookie: "fixture=fixture-viewer",
              "X-AhiBizz-Account-ID": "fixture-one",
            }),
            reel,
            { action: "like", liked: false },
            true,
          ),
          { status: 401, code: "ACCOUNT_IDENTITY_CHANGED" },
        );
        assert.equal(
          (await readOrWrite(actor, reel, { action: "like", liked: false }, true)).stats.likes,
          0,
        );
        await assert.rejects(readOrWrite(actor, hidden, null, true), { status: 404 });
        await assert.rejects(readOrWrite(actor, hidden, { action: "view" }, true), { status: 404 });
      },
    );

    await t.test("one browser or verified account counts once per clip and UTC day", async () => {
      const reel = clips[0].id;
      const now = Date.UTC(2026, 10, 21, 10);
      const eligible = await readOrWrite(new Headers(), reel, null, true, now);
      assert.match(eligible.cookie, /HttpOnly; SameSite=Lax; Secure$/);
      const guest = new Headers({ cookie: eligible.cookie.split(";")[0] });
      const sameDay = await Promise.all(
        Array.from({ length: 4 }, () => readOrWrite(guest, reel, { action: "view" }, true, now)),
      );
      assert.ok(sameDay.every(({ stats }) => stats.views === 1));
      const followingDay = now + 86_400_000;
      assert.equal(
        (await readOrWrite(guest, reel, { action: "view" }, true, followingDay)).stats.views,
        2,
      );
      assert.equal((await readOrWrite(actor, reel, { action: "view" }, true, now)).stats.views, 3);
      assert.equal((await readOrWrite(actor, reel, { action: "view" }, true, now)).stats.views, 3);
      assert.equal(
        (await readOrWrite(new Headers(), reel, { action: "view" }, true, now)).stats.views,
        3,
      );
      assert.equal(
        (await readOrWrite(guest, clips[1].id, { action: "view" }, true, now)).stats.views,
        1,
      );
    });

    await t.test(
      "discovery respects the viewer's block preference and a blocked account cannot like",
      async () => {
        await pool.query(
          "INSERT INTO people_block(actor_id,target_id,blocked) VALUES($1,$2,true)",
          [accounts[2], accounts[0]],
        );
        const result = await collect(clips[0].id, null, accounts[2]);
        assert.deepEqual(
          result,
          clips
            .slice(1)
            .filter((item) => item.business === otherStudio)
            .map(({ id }) => id),
        );
        assert.equal((await readOrWrite(actor, clips[1].id, null, true)).stats.canLike, false);
        await assert.rejects(
          readOrWrite(actor, clips[1].id, { action: "like", liked: true }, true),
          { status: 403, code: "REEL_LIKE_UNAVAILABLE" },
        );
      },
    );

    await t.test(
      "published, discoverable Reels can be reported once and resolved by an owner",
      async () => {
        const inbox = createSupportRequests(auth, pool);
        const moderator = new Headers({
          cookie: "fixture=fixture-moderator",
          "X-AhiBizz-Account-ID": "fixture-moderator",
        });
        const details = "Sadržaj za provjeru na izoliranim testnim podacima.";
        const reel = clips[0].id;
        await assert.rejects(inbox.submit(new Headers(), "reel", reel, details), { status: 401 });
        for (const id of [hidden, clips[1].id, randomUUID()]) {
          await assert.rejects(inbox.submit(actor, "reel", id, details), {
            status: 404,
            code: "REPORT_TARGET_UNAVAILABLE",
          });
        }
        await Promise.all(
          [reel, reel.toUpperCase()].map((id) => inbox.submit(actor, "reel", id, details)),
        );
        await assert.rejects(inbox.pending(actor, 0), { status: 403 });
        const { requests } = await inbox.pending(moderator, 0);
        assert.equal(requests.length, 1);
        assert.deepEqual(
          {
            subject: requests[0].subject,
            reference: requests[0].reference,
            details: requests[0].details,
          },
          { subject: "reel", reference: reel, details },
        );
        await assert.rejects(inbox.resolve(actor, requests[0].id), { status: 403 });
        await inbox.resolve(moderator, requests[0].id);
        assert.deepEqual((await inbox.pending(moderator, 0)).requests, []);
      },
    );
  } finally {
    await pool?.end();
    if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
