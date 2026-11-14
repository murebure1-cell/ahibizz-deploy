import assert from "node:assert/strict";
import test from "node:test";

const { integrationConfiguration } = await import(
  new URL("./integration/postgres.test.mjs", import.meta.url).href
);
const target = "postgresql://ahibizz_ci:ci_fixture_only@127.0.0.1:5432/ahibizz_ci?sslmode=disable";

test("PostgreSQL integration only admits the explicit local CI role and database", () => {
  const configuration = integrationConfiguration({ CI: "true", AHIBIZZ_TEST_DATABASE_URL: target });
  assert.equal(configuration.max, 5);
  assert.equal(configuration.statement_timeout, 30000);
  assert.equal(configuration.query_timeout, 35000);
  assert.equal(
    integrationConfiguration({
      CI: "true",
      AHIBIZZ_TEST_DATABASE_URL: target.replace("127.0.0.1", "localhost"),
    }).ssl,
    false,
  );
  for (const env of [
    { CI: "true", DATABASE_URL: target },
    { CI: "false", AHIBIZZ_TEST_DATABASE_URL: target },
    { CI: "true", AHIBIZZ_TEST_DATABASE_URL: target.replace("127.0.0.1", "db.example.invalid") },
    { CI: "true", AHIBIZZ_TEST_DATABASE_URL: target.replace("/ahibizz_ci?", "/production?") },
    { CI: "true", AHIBIZZ_TEST_DATABASE_URL: target.replace("//ahibizz_ci:", "//postgres:") },
    { CI: "true", AHIBIZZ_TEST_DATABASE_URL: "not a database URL" },
  ])
    assert.throws(() => integrationConfiguration(env));
});
