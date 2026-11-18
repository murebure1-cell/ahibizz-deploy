import assert from "node:assert/strict";
import test from "node:test";
import { emailContent } from "../src/server/auth/mail";

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
