import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function verifyCampaignBriefs({ pool, store, business, member, second, owner }) {
  const cmd = (actor, input) => store.command(actor.headers, input);
  const today = new Date();
  today.setUTCDate(today.getUTCDate() + 2);
  const date = today.toISOString().slice(0, 10);
  await pool.query(
    "UPDATE directory_business SET country_code='BA', website_url='https://business.fixture.invalid/' WHERE id=$1",
    [business],
  );
  const brief = {
    device: "mobile",
    page: "home",
    format: "mobile_leaderboard",
    impressionGoal: 100000,
    budgetMinor: 65000,
    startsOn: date,
    city: "Tuzla",
    destinationWebsite: true,
  };
  const base = {
    action: "request",
    kind: "banner",
    quantity: 8,
    businessId: business,
    id: randomUUID(),
    campaign: brief,
  };
  const quote = { action: "quote", instructions: "Uplata po testnoj ponudi.", amountMinor: 50000 };
  await assert.rejects(cmd(second, base), (e) => e.code === "BUSINESS_CHANGED");
  await assert.rejects(
    cmd(member, {
      ...base,
      campaign: { ...brief, creative: { kind: "gallery", slot: 1, version: 1 } },
    }),
    (e) => e.code === "CAMPAIGN_IMAGE_CHANGED",
  );
  await assert.rejects(
    cmd(member, { ...base, campaign: { ...brief, startsOn: "2001-01-01" } }),
    (e) => e.code === "CAMPAIGN_DATE_CHANGED",
  );
  await cmd(member, base);
  await cmd(member, base);
  await assert.rejects(
    cmd(member, { ...base, campaign: { ...brief, city: "Mostar" } }),
    (e) => e.code === "OFFER_CHANGED",
  );
  await assert.rejects(cmd(member, { ...base, id: randomUUID() }), (e) => e.code === "OPEN_OFFER");
  const custom = {
    ...base,
    id: randomUUID(),
    campaign: { ...brief, format: "rectangle", targetingNote: "Poseban raspon cijena" },
  };
  await cmd(member, custom);
  await assert.rejects(
    cmd(owner, { ...quote, id: custom.id }),
    (e) => e.code === "CAMPAIGN_MANUAL_ONLY",
  );
  await cmd(owner, { ...quote, id: custom.id, offerStandardTargeting: true });
  const orders = (await store.read(member.headers, "ads", 0)).orders;
  const revised = orders.find((o) => o.id === custom.id).campaign;
  assert.equal(revised.targetingNote, null);
  assert.equal(revised.replacedTargetingNote, "Poseban raspon cijena");
  await assert.rejects(
    cmd(owner, { ...quote, id: base.id, amountMinor: 70000 }),
    (e) => e.code === "CAMPAIGN_BUDGET_EXCEEDED",
  );
  await assert.rejects(
    cmd(owner, { ...quote, id: base.id, amountMinor: 10 }),
    (e) => e.code === "CAMPAIGN_MINIMUM",
  );
  const original = orders.find((o) => o.id === base.id);
  assert.equal(original.campaign.startsOn, date);
  assert.equal(original.campaign.impressions, 0);
  assert.equal(original.campaign.destinationUrl, "https://business.fixture.invalid/");
  const welcomePrice = Math.max(original.campaign.welcomeMinor, original.campaign.minimumMinor);
  await assert.rejects(
    cmd(owner, { ...quote, id: base.id, expectedAssetVersion: 1 }),
    (e) => e.code === "CAMPAIGN_ASSET_CHANGED",
  );
  await cmd(owner, {
    ...quote,
    id: base.id,
    amountMinor: welcomePrice,
    campaignBenefit: "welcome",
  });
  await cmd(owner, {
    action: "confirm",
    id: base.id,
    amountMinor: welcomePrice,
    reference: "ADS-CAMPAIGN-FIXTURE",
  });
  const paid = (await store.read(member.headers, "ads", 0)).orders.find((o) => o.id === base.id);
  assert.equal(paid.campaign.benefit, "welcome");
  assert.equal(new Date(paid.startsAt).toISOString(), `${date}T00:00:00.000Z`);
  assert.equal(new Date(paid.endsAt) - new Date(paid.startsAt), 8 * 86400000);
  assert.ok(!(await store.read(second.headers, "ads", 0)).orders.some((o) => o.id === base.id));
  assert.ok((await store.read(owner.headers, "admin", 0)).orders.some((o) => o.id === base.id));
  const next = {
    ...base,
    id: randomUUID(),
    campaign: { ...brief, format: "megaboard", device: "desktop", impressionGoal: 1000 },
  };
  await cmd(member, next);
  await assert.rejects(
    cmd(owner, { ...quote, id: next.id, campaignBenefit: "welcome" }),
    (e) => e.code === "CAMPAIGN_WELCOME_USED",
  );
  const icon = { ...base, id: randomUUID(), campaign: { ...brief, format: "branded_icon" } };
  await cmd(member, icon);
  const geo = {
    ...base,
    id: randomUUID(),
    campaign: {
      ...brief,
      city: null,
      targetCities: ["Mostar", "Tuzla"],
      countryCode: "BA",
      dailyWindow: { startMinute: 1380, endMinute: 120, timeZone: "Europe/Sarajevo" },
      page: "listing",
      format: "rectangle",
    },
  };
  await assert.rejects(
    cmd(member, { ...geo, campaign: { ...geo.campaign, countryCode: "DE" } }),
    (e) => e.code === "CAMPAIGN_COUNTRY_CHANGED",
  );
  await cmd(member, geo);
  const region = await store.read(member.headers, "ads", 0);
  assert.ok(region.locations.countries.includes("BA"));
  const locationBrief = region.orders.find((o) => o.id === geo.id).campaign;
  assert.deepEqual(locationBrief.targetCities, geo.campaign.targetCities);
  assert.equal(locationBrief.countryCode, "BA");
  assert.deepEqual(locationBrief.dailyWindow, geo.campaign.dailyWindow);
  await assert.rejects(
    cmd(owner, { ...quote, id: icon.id, amountMinor: 49999 }),
    (e) => e.code === "CAMPAIGN_MINIMUM",
  );
  await pool.query("DELETE FROM marketing_campaign_brief WHERE order_id=ANY($1::uuid[])", [
    [base.id, custom.id, next.id, icon.id, geo.id],
  ]);
}
