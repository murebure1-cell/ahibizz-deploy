import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { accountReturnPath } from "../src/lib/account-return";
import { campaignPath, readCampaignSelection } from "../src/lib/ad-brief";
import { minuteTime, timeMinute } from "../src/lib/ad-geo-schedule";
import { briefFingerprint, parseCampaignBrief } from "../src/server/marketing/campaigns";

const brief = {
  device: "mobile",
  page: "home",
  format: "mobile_leaderboard",
  impressionGoal: 50000,
  destinationWebsite: false,
};
test("a real ad position and impression goal survive login", () => {
  const path = campaignPath({
    device: "mobile",
    page: "home",
    format: "mobile_leaderboard",
    impressionGoal: 50000,
  });
  const params = new URL(path, "https://fixture.invalid").searchParams;
  assert.deepEqual(readCampaignSelection(params), {
    device: "mobile",
    page: "home",
    format: "mobile_leaderboard",
    impressionGoal: 50000,
  });
  assert.equal(accountReturnPath(path), path);
  assert.equal(accountReturnPath(`${path}&format=takeover`), "/nalog");
  assert.equal(accountReturnPath(path.replace("mobile_leaderboard", "takeover")), "/nalog");
});
test("regional city groups, published country and daily window are validated before reserving an ad", () => {
  const listing = { ...brief, page: "listing", format: "rectangle" };
  const dailyWindow = { startMinute: 1380, endMinute: 120, timeZone: "Europe/Sarajevo" };
  const parsed = parseCampaignBrief({
    ...listing,
    targetCities: [" Tuzla ", "MOSTAR", "mostar"],
    countryCode: "ba",
    dailyWindow,
  });
  assert.deepEqual(parsed.targetCities, ["Tuzla", "MOSTAR"]);
  assert.equal(parsed.countryCode, "BA");
  assert.deepEqual(parsed.dailyWindow, dailyWindow);
  assert.equal(timeMinute("24:00"), null);
  assert.equal(timeMinute("23:00"), 1380);
  assert.equal(minuteTime(1380), "23:00");
  for (const invalid of [
    { ...brief, countryCode: "BA" },
    { ...listing, countryCode: "B1" },
    { ...listing, city: "Tuzla", targetCities: ["Mostar"] },
    { ...listing, targetCities: Array(13).fill("Bihać") },
    { ...listing, targetCities: ["Tu\nzla"] },
    { ...brief, dailyWindow: { ...dailyWindow, timeZone: "Tomorrow/City" } },
    { ...brief, dailyWindow: { ...dailyWindow, endMinute: 1380 } },
    { ...brief, dailyWindow: { ...dailyWindow, startMinute: -3 } },
    { ...brief, dailyWindow: { timeZone: "UTC" } },
  ])
    assert.throws(() => parseCampaignBrief(invalid), { code: "INVALID_CAMPAIGN" });
  const previous = {
    device: "mobile",
    page: "home",
    format: "mobile_leaderboard",
    impressionGoal: 50000,
    budgetMinor: null,
    startsOn: null,
    city: null,
    categoryId: null,
    keyword: null,
    creative: null,
    destinationWebsite: false,
    targetingNote: null,
    targetGender: null,
    minPriceMinor: null,
    maxPriceMinor: null,
  };
  assert.equal(
    briefFingerprint(parseCampaignBrief(brief)),
    createHash("sha256").update(JSON.stringify(previous)).digest("hex"),
  );
});
test("campaign briefs reject invented positions, invalid calendars, goals and media keys", () => {
  for (const change of [
    { format: "takeover" },
    { targetGender: "men" },
    { minPriceMinor: 10 },
    { page: "listing", format: "rectangle", minPriceMinor: 150, maxPriceMinor: 100 },
    { page: "listing", format: "loan_calculator", targetGender: "women" },
    { startsOn: "2027-02-29" },
    { page: "malicious" },
    { impressionGoal: 0 },
    { budgetMinor: -1 },
    { creative: { kind: "gallery", slot: 9, version: 1 } },
    { destinationWebsite: "yes" },
    { creativeUrl: "https://elsewhere.invalid" },
    { keyword: "masaža" },
    { categoryId: "0711a9ff-c282-47cb-8df3-b7af4cdb3db7" },
  ]) {
    assert.throws(() => parseCampaignBrief({ ...brief, ...change }), { code: "INVALID_CAMPAIGN" });
  }
  assert.equal(
    briefFingerprint(parseCampaignBrief({ ...brief, city: "  Tuzla " })),
    briefFingerprint(parseCampaignBrief({ ...brief, city: "Tuzla" })),
  );
  assert.notEqual(
    briefFingerprint(parseCampaignBrief(brief)),
    briefFingerprint(parseCampaignBrief({ ...brief, startsOn: "2028-02-29" })),
  );
});
