import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { loadMigrations, runMigrations } from "../../scripts/migrate.mjs";
import { readAuthConfiguration } from "../../src/server/auth/config.ts";
import { createDatabase } from "../../src/server/db.ts";
import { createReelEngagementService } from "../../src/server/reels/engagement.ts";
import {
  expireReels,
  listPublicReels,
  readPublicReel,
  readReelAllowance,
  readReelFeed,
  reelMediaAccess,
  removePublishedReel,
} from "../../src/server/reels/service.ts";
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
      // Published within the last hour: a Reel is only shown during its first 24 hours.
      const at = new Date(Date.now() - (60 - index) * 60_000).toISOString();
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

    await t.test(
      "public Reel reads and byte slices remain visible without SMTP, and recheck eligibility",
      async () => {
        const environment = { DATABASE_URL: process.env.AHIBIZZ_TEST_DATABASE_URL };
        assert.equal(readAuthConfiguration(environment), null);
        const database = createDatabase({
          environment: () => environment,
          createPool: () => new Pool({ ...config, options: `-c search_path=${schema}` }),
        });
        try {
          const reel = clips[0];
          const owner = accounts[1];
          const video = Buffer.alloc(32, 65);
          await pool.query(
            "INSERT INTO business_reel_part(reel_id,part_index,bytes) VALUES($1,0,$2)",
            [reel.id, video],
          );
          const list = await listPublicReels(null, 30, 0, null, database);
          assert.equal(list.length, 15);
          assert.ok(list.every((item) => item.id !== hidden));
          assert.equal((await readPublicReel(reel.id, null, database)).id, reel.id);
          assert.ok((await readReelFeed(reel.id, null, null, reel.id, database)).items.length > 0);
          const media = await reelMediaAccess(new Headers(), reel.id, "video", false, database);
          assert.equal(media.size, 32);
          assert.deepEqual(Buffer.from(await media.slice(0, 5, 8)), video.subarray(5, 13));
          const childEnvironment = Object.fromEntries(
            Object.entries(process.env).filter(
              ([key]) => !/^(DATABASE_|BETTER_AUTH|SMTP_|AHIBIZZ_|PG)/.test(key),
            ),
          );
          execFileSync(
            process.execPath,
            [
              "--import",
              "tsx",
              "--input-type=module",
              "-e",
              `
          import assert from 'node:assert/strict';
          import { getDatabase } from './src/server/db.ts';
          import { readAuthConfiguration } from './src/server/auth/config.ts';
          import { listPublicReels, readPublicReel, reelMediaAccess, manageReels } from './src/server/reels/service.ts';
          try {
            assert.equal(readAuthConfiguration(), null);
            assert.equal((await listPublicReels(null,30)).length,15);
            assert.equal((await readPublicReel('${reel.id}')).id,'${reel.id}');
            const asset=await reelMediaAccess(new Headers(),'${reel.id}','video',false);
            assert.deepEqual(Buffer.from(await asset.slice(0,5,8)),Buffer.alloc(8,65));
            await assert.rejects(reelMediaAccess(new Headers(),'${reel.id}','video',true),{status:503,code:'REEL_UNAVAILABLE'});
            await assert.rejects(manageReels(new Headers(),true),{status:503,code:'REEL_UNAVAILABLE'});
          } finally { await getDatabase().close(); }
        `,
            ],
            {
              cwd: process.cwd(),
              env: {
                ...childEnvironment,
                NODE_ENV: "test",
                DATABASE_URL: process.env.AHIBIZZ_TEST_DATABASE_URL,
                PGOPTIONS: `-c search_path=${schema}`,
              },
              timeout: 20000,
              stdio: "pipe",
              windowsHide: true,
            },
          );
          await pool.query('UPDATE auth_user SET "emailVerified"=false WHERE id=$1', [owner]);
          assert.equal(await readPublicReel(reel.id, null, database), null);
          await assert.rejects(media.slice(0, 0, 4), { status: 404, code: "REEL_NOT_FOUND" });
          await pool.query('UPDATE auth_user SET "emailVerified"=true WHERE id=$1', [owner]);
          await pool.query("UPDATE directory_business SET status='pending' WHERE id=$1", [
            reel.business,
          ]);
          assert.equal(await readPublicReel(reel.id, null, database), null);
          await assert.rejects(reelMediaAccess(new Headers(), reel.id, "video", false, database), {
            status: 404,
          });
          await pool.query("UPDATE directory_business SET status='published' WHERE id=$1", [
            reel.business,
          ]);
          assert.equal((await readPublicReel(reel.id, null, database)).id, reel.id);
        } finally {
          await database.close();
        }
      },
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

    async function publishedReel(owner, business, publishedAt) {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO business_reel(id,business_id,submitted_by,title,status,source_size,duration_ms,
          has_poster,reviewed_at,published_at) VALUES($1,$2,$3,'Lifetime','published',32,3000,true,$4,$4)`,
        [id, business, owner, publishedAt],
      );
      await pool.query(
        "INSERT INTO business_reel_part(reel_id,part_index,bytes) VALUES($1,-1,$2),($1,0,$3)",
        [id, Buffer.alloc(16, 1), Buffer.alloc(32, 66)],
      );
      return id;
    }
    const partCount = async (id) =>
      (await pool.query("SELECT count(*)::int AS n FROM business_reel_part WHERE reel_id=$1", [id]))
        .rows[0].n;

    await t.test(
      "a Reel older than 24 hours is hidden at once, then the sweep expires it and deletes its media",
      async () => {
        const old = await publishedReel(
          accounts[0],
          studio,
          new Date(Date.now() - 25 * 3600_000).toISOString(),
        );
        const fresh = await publishedReel(
          accounts[0],
          studio,
          new Date(Date.now() - 23 * 3600_000).toISOString(),
        );
        // Hidden everywhere before any sweep: list, direct link, feed anchor and media bytes.
        assert.equal(await readPublicReel(old, null, pool), null);
        assert.ok((await listPublicReels(null, 100, 0, null, pool)).every(({ id }) => id !== old));
        assert.deepEqual(
          await readReelFeed(old, null, null, old, pool).then((page) =>
            page.items.some(({ id }) => id === old),
          ),
          false,
        );
        for (const kind of ["video", "poster"])
          await assert.rejects(reelMediaAccess(new Headers(), old, kind, false, pool), {
            status: 404,
          });
        assert.equal((await readPublicReel(fresh, null, pool)).id, fresh);

        // Package allowance (MojiReels): Basic counts this week's reels except returned ones.
        const allowance = await readReelAllowance(pool, accounts[0]);
        assert.equal(allowance.package, "basic");
        assert.equal(allowance.period, "week");
        assert.equal(allowance.limit, 1);
        assert.equal(allowance.week.length, 7);
        assert.equal(
          allowance.week.filter((day) => day === "today" || day === "done").length >= 1,
          true,
        );
        const counted = Number(
          (
            await pool.query(
              `SELECT count(*)::int AS n FROM business_reel WHERE submitted_by=$1 AND status<>'rejected'
                 AND (status<>'uploading' OR created_at>clock_timestamp()-interval '24 hours')
                 AND (created_at AT TIME ZONE 'Europe/Sarajevo') >= date_trunc('week', clock_timestamp() AT TIME ZONE 'Europe/Sarajevo')`,
              [accounts[0]],
            )
          ).rows[0].n,
        );
        assert.equal(allowance.used, counted);
        await pool.query(
          "INSERT INTO account_package(user_id,package,version) VALUES($1,'business',1)",
          [accounts[0]],
        );
        const daily = await readReelAllowance(pool, accounts[0]);
        assert.deepEqual([daily.package, daily.period, daily.limit], ["business", "day", 1]);
        await pool.query("DELETE FROM account_package WHERE user_id=$1", [accounts[0]]);

        const abandoned = randomUUID();
        await pool.query(
          `INSERT INTO business_reel(id,business_id,submitted_by,title,status,source_size,has_poster,created_at)
           VALUES($1,$2,$3,'Abandoned','uploading',32,false,clock_timestamp()-interval '25 hours')`,
          [abandoned, studio, accounts[0]],
        );
        await pool.query(
          "INSERT INTO business_reel_part(reel_id,part_index,bytes) VALUES($1,0,$2)",
          [abandoned, Buffer.alloc(32, 1)],
        );

        const first = await expireReels(pool);
        assert.ok(first.expired >= 1 && first.parts >= 2 && first.abandoned === 1);
        const row = (
          await pool.query("SELECT status,has_poster FROM business_reel WHERE id=$1", [old])
        ).rows[0];
        assert.deepEqual(row, { status: "expired", has_poster: false });
        assert.equal(await partCount(old), 0);
        assert.equal(
          (await pool.query("SELECT 1 FROM business_reel WHERE id=$1", [abandoned])).rowCount,
          0,
        );
        // The fresh Reel and its media are untouched, and a second sweep has nothing left to do.
        assert.equal(await partCount(fresh), 2);
        assert.equal((await readPublicReel(fresh, null, pool)).id, fresh);
        assert.deepEqual(await expireReels(pool), { expired: 0, parts: 0, abandoned: 0 });
        assert.equal(await readPublicReel(old, null, pool), null);
      },
    );

    await t.test(
      "a moderator removes one published Reel; its media is deleted and the link stops working",
      async () => {
        const target = await publishedReel(accounts[1], otherStudio, new Date().toISOString());
        const neighbour = await publishedReel(accounts[1], otherStudio, new Date().toISOString());
        const client = await pool.connect();
        try {
          assert.equal(
            await removePublishedReel(client, target, accounts[3], "Kršenje pravila zajednice"),
            "removed",
          );
          assert.equal(
            await removePublishedReel(client, target, accounts[3], "Ponovljeni zahtjev"),
            "removed",
          );
          const pendingReel = randomUUID();
          await client.query(
            `INSERT INTO business_reel(id,business_id,submitted_by,title,status,source_size,duration_ms,has_poster)
             VALUES($1,$2,$3,'Pending','pending',32,3000,false)`,
            [pendingReel, otherStudio, accounts[1]],
          );
          await assert.rejects(removePublishedReel(client, pendingReel, accounts[3], "x"), {
            status: 409,
          });
          await assert.rejects(removePublishedReel(client, randomUUID(), accounts[3], "x"), {
            status: 404,
          });
        } finally {
          client.release();
        }
        const row = (
          await pool.query(
            "SELECT status,review_reason,reviewed_by FROM business_reel WHERE id=$1",
            [target],
          )
        ).rows[0];
        assert.deepEqual(row, {
          status: "removed",
          review_reason: "Kršenje pravila zajednice",
          reviewed_by: accounts[3],
        });
        assert.equal(await partCount(target), 0);
        assert.equal(await readPublicReel(target, null, pool), null);
        await assert.rejects(reelMediaAccess(new Headers(), target, "video", false, pool), {
          status: 404,
        });
        assert.equal((await readPublicReel(neighbour, null, pool)).id, neighbour);
        // A removal always carries a moderator's reason.
        await assert.rejects(
          pool.query(
            "UPDATE business_reel SET status='removed',review_reason=NULL,reviewed_at=NULL WHERE id=$1",
            [neighbour],
          ),
          { code: "23514" },
        );
      },
    );
  } finally {
    await pool?.end();
    if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
