import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync("src/components/billing/checkout-preview.module.css", "utf8");
test("checkout shell and cards are centered border-box and bounded at mobile widths", () => {
  assert.match(
    css,
    /\.page\s*\{[^}]*box-sizing: border-box;[^}]*width: 100%;[^}]*max-width: 760px;[^}]*min-width: 0;[^}]*margin-inline: auto;/,
  );
  assert.match(css, /\.card\s*\{[^}]*width: 100%;[^}]*min-width: 0;[^}]*max-width: 100%;/);
  assert.match(css, /\.card \+ \.card,[\s\S]*?margin-top: 20px/);
  assert.match(css, /padding: 20px 16px 48px/);
  assert.match(css, /padding-inline: 12px/);
});
test("form controls fit long business names and gesture restriction is scoped to checkout", () => {
  assert.match(
    css,
    /\.page select,\s*\.page input\s*\{[^}]*width: 100%;[^}]*max-width: 100%;[^}]*min-width: 0;[^}]*min-height: 48px;[^}]*font-size: 16px;/,
  );
  assert.match(css, /\.page\s*\{[^}]*touch-action: pan-y;/);
  assert.match(css, /\.guestHost\s*\{[^}]*touch-action: auto;/);
  assert.doesNotMatch(css, /(?:html|body|:root)\s*\{[^}]*touch-action/);
  assert.doesNotMatch(css, /user-scalable|touch-action:\s*none/);
  assert.match(
    css,
    /\.page button\s*\{[^}]*max-width: 100%;[^}]*min-width: 0;[^}]*min-height: 48px/,
  );
});
test("eligible card selection opens locally and PayPal account checkout redirects", () => {
  const checkout = readFileSync("src/components/billing/Checkout.tsx", "utf8");
  const card = checkout.match(/<button[^>]*?className=\{styles\.payCard\}[\s\S]*?<\/button>/)?.[0];
  assert.ok(card);
  assert.match(card, /aria-controls="karticni-obrazac"/);
  assert.match(card, /setCardOpen/);
  assert.doesNotMatch(card, /act\(|fetch\(|window\.location/);
  assert.doesNotMatch(checkout, /act\("create",\s*"guest"\)/);
  assert.match(checkout, /\(cardOpen \|\| order\) && \(\s*<PayPalCardButton/);
  assert.match(
    checkout,
    /const cardAvailable = canOfferPayPalCard\(order, review, kind, offer\?\.kind\)/,
  );
  assert.match(checkout, /catalog\.paypalClientId && cardAvailable && \(\s*<button/);
  assert.match(checkout, /cardAvailable && \(\s*<div id="karticni-obrazac"/);
  assert.match(checkout, /setMethod\(next\.kind === "credits" \? "paypal" : "card"\)/);
  assert.match(
    checkout,
    /action === "create" && value.approvalUrl && value.order\?\.flow === "redirect"/,
  );
  assert.match(checkout, /onClick=\{\(\) => act\("create"\)\}/);
});
test("AhiBizz uses a theme-aware card surface and keeps hosted controls visible", () => {
  assert.match(css, /\.cardMethod\s*\{[^}]*background: var\(--ui-surface\)/);
  assert.match(css, /\.cardMethod \.payCard\s*\{[^}]*background: #e8cd91/);
  assert.match(css, /\.paymentFrame\s*\{[^}]*background: transparent/);
  assert.doesNotMatch(css, /contentWindow|mix-blend-mode|filter:\s*invert|data-expanded|#fff\b/i);
});
