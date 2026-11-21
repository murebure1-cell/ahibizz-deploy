import { type AdDevice, type AdFormatId, type AdPage, getAdPlacement } from "../../lib/ad-catalog";
import type { PageAds } from "../../lib/ad-render";
import type { BusinessMediaKind } from "../../lib/business-media";
import { IS_PLAY_EDITION } from "../../lib/distribution";
import { readAuthConfiguration } from "../auth/config";
import { type Database, getDatabase } from "../db";
import { signAdToken } from "./ad-token";

type PageContext = {
  page: AdPage;
  city?: string;
  countryCode?: string | null;
  categoryIds?: string[];
  keyword?: string;
  listingId?: string;
  publishedPrices?: number[];
  gender?: "women" | "men" | null;
  blockViewer?: string | null;
};
const empty = (): PageAds => ({ main: {}, icon: {} });
const eligibility = `
  FROM marketing_order o JOIN directory_business b ON b.id=o.business_id AND b.owner_user_id=o.account_id
  JOIN auth_user u ON u.id=o.account_id
  LEFT JOIN marketing_campaign_brief c ON c.order_id=o.id
  LEFT JOIN marketing_ad_asset asset ON asset.order_id=o.id
  CROSS JOIN (VALUES ('mobile'),('desktop')) screens(device)
  WHERE o.kind='banner' AND o.status='paid' AND o.revoked_at IS NULL AND o.starts_at<=now() AND o.ends_at>now()
    AND b.status='published' AND package_allows_listing(b)
    AND u.approval='approved' AND u."emailVerified" AND u.role IN ('member','owner')
    AND (c.order_id IS NULL AND $1='home' OR c.page=$1 AND c.device=screens.device)
    AND (c.city IS NULL OR lower(c.city)=lower($2))
    AND (c.order_id IS NULL OR cardinality(c.target_cities)=0 OR EXISTS(SELECT 1 FROM unnest(c.target_cities) place WHERE lower(place)=lower($2)))
    AND (c.country_code IS NULL OR ($1='listing' AND c.country_code=$8))
    AND ($9::text IS NULL OR NOT EXISTS (SELECT 1 FROM people_block pb WHERE pb.actor_id=$9 AND pb.target_id=o.account_id AND pb.blocked))
    AND campaign_window_open(now(),c.local_start_minute,c.local_end_minute,c.local_time_zone)
    AND (c.category_id IS NULL OR c.category_id::text=ANY($3::text[]))
    AND (c.keyword IS NULL OR position(lower(c.keyword) in lower($4))>0)
    AND (c.target_gender IS NULL OR c.target_gender=$5)
    AND ((c.min_price_minor IS NULL AND c.max_price_minor IS NULL) OR
      ($1='listing' AND $6::uuid IS NOT NULL AND EXISTS(
          SELECT 1 FROM unnest($7::integer[]) p(price)
          WHERE (c.min_price_minor IS NULL OR p.price>=c.min_price_minor)
            AND (c.max_price_minor IS NULL OR p.price<=c.max_price_minor))))
    AND (c.impression_goal IS NULL OR c.impression_goal>COALESCE((SELECT impressions FROM marketing_ad_totals WHERE order_id=o.id),0))`;

export async function readPageAds(
  database: Pick<Database, "query">,
  ctx: PageContext,
  secret: string,
): Promise<PageAds> {
  const result = empty();
  const { rows } = await database.query(
    `
    WITH candidates AS (
      SELECT o.id AS campaign_id,b.id AS business_id,b.title,b.city,screens.device,
        COALESCE(c.format, CASE screens.device WHEN 'desktop' THEN 'billboard' ELSE 'mobile_leaderboard' END) AS format,
        c.order_id IS NULL AS legacy,c.creative_kind,c.creative_slot,asset.mime_type AS asset_mime,asset.version AS asset_version,
        CASE WHEN c.destination_url=b.website_url THEN c.destination_url END AS destination
        ${eligibility}
    ), chosen AS (
      SELECT DISTINCT ON(device,(format='branded_icon')) * FROM candidates
      ORDER BY device,(format='branded_icon'),random()
    )
    SELECT chosen.*,media.images FROM chosen
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object('kind',m.kind,'slot',m.slot,'version',m.version)
                   ORDER BY m.rank,m.slot) AS images FROM (
        SELECT i.kind,i.slot,i.version, CASE
          WHEN i.kind=chosen.creative_kind AND i.slot=chosen.creative_slot THEN 0
          WHEN i.kind=CASE WHEN chosen.format='branded_icon' THEN 'logo' ELSE 'cover' END THEN 1
          WHEN i.kind='gallery' THEN 2 ELSE 3 END AS rank
        FROM directory_business_image i WHERE i.business_id=chosen.business_id
        ORDER BY rank,i.slot LIMIT CASE WHEN chosen.format IN ('carousel','rotator','cube','slash','reveal') THEN 4 ELSE 1 END
      ) m
    ) media ON true`,
    [
      ctx.page,
      ctx.city ?? "",
      ctx.categoryIds ?? [],
      ctx.keyword ?? "",
      ctx.gender ?? null,
      ctx.listingId ?? null,
      ctx.publishedPrices ?? [],
      ctx.countryCode ?? null,
      ctx.blockViewer ?? null,
    ],
  );
  for (const row of rows) {
    const device = row.device as AdDevice;
    const formatId = String(row.format) as AdFormatId;
    const placement = getAdPlacement(formatId, ctx.page, device);
    if (!placement) continue;
    const campaignId = String(row.campaign_id),
      businessId = String(row.business_id);
    let href = `/djelatnosti/${businessId}`;
    if (typeof row.destination === "string") {
      try {
        const url = new URL(row.destination);
        if (url.protocol === "https:" && !url.username && !url.password) href = url.href;
      } catch {
        /* Keep the public listing as the destination. */
      }
    }
    const images = (
      (row.images ?? []) as { kind: BusinessMediaKind; slot: number; version: number }[]
    ).map((i) => `/api/business-media/public/${businessId}/${i.kind}/${i.slot}?v=${i.version}`);
    result[placement.position === "icon" ? "icon" : "main"][device] = {
      campaignId,
      businessId,
      title: String(row.title),
      city: String(row.city ?? ""),
      href,
      images,
      formatId,
      position: row.legacy ? "inline" : placement.position,
      width: placement.width,
      height: placement.height,
      token: signAdToken(campaignId, device, secret),
      ...(formatId === "loan_calculator" &&
      ctx.publishedPrices?.length === 1 &&
      ctx.publishedPrices[0]
        ? { principalMinor: ctx.publishedPrices[0] }
        : {}),
      ...(row.asset_mime
        ? { asset: { mimeType: String(row.asset_mime), version: Number(row.asset_version) } }
        : {}),
    };
  }
  return result;
}
export async function publicPageAds(context: PageContext): Promise<PageAds> {
  if (IS_PLAY_EDITION) return empty();
  try {
    const config = readAuthConfiguration(),
      db = getDatabase();
    if (!config || !db.configured()) return empty();
    const gender =
      context.page === "listing"
        ? await (await import("./ad-preferences")).getViewerAdGender().catch(() => null)
        : null;
    return await readPageAds(db, { ...context, gender }, config.secret);
  } catch {
    return empty();
  }
}
export async function publicAdAudience() {
  const db = getDatabase();
  try {
    if (!db.configured() || IS_PLAY_EDITION) return null;
    const { rows } = await db.query(`
      SELECT to_char((now() AT TIME ZONE 'UTC')::date-29,'YYYY-MM-DD') AS "from",to_char((now() AT TIME ZONE 'UTC')::date,'YYYY-MM-DD') AS "to",
        COALESCE(sum(impressions),0) impressions,COALESCE(sum(clicks),0) clicks,
        COALESCE(sum(impressions) FILTER (WHERE device='mobile'),0) mobile,
        COALESCE(sum(impressions) FILTER (WHERE device='desktop'),0) desktop,
        COALESCE(sum(impressions) FILTER (WHERE platform='android'),0) android,
        COALESCE(sum(impressions) FILTER (WHERE platform='ios'),0) ios,
        COALESCE(sum(impressions) FILTER (WHERE platform='desktop'),0) os_desktop,
        COALESCE(sum(impressions) FILTER (WHERE platform='other'),0) other
      FROM marketing_ad_daily WHERE day >= (now() AT TIME ZONE 'UTC')::date-29`);
    const r = rows[0];
    return r
      ? {
          from: String(r.from),
          to: String(r.to),
          impressions: Number(r.impressions),
          clicks: Number(r.clicks),
          mobile: Number(r.mobile),
          desktop: Number(r.desktop),
          platforms: {
            android: Number(r.android),
            ios: Number(r.ios),
            desktop: Number(r.os_desktop),
            other: Number(r.other),
          },
        }
      : null;
  } catch {
    return null;
  }
}
