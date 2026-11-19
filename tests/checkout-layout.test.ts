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
  assert.match(css, /\.sdkHost\s*\{[^}]*touch-action: auto;/);
  assert.doesNotMatch(css, /(?:html|body|:root)\s*\{[^}]*touch-action/);
  assert.doesNotMatch(css, /user-scalable|touch-action:\s*none/);
  assert.match(
    css,
    /\.page button\s*\{[^}]*max-width: 100%;[^}]*min-width: 0;[^}]*min-height: 48px/,
  );
});
test("PayPal external navy-gold frame contains SDK width without editing iframe contents", () => {
  assert.match(css, /\.sdkHost iframe\s*\{[^}]*min-width: 0;[^}]*max-width: 100%;/);
  assert.match(css, /\.paymentFrame\s*\{[^}]*background: #142e43;/);
  const source = readFileSync("src/components/billing/PayPalCardButton.tsx", "utf8");
  assert.match(source, /className=\{styles.sdkHost\}/);
  assert.match(source, /styles.paymentFrame/);
  assert.doesNotMatch(source, /contentDocument|contentWindow|user-scalable/);
  assert.match(source, /5,11 EUR/);
  assert.match(source, /7 dana isticanja/);
  assert.match(source, /bez PayPal naloga zavisi/);
});

test("standard CARD uses supported sizing without a white surround or overlay", () => {
  const source = readFileSync("src/components/billing/PayPalCardButton.tsx", "utf8");
  assert.match(source, /color: "black"/);
  assert.match(source, /borderRadius: 10/);
  assert.match(source, /height: 48/);
  assert.match(css, /\.paymentFrame \.sdkHost\s*\{[^}]*padding: 0;[^}]*background: transparent;/);
  assert.match(css, /\.sdkHost\[data-expanded\]\s*\{[^}]*background: #fff;/);
  assert.doesNotMatch(css, /\.sdkHost[^}]*?(?:position: absolute|opacity: 0|pointer-events: none)/);
});

test("expanding the standard card keeps the dark checkout shell and its summary colors", () => {
  const expandedShellRules = css
    .split("}")
    .map((rule) => rule.slice(0, rule.indexOf("{")).trim())
    .filter((selector) => selector.includes(".paymentFrame:has(.sdkHost[data-expanded])"));
  assert.ok(expandedShellRules.length > 0);
  for (const selector of expandedShellRules) {
    assert.ok(selector.startsWith(':global(html[data-theme="light"])'));
  }
  assert.match(css, /\.paymentFrame \.sdkHost\[data-expanded\] \{\s*background: #fff;/);
});
