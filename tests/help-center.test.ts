import assert from "node:assert/strict";
import test from "node:test";
import { accountReturnPath } from "../src/lib/account-return";
import { blogPath } from "../src/lib/content-hub";
import { matchHelpTopic } from "../src/lib/help-center";
import { supportTarget } from "../src/lib/support-requests";

test("guide normalizes short natural-language questions and makes ambiguous prompts selectable", () => {
  assert.equal(matchHelpTopic("Kako da se prijavim?"), "nalog");
  assert.equal(matchHelpTopic("Sačuvaj mi noćenje"), "rezervacije");
  assert.equal(matchHelpTopic("Želim objaviti klip za djelatnost"), null);
  assert.equal(matchHelpTopic("Promjena odabrane usluge nešto drugo"), null);
  assert.equal(matchHelpTopic("Da li je naplaćena kartica?"), "naplata");
  assert.equal(matchHelpTopic("Kome da prijavim sumnjiv sadržaj?"), "sigurnost");
});

test("help tickets and destinations accept only expected values", () => {
  assert.equal(
    supportTarget("help", "nalog--0a2b09a0-2f06-4b31-96e7-ca0f335d72d6")?.subject,
    "help",
  );
  assert.equal(supportTarget("help", "novosti--0a2b09a0-2f06-4b31-96e7-ca0f335d72d6"), null);
  assert.equal(accountReturnPath("/blog/siguran-razgovor"), "/blog/siguran-razgovor");
  assert.equal(accountReturnPath("/administracija/blog"), "/administracija/blog");
  assert.equal(accountReturnPath("/pomoc"), "/pomoc");
  assert.equal(accountReturnPath(blogPath({ saved: true })), "/blog?sacuvano=1");
  assert.equal(accountReturnPath("/blog//example.com"), "/nalog");
  assert.equal(accountReturnPath("/pomoc?redir=https://example.com"), "/nalog");
});
