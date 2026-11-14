import assert from "node:assert/strict";
import test from "node:test";
import { AuthConfigurationError, readAuthConfiguration } from "../src/server/auth/config";

const fixture = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://ahibizz_ci:fixture-only@127.0.0.1:5432/ahibizz_ci?sslmode=disable",
  BETTER_AUTH_URL: "https://auth-fixture.invalid",
  BETTER_AUTH_SECRET: "fixture-only-secret-with-at-least-thirty-two-characters",
  SMTP_HOST: "smtp.fixture.invalid",
  SMTP_PORT: "465",
  SMTP_USER: "fixture-mailer",
  SMTP_PASSWORD: "fixture-only-mail-password",
  SMTP_FROM: "no-reply@fixture.invalid",
};

test("incomplete authentication configuration stays unavailable without a fallback", () => {
  assert.equal(readAuthConfiguration({}), null);
  for (const key of Object.keys(fixture).filter((key) => key !== "NODE_ENV")) {
    assert.equal(readAuthConfiguration({ ...fixture, [key]: "" }), null);
  }
});

test("complete authentication configuration validates a fixed origin and SMTP settings without connecting", () => {
  const configured = readAuthConfiguration(fixture);
  assert.ok(configured);
  assert.equal(configured.baseURL, fixture.BETTER_AUTH_URL);
  assert.equal(configured.production, true);
  assert.equal(configured.smtp.secure, true);
  assert.equal(configured.smtp.port, 465);
  assert.equal(configured.database.max, 5);
  assert.equal(readAuthConfiguration({ ...fixture, SMTP_PORT: "587" })?.smtp.secure, false);
  assert.equal(
    readAuthConfiguration({
      ...fixture,
      NODE_ENV: "development",
      BETTER_AUTH_URL: "http://127.0.0.1:3000",
    })?.baseURL,
    "http://127.0.0.1:3000",
  );
});

test("unsafe origin, short secret and invalid SMTP inputs fail with redacted errors", () => {
  const invalid = [
    { BETTER_AUTH_URL: "http://auth-fixture.invalid" },
    { BETTER_AUTH_URL: "https://user:private@auth-fixture.invalid" },
    { BETTER_AUTH_URL: "https://auth-fixture.invalid/api/auth" },
    { BETTER_AUTH_URL: "https://auth-fixture.invalid/?private=secret" },
    { BETTER_AUTH_SECRET: "short-secret" },
    { BETTER_AUTH_SECRET: `${fixture.BETTER_AUTH_SECRET}\nprivate` },
    { SMTP_HOST: "smtp.fixture.invalid/path" },
    { SMTP_PORT: "65536" },
    { SMTP_SECURE: "maybe" },
    { SMTP_FROM: "not-an-address" },
    { SMTP_PASSWORD: "private\r\nheader" },
  ];
  for (const changed of invalid) {
    assert.throws(
      () => readAuthConfiguration({ ...fixture, ...changed }),
      (error: unknown) => {
        assert.ok(error instanceof AuthConfigurationError);
        assert.equal(error.code, "auth_configuration_invalid");
        assert.equal(error.message, "Authentication configuration is invalid.");
        return true;
      },
    );
  }
});
