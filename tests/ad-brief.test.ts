import assert from "node:assert/strict";
import { test } from "node:test";
import { accountReturnPath } from "../src/lib/account-return";
import { campaignPath, readCampaignSelection } from "../src/lib/ad-brief";
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
