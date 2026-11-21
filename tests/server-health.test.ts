import assert from "node:assert/strict";
import test from "node:test";
import { GET as liveRoute } from "../src/app/api/health/live/route";
import { DatabaseConfigurationError } from "../src/server/env";
import { healthResponse, liveHealth, readyHealth } from "../src/server/health";

test("liveness is independent of database configuration and is not cached", async () => {
  assert.equal(liveHealth().status, 200);
  const response = liveRoute();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("readiness requires configuration and an applied schema without leaking errors", async () => {
  let queries = 0;
  const missing = await readyHealth({
    configured: () => false,
    async query() {
      queries++;
      return { rows: [] };
    },
  });
  assert.equal(missing.status, 503);
  assert.equal(queries, 0);
  const broken = await readyHealth({
    configured() {
      throw new DatabaseConfigurationError();
    },
    async query() {
      return { rows: [] };
    },
  });
  assert.equal(broken.body.checks?.database, "misconfigured");
  const secret = "postgres://user:fixture-password@private.example/db";
  const down = await readyHealth({
    configured: () => true,
    async query() {
      throw new Error(secret);
    },
  });
  assert.equal(down.status, 503);
  assert.equal(JSON.stringify(down).includes(secret), false);
  const uninitialized = await readyHealth({
    configured: () => true,
    async query() {
      return { rows: [] };
    },
  });
  assert.equal(uninitialized.status, 503);
  const ready = await readyHealth({
    configured: () => true,
    async query(sql, values) {
      assert.match(sql, /platform_migrations/);
      assert.deepEqual(values, ["0046_saved_searches.sql"]);
      return { rows: [{ ready: 1 }] };
    },
  });
  const response = healthResponse(ready);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
});
