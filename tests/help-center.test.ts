import assert from "node:assert/strict";
import test from "node:test";
import {
  accountReturnPath,
  accountSectionPath,
  readAccountNavigation,
} from "../src/lib/account-return";
import { blogPath } from "../src/lib/content-hub";
import { helpTopicContent, helpTopicIds, matchHelpTopic } from "../src/lib/help-center";
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

test("Play help matches the available package, promotion and Reel actions", () => {
  const membership = helpTopicContent("naplata", true);
  assert.match(membership.answer, /Kupovina i dopuna kredita nisu dostupne/);
  assert.deepEqual(membership.links, [
    { label: "Moj paket", href: accountSectionPath("membership") },
  ]);
  const business = helpTopicContent("djelatnost", true);
  assert.match(business.answer, /Postojeće isticanje možeš pregledati/);
  for (const [link, section] of [
    [membership.links[0], "membership"],
    [business.links[0], "businesses"],
    [business.links[1], "advertising"],
  ] as const) {
    assert.ok(link);
    assert.equal(accountReturnPath(link.href), link.href);
    assert.equal(
      readAccountNavigation(new URL(link.href, "https://app.example").searchParams).section,
      section,
    );
  }
  const reels = helpTopicContent("reels", true);
  assert.match(reels.answer, /Objavljivanje novog Reela nije dostupno/);
  for (const topic of helpTopicIds) {
    const content = helpTopicContent(topic, true);
    assert.doesNotMatch(content.answer, /dopuni kredite|odaberi paket|pošalji zahtjev za ponudu/i);
    for (const link of content.links)
      assert.doesNotMatch(link.href, /^\/(paketi|naplata|oglasavanje|podrzi)(?:[/?#]|$)/);
  }
  assert.match(helpTopicContent("naplata").answer, /dopuni kredite/);
  assert.match(helpTopicContent("reels").answer, /dodaj snimak/);
});
