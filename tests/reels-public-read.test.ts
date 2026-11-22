import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { readAuthConfiguration } from "../src/server/auth/config";
import { createDatabase } from "../src/server/db";
import {
  listPublicReels,
  readPublicReel,
  readReelFeed,
  reelMediaAccess,
} from "../src/server/reels/service";

const id = "11111111-1111-4111-8111-111111111111";
const businessId = "22222222-2222-4222-8222-222222222222";
const environment = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://fixture:fixture-only@127.0.0.1/ahibizz_ci?sslmode=disable",
};
const reel = {
  id,
  businessId,
  businessTitle: "Public fixture",
  city: null,
  title: "Clip",
  caption: "",
  durationMs: 3000,
  hasPoster: true,
  publishedAt: "2026-01-01T00:00:00Z",
  businessLogo: null,
};
function fixture() {
  let connections = 0;
  const queries: { sql: string; values: unknown[] }[] = [];
  const database = createDatabase({
    environment: () => environment,
    createPool: () => ({
      async connect() {
        connections++;
        return {
          async query(sql: string, values: unknown[] = []) {
            queries.push({ sql, values });
            return {
              rows: sql.includes("substring(p.bytes")
                ? [{ bytes: Buffer.from([1, 2, 3]) }]
                : sql.includes(" AS size ")
                  ? [{ size: 3 }]
                  : sql.startsWith("WITH anchors")
                    ? [{ ...reel, phase: 0, orderedAt: new Date(reel.publishedAt) }]
                    : [reel],
            };
          },
          release() {},
        };
      },
      async end() {},
    }),
  });
  return { database, queries, connections: () => connections };
}

test("public Reel catalog, detail, feed and media use only a lazy database without SMTP", async () => {
  assert.equal(readAuthConfiguration(environment), null);
  const f = fixture();
  assert.equal(f.connections(), 0);
  assert.deepEqual(await listPublicReels(null, 6, 0, null, f.database), [reel]);
  assert.deepEqual(await readPublicReel(id, null, f.database), reel);
  assert.deepEqual(await readReelFeed(id, null, null, id, f.database), {
    items: [reel],
    next: null,
  });
  const media = await reelMediaAccess(new Headers(), id, "video", false, f.database);
  assert.equal(media.size, 3);
  assert.deepEqual(await media.slice(0, 0, 3), new Uint8Array([1, 2, 3]));
  assert.equal(f.connections(), 5);
  assert.ok(f.queries.every(({ sql }) => /^\s*(SELECT|WITH)\b/.test(sql)));
  for (const { sql } of f.queries) {
    assert.match(sql, /r\.status='published'/);
    assert.match(sql, /b\.status='published'/);
    assert.match(sql, /b\.owner_user_id=r\.submitted_by/);
    assert.match(sql, /package_allows_listing\(b\)/);
    assert.match(sql, /u\.approval='approved'/);
    assert.match(sql, /u\."emailVerified"/);
  }
});

test("invalid and unavailable public reads neither query nor enter private services", async () => {
  const f = fixture();
  assert.deepEqual(await listPublicReels("invalid", 6, 0, null, f.database), []);
  assert.equal(await readPublicReel("invalid", null, f.database), null);
  await assert.rejects(readReelFeed("invalid", null, null, id, f.database), { status: 404 });
  await assert.rejects(reelMediaAccess(new Headers(), "invalid", "video", false, f.database), {
    status: 404,
  });
  assert.deepEqual(await listPublicReels(null, 6, 0, null, null), []);
  assert.equal(await readPublicReel(id, null, null), null);
  await assert.rejects(readReelFeed(id, null, null, id, null), { status: 503 });
  await assert.rejects(reelMediaAccess(new Headers(), id, "video", false, null), { status: 503 });
  assert.equal(f.connections(), 0);
});

test("preview media and management keep the cold authentication boundary", () => {
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !/^(DATABASE_|BETTER_AUTH|SMTP_|AHIBIZZ_|PG)/.test(key),
      ),
    ),
    NODE_ENV: "test" as const,
  };
  const program = `
    import assert from 'node:assert/strict';
    import { manageReels, reelMediaAccess, applyReelCommand } from './src/server/reels/service.ts';
    let reads=0;
    const fake={async query(){reads++;return {rows:[{size:3}]}}};
    await assert.rejects(reelMediaAccess(new Headers(),'${id}','video',true,fake),{status:503,code:'REEL_UNAVAILABLE'});
    await assert.rejects(manageReels(new Headers(),true),{status:503,code:'REEL_UNAVAILABLE'});
    await assert.rejects(applyReelCommand(new Headers(),'${id}',{action:'approve'}),{status:401,code:'AUTHENTICATION_REQUIRED'});
    assert.equal(reads,0);
  `;
  execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", program], {
    cwd: process.cwd(),
    env,
    windowsHide: true,
    stdio: "pipe",
    timeout: 20000,
  });
});
