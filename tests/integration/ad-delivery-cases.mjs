import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readPageAds } from "../../src/server/marketing/ad-delivery.ts";
import { readAdToken } from "../../src/server/marketing/ad-token.ts";

export async function verifyAdDelivery({ pool, business, banner, member, owner, category }) {
  const secret = "isolated-secret";
  const read = (context) => readPageAds(pool, context, secret);
  const legacy = await read({ page: "home" });
  assert.equal(legacy.main.desktop?.campaignId, banner);
  assert.equal(legacy.main.mobile?.campaignId, banner);
  assert.equal(legacy.main.mobile?.href, `/djelatnosti/${business}`);
  assert.deepEqual((await read({ page: "search" })).main, {});
  const tab = randomUUID();
  const claim = async (click) =>
    (
      await pool.query("SELECT record_marketing_ad($1,$2,'mobile',$3,$4,NULL,'android') accepted", [
        randomUUID(),
        banner,
        click,
        tab,
      ])
    ).rows[0].accepted;
  assert.equal(await claim(false), true);
  assert.equal(await claim(false), false);
  assert.equal(await claim(true), true);
  assert.equal(await claim(true), false);
  assert.deepEqual(
    (
      await pool.query(
        "SELECT platform,impressions,clicks FROM marketing_ad_daily WHERE order_id=$1",
        [banner],
      )
    ).rows,
    [{ platform: "android", impressions: "1", clicks: "1" }],
  );
  const id = randomUUID();
  await pool.query(
    `INSERT INTO marketing_order(id,account_id,business_id,kind,campaign_key,quantity,status,amount_minor,
    instructions,quoted_by,quoted_at,settled_by,paid_at,starts_at,ends_at)
    VALUES ($1,$2,$3,'banner','desktop:search:sitebar',3,'paid',3000,'Ponuda',$4,now(),$4,now(),now(),now()+interval '3 days')`,
    [id, member.user.id, business, owner.user.id],
  );
  await pool.query(
    `INSERT INTO marketing_campaign_brief(order_id,device,page,format,impression_goal,city,category_id,keyword,rate_snapshot,request_fingerprint)
    VALUES($1,'desktop','search','sitebar',1000,'Tuzla',$2,'servis','{}'::jsonb,repeat('a',64))`,
    [id, category.id],
  );
  const context = {
    page: "search",
    city: "tuzla",
    categoryIds: [category.id],
    keyword: "Auto servis",
  };
  for (const wrong of [
    { ...context, page: "home" },
    { ...context, city: "Sarajevo" },
    { ...context, categoryIds: [] },
    { ...context, keyword: "Hotel" },
  ])
    assert.notEqual((await read(wrong)).main.desktop?.campaignId, id);
  const served = await read(context);
  assert.equal(served.main.desktop?.campaignId, id);
  assert.equal(served.main.desktop?.position, "side");
  assert.equal(served.main.mobile, undefined);
  await pool.query(
    "UPDATE marketing_campaign_brief SET page='listing',keyword=NULL,target_gender='women',min_price_minor=1000,max_price_minor=2000 WHERE order_id=$1",
    [id],
  );
  const listed = {
    ...context,
    page: "listing",
    listingId: business,
    gender: "women",
    publishedPrices: [200, 1500],
  };
  assert.equal((await read(listed)).main.desktop?.campaignId, id);
  for (const mismatch of [
    { ...listed, gender: null },
    { ...listed, gender: "men" },
    { ...listed, listingId: undefined },
    { ...listed, publishedPrices: [] },
    { ...listed, publishedPrices: [2001] },
  ])
    assert.equal((await read(mismatch)).main.desktop, undefined);
  await pool.query(
    "UPDATE marketing_campaign_brief SET page='search',keyword='servis',target_gender=NULL,min_price_minor=NULL,max_price_minor=NULL WHERE order_id=$1",
    [id],
  );
  const decoded = readAdToken(served.main.desktop.token, secret);
  const record = async (renderId, device, click) =>
    (
      await pool.query("SELECT record_marketing_ad($1,$2,$3,$4) accepted", [
        renderId,
        id,
        device,
        click,
      ])
    ).rows[0].accepted;
  assert.equal(await record(randomUUID(), "mobile", false), false);
  await pool.query(
    `INSERT INTO marketing_ad_daily(order_id,day,device,impressions) VALUES($1,(now() AT TIME ZONE 'UTC')::date,'desktop',999)`,
    [id],
  );
  const receipts = [decoded.renderId, randomUUID()];
  const accepted = await Promise.all(receipts.map((token) => record(token, "desktop", false)));
  assert.equal(accepted.filter(Boolean).length, 1);
  const seen = receipts[accepted.indexOf(true)];
  assert.equal(await record(seen, "desktop", false), false);
  assert.equal(await record(seen, "desktop", true), true);
  assert.equal(await record(seen, "desktop", true), false);
  assert.equal(await record(randomUUID(), "desktop", true), false);
  assert.equal((await read(context)).main.desktop, undefined);
  const totals = (
    await pool.query("SELECT impressions,clicks FROM marketing_ad_totals WHERE order_id=$1", [id])
  ).rows[0];
  assert.deepEqual(totals, { impressions: "1000", clicks: "1" });
  await pool.query("UPDATE marketing_order SET revoked_at=now() WHERE id=$1", [id]);
  assert.equal(await record(randomUUID(), "desktop", false), false);
  await pool.query("DELETE FROM marketing_campaign_brief WHERE order_id=$1", [id]);
  await pool.query("DELETE FROM marketing_order WHERE id=$1", [id]);
}
