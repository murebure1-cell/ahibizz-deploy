import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { CampaignBrief } from "../../lib/ad-brief";
import { getAdPlacement } from "../../lib/ad-catalog";
import { campaignCities, campaignTimeZones, type DailyAdWindow } from "../../lib/ad-geo-schedule";
import { estimateAdCampaign, getAdRate } from "../../lib/ad-pricing";
import { AccountAccessError } from "../auth/accounts";
import { readAdPricing } from "./ad-pricing";

function invalid(code = "INVALID_CAMPAIGN", status = 400): never {
  throw new AccountAccessError(status, code);
}
function positive(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}
function bounded(value: unknown, max: number): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > max || /\p{Cc}/u.test(value)) invalid();
  return value.trim() || null;
}
export function parseCampaignBrief(input: unknown): CampaignBrief {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid();
  const b = input as Record<string, unknown>;
  const fields = [
    "device",
    "page",
    "format",
    "impressionGoal",
    "budgetMinor",
    "startsOn",
    "city",
    "targetCities",
    "countryCode",
    "dailyWindow",
    "categoryId",
    "keyword",
    "creative",
    "destinationWebsite",
    "targetingNote",
    "targetGender",
    "minPriceMinor",
    "maxPriceMinor",
  ];
  if (Object.keys(b).some((k) => !fields.includes(k))) invalid();
  if (
    typeof b.device !== "string" ||
    typeof b.page !== "string" ||
    typeof b.format !== "string" ||
    !getAdPlacement(b.format, b.page, b.device)
  )
    invalid();
  if (
    !positive(b.impressionGoal, 1000, 10000000) ||
    (b.budgetMinor != null && !positive(b.budgetMinor, 1, 100000000)) ||
    typeof b.destinationWebsite !== "boolean"
  )
    invalid();
  const city = bounded(b.city, 100),
    categoryId = bounded(b.categoryId, 36),
    keyword = bounded(b.keyword, 80),
    startsOn = bounded(b.startsOn, 10);
  if (
    categoryId &&
    (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(categoryId) || b.page === "home")
  )
    invalid();
  const targetCities = campaignCities(b.targetCities ?? []);
  if (!targetCities || (city && targetCities.length)) invalid();
  const countryCode = bounded(b.countryCode, 2)?.toUpperCase() ?? null;
  if (countryCode && (b.page !== "listing" || !/^[A-Z]{2}$/.test(countryCode))) invalid();
  let dailyWindow: DailyAdWindow | null = null;
  if (b.dailyWindow != null) {
    if (typeof b.dailyWindow !== "object" || Array.isArray(b.dailyWindow)) invalid();
    const t = b.dailyWindow as Record<string, unknown>;
    if (
      Object.keys(t).length !== 3 ||
      !positive(t.startMinute, 0, 1439) ||
      !positive(t.endMinute, 0, 1439) ||
      t.startMinute === t.endMinute ||
      typeof t.timeZone !== "string" ||
      !campaignTimeZones.includes(t.timeZone)
    )
      invalid();
    dailyWindow = { startMinute: t.startMinute, endMinute: t.endMinute, timeZone: t.timeZone };
  }
  if (keyword && b.page !== "search") invalid();
  if (
    b.targetGender != null &&
    (b.page !== "listing" ||
      b.format === "loan_calculator" ||
      (b.targetGender !== "women" && b.targetGender !== "men"))
  )
    invalid();
  if (b.minPriceMinor != null && (b.page !== "listing" || !positive(b.minPriceMinor, 0, 100000000)))
    invalid();
  if (b.maxPriceMinor != null && (b.page !== "listing" || !positive(b.maxPriceMinor, 0, 100000000)))
    invalid();
  if (b.minPriceMinor != null && b.maxPriceMinor != null && b.minPriceMinor > b.maxPriceMinor)
    invalid();
  if (startsOn) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) invalid();
    const date = new Date(`${startsOn}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== startsOn) invalid();
  }
  let creative: CampaignBrief["creative"] = null;
  if (b.creative != null) {
    if (typeof b.creative !== "object" || Array.isArray(b.creative)) invalid();
    const c = b.creative as Record<string, unknown>;
    if (
      Object.keys(c).some((k) => !["kind", "slot", "version"].includes(k)) ||
      !positive(c.version, 1, 2147483647) ||
      !positive(c.slot, 0, 8) ||
      !(c.kind === "gallery"
        ? c.slot >= 1
        : (c.kind === "logo" || c.kind === "cover") && c.slot === 0)
    )
      invalid();
    creative = { kind: c.kind as "logo" | "cover" | "gallery", slot: c.slot, version: c.version };
  }
  return {
    device: b.device as CampaignBrief["device"],
    page: b.page as CampaignBrief["page"],
    format: b.format as CampaignBrief["format"],
    impressionGoal: b.impressionGoal,
    budgetMinor: b.budgetMinor ?? null,
    startsOn,
    city,
    targetCities,
    countryCode,
    dailyWindow,
    categoryId: categoryId?.toLowerCase() ?? null,
    keyword,
    creative,
    destinationWebsite: b.destinationWebsite,
    targetingNote: bounded(b.targetingNote, 400),
    targetGender: b.targetGender ?? null,
    minPriceMinor: b.minPriceMinor ?? null,
    maxPriceMinor: b.maxPriceMinor ?? null,
  };
}
export const campaignKey = (b: CampaignBrief) => [b.device, b.page, b.format].join(":");
export function briefFingerprint(b: CampaignBrief) {
  // Preserve the fingerprint of requests saved before daily and geographic targeting.
  const { targetCities, countryCode, dailyWindow, ...existing } = b;
  return createHash("sha256")
    .update(
      JSON.stringify({
        ...existing,
        ...(targetCities.length ? { targetCities } : {}),
        ...(countryCode ? { countryCode } : {}),
        ...(dailyWindow ? { dailyWindow } : {}),
      }),
    )
    .digest("hex");
}

export async function saveCampaignBrief(
  client: PoolClient,
  id: string,
  businessId: string,
  b: CampaignBrief,
) {
  const pricing = await readAdPricing(client, true);
  const rate = getAdRate(pricing, b.format, b.page, b.device);
  if (!rate?.available) invalid("CAMPAIGN_POSITION_UNAVAILABLE", 409);
  if (
    b.startsOn &&
    !(
      await client.query(
        "SELECT 1 WHERE $1::date BETWEEN (now() AT TIME ZONE 'UTC')::date AND (now() AT TIME ZONE 'UTC')::date + 365",
        [b.startsOn],
      )
    ).rowCount
  )
    invalid("CAMPAIGN_DATE_CHANGED", 409);
  if (
    b.categoryId &&
    !(await client.query("SELECT id FROM directory_category WHERE id=$1 FOR SHARE", [b.categoryId]))
      .rowCount
  )
    invalid("CAMPAIGN_CATEGORY_CHANGED", 409);
  if (
    b.creative &&
    !(
      await client.query(
        "SELECT 1 FROM directory_business_image WHERE business_id=$1 AND kind=$2 AND slot=$3 AND version=$4 FOR SHARE",
        [businessId, b.creative.kind, b.creative.slot, b.creative.version],
      )
    ).rowCount
  )
    invalid("CAMPAIGN_IMAGE_CHANGED", 409);
  if (b.dailyWindow) {
    try {
      await client.query("SELECT timezone($1::text,now())", [b.dailyWindow.timeZone]);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "22023")
        invalid();
      throw error;
    }
  }
  if (
    b.countryCode &&
    !(
      await client.query(
        `SELECT 1 FROM directory_business b JOIN auth_user u ON u.id=b.owner_user_id
    WHERE b.country_code=$1 AND b.status='published' AND package_allows_listing(b) AND u.approval='approved' AND u."emailVerified" AND u.role IN ('member','owner') LIMIT 1`,
        [b.countryCode],
      )
    ).rowCount
  )
    invalid("CAMPAIGN_COUNTRY_CHANGED", 409);
  let destinationUrl: string | null = null;
  if (b.destinationWebsite) {
    const row = (
      await client.query<{ website_url: string | null }>(
        "SELECT website_url FROM directory_business WHERE id=$1",
        [businessId],
      )
    ).rows[0];
    try {
      const url = new URL(row?.website_url ?? "");
      if (url.protocol !== "https:" || url.username || url.password)
        invalid("CAMPAIGN_SITE_CHANGED", 409);
      destinationUrl = url.href;
    } catch {
      invalid("CAMPAIGN_SITE_CHANGED", 409);
    }
  }
  const estimate = estimateAdCampaign(pricing, b.format, b.page, b.device, b.impressionGoal);
  const snapshot = {
    version: pricing.version,
    cpmMinor: rate.cpmMinor,
    minimumMinor: pricing.terms.minimumMinor,
    estimate,
    advance: estimateAdCampaign(pricing, b.format, b.page, b.device, b.impressionGoal, "advance"),
    welcome: estimateAdCampaign(pricing, b.format, b.page, b.device, b.impressionGoal, "welcome"),
  };
  await client.query(
    `INSERT INTO marketing_campaign_brief
    (order_id,device,page,format,impression_goal,budget_minor,starts_on,city,category_id,keyword,creative_kind,creative_slot,creative_version,destination_url,targeting_note,rate_snapshot,request_fingerprint,target_gender,min_price_minor,max_price_minor,country_code,target_cities,local_start_minute,local_end_minute,local_time_zone)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
    [
      id,
      b.device,
      b.page,
      b.format,
      b.impressionGoal,
      b.budgetMinor,
      b.startsOn,
      b.city,
      b.categoryId,
      b.keyword,
      b.creative?.kind ?? null,
      b.creative?.slot ?? null,
      b.creative?.version ?? null,
      destinationUrl,
      b.targetingNote,
      JSON.stringify(snapshot),
      briefFingerprint(b),
      b.targetGender,
      b.minPriceMinor,
      b.maxPriceMinor,
      b.countryCode,
      b.targetCities,
      b.dailyWindow?.startMinute ?? null,
      b.dailyWindow?.endMinute ?? null,
      b.dailyWindow?.timeZone ?? null,
    ],
  );
}
export async function checkCampaignQuote(
  client: PoolClient,
  id: string,
  amountMinor: number,
  benefit?: "advance" | "welcome",
  offerStandardTargeting?: true,
  expectedAssetVersion = 0,
) {
  const row = (
    await client.query(
      "SELECT budget_minor, targeting_note, rate_snapshot,COALESCE((SELECT version FROM marketing_ad_asset WHERE order_id=$1),0) AS asset_version FROM marketing_campaign_brief WHERE order_id=$1",
      [id],
    )
  ).rows[0];
  if (!row) {
    if (benefit) invalid();
    return;
  }
  if (row.asset_version !== expectedAssetVersion) invalid("CAMPAIGN_ASSET_CHANGED", 409);
  if (benefit) {
    const projected = row.rate_snapshot[benefit];
    if (!projected || amountMinor !== Math.max(projected.netMinor, projected.minimumMinor))
      invalid("CAMPAIGN_BENEFIT_CHANGED", 409);
    if (
      benefit === "welcome" &&
      (
        await client.query(
          `SELECT 1 FROM marketing_order o JOIN marketing_order prior ON prior.account_id=o.account_id AND prior.id<>o.id
      WHERE o.id=$1 AND prior.campaign_key IS NOT NULL AND (prior.status='paid' OR (prior.status='quoted' AND prior.campaign_benefit='welcome')) LIMIT 1`,
          [id],
        )
      ).rowCount
    )
      invalid("CAMPAIGN_WELCOME_USED", 409);
  }
  if (row.targeting_note) {
    if (!offerStandardTargeting) invalid("CAMPAIGN_MANUAL_ONLY", 409);
    await client.query(
      "UPDATE marketing_campaign_brief SET replaced_targeting_note=targeting_note,targeting_note=NULL WHERE order_id=$1",
      [id],
    );
  } else if (offerStandardTargeting) invalid();
  if (row.budget_minor != null && amountMinor > row.budget_minor)
    invalid("CAMPAIGN_BUDGET_EXCEEDED", 409);
  if (
    amountMinor < (row.rate_snapshot.minimumMinor ?? row.rate_snapshot.estimate?.minimumMinor ?? 0)
  )
    invalid("CAMPAIGN_MINIMUM", 409);
}
export const campaignProjection = `CASE WHEN c.order_id IS NOT NULL THEN jsonb_build_object(
  'assetVersion',coalesce((SELECT aa.version FROM marketing_ad_asset aa WHERE aa.order_id=o.id),0),
  'device',c.device,'page',c.page,'format',c.format,'impressionGoal',c.impression_goal,
  'budgetMinor',c.budget_minor,'startsOn',to_char(c.starts_on,'YYYY-MM-DD'),'city',c.city,
  'countryCode',c.country_code,'targetCities',c.target_cities,'dailyWindow',CASE WHEN c.local_start_minute IS NOT NULL THEN
    jsonb_build_object('startMinute',c.local_start_minute,'endMinute',c.local_end_minute,'timeZone',c.local_time_zone) END,
  'targetGender',c.target_gender,'minPriceMinor',c.min_price_minor,'maxPriceMinor',c.max_price_minor,
  'categoryId',c.category_id,'categoryName',dc.name,'keyword',c.keyword,
  'creative',CASE WHEN c.creative_kind IS NULL THEN NULL ELSE jsonb_build_object('kind',c.creative_kind,'slot',c.creative_slot,'version',c.creative_version) END,
  'destinationWebsite',c.destination_url IS NOT NULL,'destinationUrl',c.destination_url,'targetingNote',c.targeting_note,'replacedTargetingNote',c.replaced_targeting_note,
  'impressions',coalesce(stats.impressions,0),'clicks',coalesce(stats.clicks,0),
  'benefit',o.campaign_benefit,'advanceMinor',c.rate_snapshot #> '{advance,netMinor}','welcomeMinor',c.rate_snapshot #> '{welcome,netMinor}',
  'estimateMinor',c.rate_snapshot #> '{estimate,netMinor}', 'minimumMinor',coalesce((c.rate_snapshot->>'minimumMinor')::int,(c.rate_snapshot #>> '{estimate,minimumMinor}')::int,0))
  END AS campaign`;
