import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  type AdPricing,
  estimateAdCampaign,
  getAdRate,
  parseAdPricingChange,
} from "../src/lib/ad-pricing";
import { monthlyLoanPayment } from "../src/lib/ad-response";
import { normalizeAdAsset, readAssetBytes } from "../src/server/marketing/ad-asset";

const pricing: AdPricing = {
  version: 1,
  terms: {
    minimumMinor: 50000,
    volumePercent: [20, 25, 35, 40, 45],
    advancePercent: 5,
    welcomePercent: 20,
  },
  overrides: [],
};
test("position pricing uses integer fening, nonstacking discounts and unambiguous tier boundaries", () => {
  assert.deepEqual(getAdRate(pricing, "mobile_leaderboard", "home", "mobile"), {
    available: true,
    cpmMinor: 600,
  });
  for (const [views, pct] of [
    [99999, 0],
    [100000, 20],
    [300000, 25],
    [400000, 35],
    [500000, 40],
    [1000000, 40],
    [1000001, 45],
  ] as const)
    assert.equal(
      estimateAdCampaign(pricing, "mobile_leaderboard", "home", "mobile", views)?.discountPercent,
      pct,
    );
  assert.equal(
    estimateAdCampaign(pricing, "mobile_leaderboard", "home", "mobile", 100000, "advance")
      ?.netMinor,
    48000,
  );
  assert.equal(
    estimateAdCampaign(pricing, "mobile_leaderboard", "home", "mobile", 100000)?.belowMinimum,
    true,
  );
  assert.equal(estimateAdCampaign(pricing, "branded_icon", "home", "mobile", 100000), null);
  const changed: AdPricing = {
    ...pricing,
    overrides: [
      {
        formatId: "mobile_leaderboard",
        page: "home",
        device: "mobile",
        available: false,
        cpmMinor: 123,
      },
    ],
  };
  assert.equal(estimateAdCampaign(changed, "mobile_leaderboard", "home", "mobile", 100000), null);
  assert.equal(getAdRate(changed, "billboard", "home", "desktop").cpmMinor, 1200);
});
test("only supported ad positions, positive prices, ordered discounts and international contact numbers are saved", () => {
  const data = {
    action: "rate",
    version: 1,
    device: "mobile",
    page: "home",
    formatId: "mobile_leaderboard",
    available: true,
    cpmMinor: 432,
  };
  assert.deepEqual(parseAdPricingChange(data), data);
  for (const change of [
    { cpmMinor: -1 },
    { version: 0 },
    { unexpected: true },
    { formatId: "missing" },
    { device: "random" },
  ])
    assert.equal(parseAdPricingChange({ ...data, ...change }), null);
  assert.equal(
    parseAdPricingChange({
      action: "terms",
      version: 1,
      ...pricing.terms,
      volumePercent: [10, 20, 5, 40, 45],
    }),
    null,
  );
  assert.equal(
    parseAdPricingChange({ action: "contact", version: 1, contactPhone: "call me" }),
    null,
  );
  assert.equal(
    parseAdPricingChange({ action: "contact", version: 1, contactPhone: null })?.action,
    "contact",
  );
});
test("loan estimation handles zero interest and regular amortization with no hidden default interest rate", () => {
  assert.equal(monthlyLoanPayment(1200, 0, 12), 100);
  assert.equal(monthlyLoanPayment(10000, 5, 12), 856.07);
  for (const value of [0, -1, Infinity, NaN]) assert.equal(monthlyLoanPayment(value, 5, 12), null);
  assert.equal(monthlyLoanPayment(1000, 4.5, 0), null);
});
test("creative uploads decode real images, preserve animated GIF type and validate self-contained HTML and MP4", async () => {
  const png = await sharp({ create: { width: 40, height: 25, channels: 3, background: "#975822" } })
    .png()
    .toBuffer();
  const result = await normalizeAdAsset(png, "image/png");
  assert.equal(result.mimeType, "image/png");
  assert.equal((await sharp(result.content).metadata()).width, 40);
  await assert.rejects(normalizeAdAsset(png, "image/jpeg"));
  await assert.rejects(normalizeAdAsset(Buffer.from("invalid"), "video/mp4"));
  const gif = await sharp(png).gif().toBuffer();
  assert.equal((await normalizeAdAsset(gif, "image/gif")).mimeType, "image/gif");
  assert.equal(
    (
      await normalizeAdAsset(
        Buffer.from("<html><style>div{color:red}</style><div>Popust</div></html>"),
        "text/html",
      )
    ).mimeType,
    "text/html",
  );
  await assert.rejects(normalizeAdAsset(Buffer.from("<html><form></form></html>"), "text/html"));
  const req = new Request("https://test.invalid", { method: "PUT", body: new Uint8Array(1000001) });
  await assert.rejects(readAssetBytes(req), { code: "AD_ASSET_TOO_LARGE" });
});
