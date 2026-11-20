import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  adFrequencyKey,
  adPlatform,
  readAdToken,
  signAdToken,
} from "../src/server/marketing/ad-token";

test("an ad event is bound to one render, campaign, device and time window", () => {
  const campaign = randomUUID(),
    secret = "fixture secret",
    now = 1_800_000_000_000;
  const token = signAdToken(campaign, "mobile", secret, now);
  const decoded = readAdToken(token, secret, now);
  assert.equal(decoded?.campaignId, campaign);
  assert.equal(decoded?.device, "mobile");
  assert.notEqual(
    readAdToken(signAdToken(campaign, "mobile", secret, now), secret, now)?.renderId,
    decoded?.renderId,
  );
  for (const candidate of [
    token.replace(campaign, randomUUID()),
    token.replace("mobile", "desktop"),
    token.slice(1),
    null,
    {},
    `${token}=`,
  ])
    assert.equal(readAdToken(candidate, secret, now), null);
  assert.equal(readAdToken(token, "another secret", now), null);
  assert.equal(readAdToken(token, secret, now - 1), null);
  assert.equal(readAdToken(token, secret, now + 7_200_001), null);
});
test("short-lived frequency hashes cannot link visits across campaigns, devices or minutes", () => {
  const campaign = randomUUID(),
    other = randomUUID(),
    tab = randomUUID(),
    time = 1800000000000;
  const key = (id: string, device: "mobile" | "desktop", t: number) =>
    adFrequencyKey("test", id, device, "tab", tab, t);
  assert.equal(key(campaign, "mobile", time), key(campaign, "mobile", time + 59999));
  assert.notEqual(key(campaign, "mobile", time), key(other, "mobile", time));
  assert.notEqual(key(campaign, "mobile", time), key(campaign, "desktop", time));
  assert.notEqual(key(campaign, "mobile", time), key(campaign, "mobile", time + 60000));
  assert.equal(adPlatform("Mozilla/5.0 (Linux; Android 14; Pixel)"), "android");
  assert.equal(adPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"), "ios");
  assert.equal(adPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "desktop");
  assert.equal(adPlatform(""), "other");
});
