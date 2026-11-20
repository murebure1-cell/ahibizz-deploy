import assert from "node:assert/strict";
import test from "node:test";
import nodemailer from "nodemailer";
import { supportEmail } from "../src/lib/support-requests";
import {
  type ApprovalEmail,
  type AuthEmail,
  createSmtpSender,
  emailContent,
} from "../src/server/auth/mail";
import { emailLogoCid, renderAhiEmail } from "../src/server/mail/layout";

const origin = "https://mail-fixture.invalid";
const to = "recipient@mail-fixture.invalid";
const messages: Array<AuthEmail | ApprovalEmail> = [
  {
    kind: "verification",
    to,
    url: `${origin}/api/auth/verify-email?token=fixture&callbackURL=%2Fnalog`,
  },
  {
    kind: "password-reset",
    to,
    url: `${origin}/api/auth/reset-password/fixture?callbackURL=%2Fpromjena-lozinke`,
  },
  { kind: "account-approved", to, url: `${origin}/prijava`, decisionId: "fixture-decision" },
];

test("three transactional messages retain their signed link, support address and Bosnian copy in both formats", () => {
  for (const message of messages) {
    const rendered = emailContent(message);
    assert.ok(rendered.text.includes(message.url));
    assert.ok(rendered.html.includes(`href="${message.url.replaceAll("&", "&amp;")}"`));
    assert.ok(rendered.text.includes(supportEmail));
    assert.ok(rendered.html.includes(`href="mailto:${supportEmail}"`));
    assert.ok(rendered.html.includes(`src="cid:${emailLogoCid}"`));
    assert.match(rendered.html, /alt="AhiBizz"/);
    assert.ok(!rendered.html.includes(to));
    if (message.kind !== "account-approved") assert.match(rendered.text, /zanemarite ovu poruku/);
  }
});

test("layout renders user-facing values as literal text", () => {
  const email = renderAhiEmail({
    subject: "Ponuda",
    title: "Boje & platna",
    intro: "Prijava",
    actionLabel: "Pogledaj",
    url: origin,
    details: [{ label: "Djelatnost", value: "Studio <Nova> & Co." }],
  });
  assert.ok(email.html.includes("Studio &lt;Nova&gt; &amp; Co."));
  assert.ok(email.text.includes("Studio <Nova> & Co."));
});

test("the actual sender produces multipart mail with the local inline logo and preserves approval identity", async (t) => {
  const local = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: "windows",
  });
  let raw = "";
  t.mock.method(nodemailer, "createTransport", () => ({
    sendMail: async (mail: Parameters<typeof local.sendMail>[0]) => {
      const result = await local.sendMail(mail);
      raw = result.message.toString("utf8");
    },
  }));
  const send = createSmtpSender({
    host: "unused.invalid",
    port: 465,
    secure: true,
    user: "fixture",
    password: "fixture",
    from: "no-reply@example.invalid",
  });
  for (const message of messages) {
    await send(message);
    assert.match(raw, /From: AhiBizz <no-reply@example\.invalid>/i);
    assert.match(raw, /Reply-To:[^\r\n]*<podrska@ahibizz\.com>/i);
    assert.match(raw, /Content-Type: text\/plain/i);
    assert.match(raw, /Content-Type: text\/html/i);
    assert.match(raw, /Content-Type: image\/png/i);
    assert.ok(raw.includes(`Content-ID: <${emailLogoCid}>`));
    assert.match(raw, /Content-Disposition: inline/i);
    if (message.kind === "account-approved")
      assert.ok(raw.includes("Message-ID: <approval-fixture-decision@example.invalid>"));
  }
});
