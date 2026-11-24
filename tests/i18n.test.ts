import assert from "node:assert/strict";
import test from "node:test";
import { catalog } from "../src/lib/i18n/catalog";
import { negotiateLocale, resolveLocale } from "../src/lib/i18n/locales";
import { translate } from "../src/lib/i18n/translate";
import { sourceTexts } from "./i18n-source";

test("the device language picks the interface language", () => {
  assert.equal(negotiateLocale("de-DE,de;q=0.9,en;q=0.8"), "de");
  assert.equal(negotiateLocale("ar-SA"), "ar");
  assert.equal(negotiateLocale("tr-TR,tr;q=0.9"), "tr");
  assert.equal(negotiateLocale("en-US,en;q=0.9"), "en");
  assert.equal(negotiateLocale("bs-BA,bs;q=0.9"), "bs");
  // Neighbouring languages read Bosnian; unknown languages get English.
  assert.equal(negotiateLocale("hr-HR"), "bs");
  assert.equal(negotiateLocale("sr-Latn-RS"), "bs");
  assert.equal(negotiateLocale("fr-FR,fr;q=0.9"), "en");
  assert.equal(negotiateLocale("fr-FR,de;q=0.5"), "de");
  assert.equal(negotiateLocale("en;q=0.4,tr;q=0.8"), "tr");
  assert.equal(negotiateLocale("de;q=0,en"), "en");
  // No header at all (crawlers, scripts) keeps the source language.
  assert.equal(negotiateLocale(null), "bs");
  assert.equal(negotiateLocale(""), "bs");
});

test("a language chosen by hand wins over the device, an unknown cookie does not", () => {
  assert.equal(resolveLocale("ar", "de-DE"), "ar");
  assert.equal(resolveLocale("xx", "de-DE"), "de");
  assert.equal(resolveLocale(undefined, "tr"), "tr");
});

test("translation fills values and plural words, and falls back to Bosnian text", () => {
  assert.equal(translate("bs", "Otvori {title}", { title: "Pekara" }), "Otvori Pekara");
  assert.equal(translate("en", "{count} recenzija", { count: 1 }), "1 review");
  assert.equal(translate("en", "{count} recenzija", { count: 5 }), "5 reviews");
  assert.equal(translate("de", "Ovaj tekst nije u katalogu"), "Ovaj tekst nije u katalogu");
});

test("every marked interface text has all four translations with the same placeholders", () => {
  const names = (text: string) =>
    [...new Set([...text.matchAll(/\{(\w+)(?:\|[^}]*)?\}/g)].map((match) => match[1]))].sort();
  const problems: string[] = [];
  for (const [text, files] of sourceTexts()) {
    const entry = catalog[text];
    if (!entry) {
      problems.push(`missing: ${JSON.stringify(text)} (${files[0]})`);
      continue;
    }
    for (const [locale, value] of Object.entries(entry)) {
      if (!value.trim()) problems.push(`empty ${locale}: ${JSON.stringify(text)}`);
      else if (names(value).join() !== names(text).join())
        problems.push(`placeholders ${locale}: ${JSON.stringify(text)}`);
    }
  }
  assert.deepEqual(problems, []);
});
