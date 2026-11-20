import assert from "node:assert/strict";
import test from "node:test";
import { renderAhiEmail } from "../src/server/mail/layout";
import { emailPreviewDocument } from "../src/server/mail/preview";

test("the email preview displays the local wordmark and leaves all email actions inert", () => {
  const origin = "https://ahibizz.example";
  const message = renderAhiEmail({
    subject: "Primjer poruke",
    title: "Primjer poruke",
    intro: "Sadržaj poruke.",
    actionLabel: "Otvori",
    url: `${origin}/nalog`,
  });
  const preview = emailPreviewDocument(message.html, origin);
  assert.match(preview, /<img src="\/brand\/email-wordmark\.png"/);
  assert.doesNotMatch(preview, /\bhref=|src="cid:/i);
  assert.match(preview, /default-src 'none'/);
  assert.match(preview, /form-action 'none'/);
  assert.match(preview, /<a class="cta"[^>]*>Otvori<\/a>/);
  assert.match(message.html, /src="cid:ahibizz-wordmark@ahibizz\.com"/);
  assert.match(message.html, /href="https:\/\/ahibizz\.example\/nalog"/);
  assert.match(message.html, /href="mailto:/);
});
