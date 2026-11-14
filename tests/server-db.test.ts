import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase, DatabaseNotConfiguredError, type DatabasePool } from "../src/server/db";
import type { DatabaseConfiguration } from "../src/server/env";

test("database creation and unconfigured reads never construct a connection pool", async () => {
  let created = 0;
  const db = createDatabase({
    environment: () => ({}),
    createPool: () => {
      created++;
      throw new Error("Must not create pool");
    },
  });
  assert.equal(created, 0);
  assert.equal(db.configured(), false);
  await assert.rejects(db.query("SELECT 1"), DatabaseNotConfiguredError);
  await db.close();
  assert.equal(created, 0);
});

test("one lazy bounded pool releases successful and failed clients", async () => {
  let created = 0,
    released = 0,
    ended = 0,
    fail = false;
  let observed: DatabaseConfiguration | undefined;
  const pool: DatabasePool = {
    async connect() {
      return {
        async query() {
          if (fail) throw new Error("query failed");
          return { rows: [{ value: 1 }] };
        },
        release() {
          released++;
        },
      };
    },
    async end() {
      ended++;
    },
    on() {},
  };
  const db = createDatabase({
    environment: () => ({ DATABASE_URL: "postgres://app@localhost/test" }),
    createPool: (config) => {
      created++;
      observed = config;
      return pool;
    },
  });
  assert.equal(created, 0);
  assert.equal(db.configured(), true);
  assert.equal(created, 0);
  assert.deepEqual((await db.query("SELECT $1", [1])).rows, [{ value: 1 }]);
  fail = true;
  await assert.rejects(db.query("SELECT 2"), /query failed/);
  assert.equal(created, 1);
  assert.equal(observed?.max, 5);
  assert.equal(observed?.connectionTimeoutMillis, 3000);
  assert.equal(released, 2);
  await db.close();
  assert.equal(ended, 1);
  await assert.rejects(db.query("SELECT 3"), /closed/);
});
