import assert from "node:assert/strict";
import test from "node:test";
import nodemailer from "nodemailer";
import {
  AuthEmailDeliveryError,
  createSmtpSender,
  emailContent,
  guardedAuthEmailSender,
} from "../src/server/auth/mail";

const origin = "https://example.invalid";
const failedReset = {
  kind: "password-reset" as const,
  to: "private-fixture@example.invalid",
  url: `${origin}/api/auth/reset-password/private-fixture-token`,
};
const smtpFixture = {
  host: "smtp.example.invalid",
  port: 465,
  secure: true,
  user: "private-fixture-user",
  password: "private-fixture-password",
  from: "from@example.invalid",
};

test("confirmation includes its verification link; account approval only includes the sign-in link", () => {
  const to = "fixture@example.invalid";
  const confirmation = emailContent({
    kind: "verification",
    to,
    url: "https://example.invalid/api/auth/verify-email?token=fixture",
  });
  assert.equal(confirmation.subject, "Potvrdite email — AhiBizz");
  assert.match(
    confirmation.text,
    /https:\/\/example\.invalid\/api\/auth\/verify-email\?token=fixture/,
  );
  const approval = emailContent({
    kind: "account-approved",
    to,
    url: "https://example.invalid/prijava",
    decisionId: "fixture",
  });
  assert.equal(approval.subject, "Nalog je odobren — AhiBizz");
  assert.match(approval.text, /https:\/\/example\.invalid\/prijava/);
  assert.doesNotMatch(approval.text, /token|fixture/i);
});

test("SMTP exceptions are recorded once with only the message kind, bounded codes and numeric status", async (t) => {
  const log = t.mock.method(console, "error", () => {});
  const failure = Object.assign(new Error(`${failedReset.to} ${failedReset.url}`), {
    code: "EENVELOPE",
    command: "RCPT TO",
    responseCode: 550,
    response: `550 ${smtpFixture.user} ${smtpFixture.password}`,
    rejected: [failedReset.to],
  });
  t.mock.method(nodemailer, "createTransport", () => ({
    sendMail: async () => {
      throw failure;
    },
  }));
  const send = guardedAuthEmailSender(origin, createSmtpSender(smtpFixture));
  await assert.rejects(send(failedReset), {
    name: "Error",
    message: new AuthEmailDeliveryError().message,
  });
  assert.deepEqual(
    log.mock.calls.map((call) => call.arguments),
    [
      [
        "auth_mail_delivery_failed",
        {
          kind: "password-reset",
          stage: "smtp",
          code: "EENVELOPE",
          command: "RCPT TO",
          status: 550,
        },
      ],
    ],
  );
});

test("unknown and untrusted values cannot appear in auth mail logs or thrown errors", async (t) => {
  const log = t.mock.method(console, "error", () => {});
  const fail = t.mock.fn(async () => {
    throw { code: failedReset.to, command: failedReset.url, responseCode: 1234567 };
  });
  const send = guardedAuthEmailSender(origin, fail);
  await assert.rejects(send(failedReset), AuthEmailDeliveryError);
  await assert.rejects(
    send({ ...failedReset, url: "https://elsewhere.invalid/private-fixture-token" }),
    AuthEmailDeliveryError,
  );
  await assert.rejects(
    send({ ...failedReset, to: "private-fixture\r\nheader@example.invalid" }),
    AuthEmailDeliveryError,
  );
  assert.equal(fail.mock.callCount(), 1);
  assert.deepEqual(
    log.mock.calls.map((call) => call.arguments),
    [
      [
        "auth_mail_delivery_failed",
        { kind: "password-reset", stage: "smtp", code: "OTHER", command: "OTHER", status: null },
      ],
      ["auth_mail_delivery_failed", { kind: "password-reset", stage: "link" }],
      ["auth_mail_delivery_failed", { kind: "password-reset", stage: "recipient" }],
    ],
  );
});

test("a delivery outage emits at most five diagnostic entries per minute per kind", async (t) => {
  const log = t.mock.method(console, "error", () => {});
  t.mock.method(nodemailer, "createTransport", () => {
    throw new Error("fixture smtp down");
  });
  const send = createSmtpSender(smtpFixture);
  const approval = {
    kind: "account-approved" as const,
    to: failedReset.to,
    url: origin,
    decisionId: "fixture",
  };
  for (let i = 0; i < 7; i++) await assert.rejects(send(approval), AuthEmailDeliveryError);
  assert.equal(log.mock.callCount(), 5);
});
