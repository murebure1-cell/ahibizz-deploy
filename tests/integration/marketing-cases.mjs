import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createPublicDirectoryService } from "../../src/server/directory/read-service.ts";
import { readActiveBanner } from "../../src/server/marketing/read.ts";
import { createMarketingService } from "../../src/server/marketing/service.ts";
import { verifyCampaignBriefs } from "./ad-campaign-cases.mjs";
import { verifyAdDelivery } from "./ad-delivery-cases.mjs";
export async function packageMarketingProbe({ pool, auth, admin, person }) {
  const service = createMarketingService(auth, pool),
    directory = createPublicDirectoryService({ database: pool });
  await pool.query("UPDATE directory_business SET latitude=44.543, longitude=18.686 WHERE id=$1", [
    person.businessId,
  ]);
  const req = {
    action: "request",
    id: randomUUID(),
    kind: "featured",
    businessId: person.businessId,
    quantity: 2,
  };
  await service.command(person.headers, req);
  await service.command(admin.headers, {
    action: "quote",
    id: req.id,
    amountMinor: 1500,
    instructions: "Samo testni izvod",
  });
  return {
    async funded() {
      const data = await service.read(person.headers, "ads", 0);
      assert.deepEqual(data.included.map((x) => x.kind).sort(), ["featured", "nearby"]);
      assert.equal(
        (await directory.listPublic({}, true)).items.filter((b) => b.id === person.businessId)
          .length,
        1,
      );
      await assert.rejects(
        service.command(person.headers, { ...req, kind: "nearby", id: randomUUID() }),
        (e) => e.code === "INCLUDED_IN_PACKAGE",
      );
      await service.command(admin.headers, {
        action: "confirm",
        id: req.id,
        amountMinor: 1500,
        reference: "FIXTURE-PACKAGE-OVERLAP",
      });
      const current = await service.read(person.headers, "ads", 0),
        paid = current.orders.find((o) => o.id === req.id),
        coverage = current.included.find((o) => o.kind === "featured");
      assert.equal(new Date(paid.startsAt).getTime(), new Date(coverage.endsAt).getTime());
      assert.equal(
        (await directory.listPublic({}, true)).items.filter((b) => b.id === person.businessId)
          .length,
        1,
      );
    },
    async reversed() {
      const data = await service.read(person.headers, "ads", 0);
      assert.deepEqual(data.included, []);
      assert.ok(
        !(await directory.listPublic({}, true)).items.some((b) => b.id === person.businessId),
      );
    },
  };
}

export async function verifyMarketing({ auth, pool, owner, member, second, category }) {
  const store = createMarketingService(auth, pool);
  const command = (actor, value) => store.command(actor.headers, value);
  const read = (actor, mode) => store.read(actor.headers, mode, 0);
  const credits = randomUUID(),
    banner = randomUUID(),
    business = randomUUID();
  const request = { action: "request", id: credits, kind: "credits", quantity: 30 };
  await assert.rejects(read(member, "admin"), (e) => e.status === 403);
  const swapped = new Headers(member.headers);
  swapped.set("X-AhiBizz-Account-ID", owner.user.id);
  await assert.rejects(store.read(swapped, "credits", 0), (e) => e.status === 401);
  const requests = await Promise.all([command(member, request), command(member, request)]);
  assert.deepEqual(requests, [{ id: credits }, { id: credits }]);
  await assert.rejects(
    command(member, { ...request, id: randomUUID() }),
    (e) => e.code === "OPEN_OFFER",
  );
  await assert.rejects(
    command(member, { ...request, quantity: 50 }),
    (e) => e.code === "OFFER_CHANGED",
  );
  assert.equal((await read(member, "credits")).balance, 0);
  assert.equal((await read(second, "credits")).orders.length, 0);
  const quote = {
    action: "quote",
    id: credits,
    amountMinor: 1234,
    instructions: "Uplata samo za testnu ponudu",
  };
  await assert.rejects(command(member, quote), (e) => e.status === 403);
  await command(owner, quote);
  const settle = {
    action: "confirm",
    id: credits,
    amountMinor: 1234,
    reference: "BANK-FIXTURE-345",
  };
  await assert.rejects(command(member, settle), (e) => e.status === 403);
  await assert.rejects(
    command(owner, { ...settle, amountMinor: 1200 }),
    (e) => e.code === "AMOUNT_MISMATCH",
  );
  await Promise.all([command(owner, settle), command(second, settle)]);
  assert.equal((await read(member, "credits")).balance, 30);
  const other = randomUUID();
  await command(member, { ...request, id: other });
  await command(owner, { ...quote, id: other });
  await assert.rejects(
    command(owner, { ...settle, id: other, reference: "bank-fixture-345" }),
    (e) => e.code === "REFERENCE_USED",
  );
  assert.equal((await read(member, "credits")).balance, 30);
  await command(member, { action: "close", id: other });
  assert.equal(await readActiveBanner(pool), null);
  await pool.query(
    "INSERT INTO directory_business(id,owner_user_id,title,category_id,status,published_at,city) VALUES($1,$2,'Marketing test',$3,'published',now(),'Tuzla')",
    [business, member.user.id, category.id],
  );
  const bannerRequest = {
    action: "request",
    id: banner,
    kind: "banner",
    businessId: business,
    quantity: 9,
  };
  await assert.rejects(command(second, bannerRequest), (e) => e.status === 409);
  await command(member, bannerRequest);
  await command(owner, { ...quote, id: banner, creditPrice: 7 });
  await assert.rejects(
    command(second, { action: "useCredits", id: banner }),
    (e) => e.status === 403,
  );
  assert.equal(await readActiveBanner(pool), null);
  await Promise.all([
    command(member, { action: "useCredits", id: banner }),
    command(member, { action: "useCredits", id: banner }),
  ]);
  assert.equal((await read(member, "credits")).balance, 23);
  assert.equal((await readActiveBanner(pool)).id, business);
  const listing = (await read(member, "ads")).orders[0];
  assert.ok(listing.endsAt);
  assert.equal(listing.status, "paid");
  await verifyAdDelivery({ pool, business, banner, member, owner, category });
  await assert.rejects(
    command(member, { ...bannerRequest, id: randomUUID() }),
    (e) => e.code === "ACTIVE_BANNER",
  );
  const directory = createPublicDirectoryService({ database: pool });
  const featured = randomUUID(),
    nearby = randomUUID(),
    closer = randomUUID();
  await assert.rejects(
    command(member, { ...bannerRequest, id: nearby, kind: "nearby" }),
    (e) => e.code === "LOCATION_REQUIRED",
  );
  await pool.query("UPDATE directory_business SET latitude=44.56,longitude=18.68 WHERE id=$1", [
    business,
  ]);
  await pool.query(
    "INSERT INTO directory_business(id,owner_user_id,title,category_id,status,published_at,city,latitude,longitude) VALUES($1,$2,'Nearby fixture',$3,'published',now(),'Tuzla',44.54,18.68)",
    [closer, second.user.id, category.id],
  );
  const near = { latitude: 44.54, longitude: 18.68, radiusKm: 5 };
  assert.deepEqual(
    (await directory.listPublic(near)).items.map((b) => b.id),
    [closer, business],
  );
  assert.deepEqual((await directory.listPublic({}, true)).items, []);
  for (const [id, kind] of [
    [featured, "featured"],
    [nearby, "nearby"],
  ]) {
    await command(member, { ...bannerRequest, id, kind });
    await command(owner, { ...quote, id });
  }
  assert.deepEqual((await directory.listPublic({}, true)).items, []);
  await command(owner, { ...settle, id: featured, reference: "GLOBAL-FIXTURE-856" });
  await command(owner, { ...settle, id: nearby, reference: "LOCAL-FIXTURE-172" });
  assert.deepEqual(
    (await directory.listPublic(near)).items.map((b) => [b.id, b.localFeatured]),
    [
      [business, true],
      [closer, false],
    ],
  );
  assert.deepEqual((await directory.listPublic({}, "category")).items, []);
  assert.deepEqual(
    (await directory.listPublic({}, true)).items.map((b) => b.id),
    [business],
  );
  assert.deepEqual(
    (await directory.listPublic(near)).items.map((b) => b.id),
    [business, closer],
  );
  assert.deepEqual(
    (await directory.listPublic({ ...near, radiusKm: 1 })).items.map((b) => b.id),
    [closer],
  );
  assert.equal((await read(member, "ads")).orders.length, 3);
  await pool.query("UPDATE directory_business SET owner_user_id=$1 WHERE id=$2", [
    second.user.id,
    business,
  ]);
  assert.equal(await readActiveBanner(pool), null);
  await pool.query("UPDATE directory_business SET owner_user_id=$1 WHERE id=$2", [
    member.user.id,
    business,
  ]);
  assert.equal(await readActiveBanner(pool), null);
  assert.deepEqual((await directory.listPublic({}, true)).items, []);
  assert.deepEqual(
    (await directory.listPublic(near)).items.map((b) => b.id),
    [closer, business],
  );
  await verifyCampaignBriefs({ pool, store, business, member, second, owner });
  // Release the one-listing allowance used by this fixture before the independent billing suite.
  await pool.query("DELETE FROM marketing_order WHERE business_id=$1", [business]);
  await pool.query("DELETE FROM directory_business WHERE id=ANY($1::uuid[])", [[business, closer]]);
}
