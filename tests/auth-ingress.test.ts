import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { AuthConfigurationError, readAuthConfiguration } from "../src/server/auth/config";
import { authIpAddressHeaders, readAuthIngressConfiguration } from "../src/server/auth/ingress";
import { createAuthService } from "../src/server/auth/service";
import { enforcementEnv, origin, trustedEnforcementEnv } from "./ingress-enforcement-fixtures";

const childEnvironment = (trusted = false) => ({
  ...(trusted ? trustedEnforcementEnv() : enforcementEnv()),
  NODE_ENV: "production",
  HOSTNAME: "127.0.0.1",
  PORT: "43128",
  AHIBIZZ_INGRESS_PUBLIC_PORT: "43127",
  AHIBIZZ_INGRESS_WRAPPED: "true",
});

test("auth trusts no IP header by default and only a validated wrapped-child configuration enables one", () => {
  assert.equal(readAuthIngressConfiguration({}, origin), null);
  assert.deepEqual(authIpAddressHeaders(), []);
  assert.equal(readAuthIngressConfiguration(childEnvironment(), origin), null);
  const ingress = readAuthIngressConfiguration(childEnvironment(true), origin);
  assert.ok(ingress);
  assert.deepEqual(authIpAddressHeaders(ingress), ["x-ahibizz-ingress-client-ip"]);
  assert.throws(() => authIpAddressHeaders({ ...ingress }));
  for (const changed of [
    { AHIBIZZ_INGRESS_WRAPPED: undefined },
    { HOSTNAME: "0.0.0.0" },
    { PORT: "43127" },
    { AHIBIZZ_INGRESS_PUBLIC_PORT: "43128" },
    { NODE_ENV: "development" },
    { AHIBIZZ_INGRESS_BOUNDARY_PROOF: "{}" },
  ])
    assert.throws(() =>
      readAuthIngressConfiguration({ ...childEnvironment(true), ...changed }, origin),
    );
  assert.throws(() =>
    readAuthIngressConfiguration(childEnvironment(true), "https://other.invalid"),
  );
});

test("the actual BetterAuth service keeps the database limiter and never trusts XFF or proxy origins", async (t) => {
  const pool = new Pool({ connectionString: "postgresql://fixture:fixture@127.0.0.1:1/fixture" });
  let databaseAttempts = 0;
  t.mock.method(pool, "query", async () => {
    databaseAttempts++;
    throw new Error("The isolated configuration test must not query a database.");
  });
  t.mock.method(pool, "connect", async () => {
    databaseAttempts++;
    throw new Error("The isolated configuration test must not connect to a database.");
  });
  t.after(() => pool.end());
  const options = {
    pool,
    baseURL: origin,
    secret: "fixture-only-secret-with-more-than-thirty-two-characters",
    sendEmail: async () => {
      throw new Error("The isolated configuration test must not send email.");
    },
    production: true,
  };
  const plain = createAuthService(options);
  const wrapped = createAuthService({
    ...options,
    ingress: readAuthIngressConfiguration(childEnvironment(true), origin),
  });
  await Promise.all([plain.$context, wrapped.$context]);
  assert.deepEqual(plain.options.advanced?.ipAddress?.ipAddressHeaders, []);
  assert.deepEqual(wrapped.options.advanced?.ipAddress?.ipAddressHeaders, [
    "x-ahibizz-ingress-client-ip",
  ]);
  assert.equal(wrapped.options.advanced?.trustedProxyHeaders, false);
  assert.equal(wrapped.options.advanced?.ipAddress?.disableIpTracking, false);
  assert.deepEqual(wrapped.options.rateLimit, plain.options.rateLimit);
  assert.equal(wrapped.options.rateLimit?.enabled, true);
  assert.equal(wrapped.options.rateLimit?.storage, "database");
  assert.equal(wrapped.options.rateLimit?.modelName, "auth_rate_limit");
  assert.equal(databaseAttempts, 0);
});

test("complete auth configuration rejects an enabled unbound process with a redacted configuration error", () => {
  const env = {
    ...childEnvironment(true),
    DATABASE_URL: "postgresql://ahibizz_ci:fixture-only@127.0.0.1:5432/ahibizz_ci?sslmode=disable",
    BETTER_AUTH_SECRET: "fixture-only-secret-with-at-least-thirty-two-characters",
    SMTP_HOST: "smtp.fixture.invalid",
    SMTP_PORT: "465",
    SMTP_USER: "fixture-mailer",
    SMTP_PASSWORD: "fixture-only-mail-password",
    SMTP_FROM: "no-reply@fixture.invalid",
  };
  assert.ok(readAuthConfiguration(env)?.ingress);
  assert.equal(
    readAuthConfiguration({ ...env, AHIBIZZ_INGRESS_TRUST_CLIENT_IP: "false" })?.ingress,
    null,
  );
  assert.throws(
    () => readAuthConfiguration({ ...env, HOSTNAME: "0.0.0.0" }),
    (error: unknown) =>
      error instanceof AuthConfigurationError &&
      error.message === "Authentication configuration is invalid.",
  );
});
