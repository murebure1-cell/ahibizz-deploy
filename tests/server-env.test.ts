import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseConfigurationError, readDatabaseConfiguration } from "../src/server/env";

test("missing URL stays unconfigured without a default database", () => {
  assert.equal(readDatabaseConfiguration({}), null);
  assert.equal(readDatabaseConfiguration({ DATABASE_URL: "  " }), null);
});

test("PostgreSQL URL validation and explicit TLS never leak credentials", () => {
  const local = readDatabaseConfiguration({
    DATABASE_URL: "postgresql://developer@localhost:5432/ahibizz_next",
  });
  assert.equal(local?.ssl, false);
  assert.equal(local?.max, 5);
  const remote = readDatabaseConfiguration({
    DATABASE_URL: "postgres://app:fixture-password@db.example.invalid/ahibizz?sslmode=require",
  });
  assert.deepEqual(remote?.ssl, { rejectUnauthorized: true });
  assert.ok(remote);
  assert.equal(new URL(remote.connectionString).search, "");
  assert.equal(new URL(remote.connectionString).port, "5432");
  for (const url of [
    "https://app:fixture-password@db.example.invalid/db",
    "postgres://localhost/db",
    "postgres://app@localhost/",
    "postgres://app@localhost/db/other",
    "postgres://app@localhost:0/db",
    "postgres://app@localhost/db#fragment",
    "postgres://app@localhost/db?options=unsafe",
    "postgres://app@localhost/db?sslmode=prefer",
    "postgres://app@localhost/db?sslmode=",
    "postgres://app@localhost/db?sslmode=require&sslmode=disable",
    "postgres://app:encoded%0Apassword@localhost/db",
    "postgres://bad%zz@localhost/db",
    "postgres://app@localhost/db%2Fother",
  ]) {
    assert.throws(
      () => readDatabaseConfiguration({ DATABASE_URL: url }),
      (error) =>
        error instanceof DatabaseConfigurationError &&
        !error.message.includes("fixture-password") &&
        !error.message.includes(url),
    );
  }
  assert.throws(
    () =>
      readDatabaseConfiguration({
        DATABASE_URL: "postgres://app@localhost/db?sslmode=require",
        DATABASE_SSL_MODE: "disable",
      }),
    DatabaseConfigurationError,
  );
});
