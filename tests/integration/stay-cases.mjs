import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readNextAppointment } from "../../src/server/customer-next-appointment.ts";
import { createStayService } from "../../src/server/stays/service.ts";
import { createStayHttpHandler } from "../../src/server/stays-http.ts";

export async function testAccommodation(
  t,
  {
    pool,
    auth,
    directory,
    baseURL,
    operator,
    owner,
    customer,
    other,
    unrelatedBusiness,
    waitForTwoWriters,
  },
) {
  const parent = await directory.createCategory(operator.headers, {
    name: "Smještaj za probu",
    slug: "smjestaj-za-probu",
    parentId: null,
    accommodation: true,
  });
  const category = await directory.createCategory(operator.headers, {
    name: "Mali hoteli",
    slug: "mali-hoteli-za-probu",
    parentId: parent.id,
  });
  assert.equal(category.accommodation, true);
  let business = await directory.create(
    owner.headers,
    {
      title: "Pansion za probu",
      categoryId: parent.id,
      subcategoryId: category.id,
      description: "Izolirana proba smještaja.",
      contactEmail: "pansion@booking-fixture.invalid",
      contactPhone: "+38761123456",
      websiteUrl: null,
      addressLine: "Testna ulica 6",
      city: "Tuzla",
      countryCode: "BA",
      latitude: null,
      longitude: null,
    },
    randomUUID(),
  );
  business = await directory.publish(owner.headers, business.id, {
    expectedVersion: business.version,
  });
  business = await directory.moderate(operator.headers, business.id, {
    expectedVersion: business.version,
    status: "published",
  });
  await pool.query(
    `INSERT INTO directory_business_image(business_id,kind,slot,bytes,mime,width,height,version)
    SELECT $1,'gallery',slot,decode('aabbcc','hex'),'image/webp',20,10,$2 FROM generate_series(1,3) slot`,
    [business.id, business.version],
  );
  const now = new Date();
  const year = now.getUTCFullYear() + 1;
  let clock = new Date(Date.UTC(year, 2, 22, 12));
  const service = createStayService({ auth, pool, now: () => new Date(clock) });
  const handler = createStayHttpHandler(service, baseURL);
  const publicPath = `public/${business.id}`;
  const ownerPath = `owner/${business.id}`;
  async function http(path, actor, body) {
    const headers = new Headers(actor?.headers);
    headers.set("origin", baseURL);
    if (actor) headers.set("X-AhiBizz-Account-ID", actor.user.id);
    if (body !== undefined) headers.set("content-type", "application/json");
    const res = await handler(
      new Request(new URL(`/api/stays/${path}`, baseURL), {
        method: body === undefined ? "GET" : "POST",
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    assert.equal(res.headers.get("cache-control"), "no-store");
    return { status: res.status, data: await res.json() };
  }
  async function concurrent(actions) {
    const barrier = await pool.connect();
    let attempts;
    try {
      await barrier.query("BEGIN");
      await barrier.query("SELECT id FROM directory_business WHERE id=$1 FOR UPDATE", [
        business.id,
      ]);
      attempts = Promise.all(actions.map((action) => action()));
      await waitForTwoWriters();
    } finally {
      try {
        await barrier.query("ROLLBACK");
      } finally {
        barrier.release();
      }
      if (attempts) await attempts;
    }
    return attempts;
  }
  const fields = (name, type, photoSlots) => ({
    id: randomUUID(),
    expectedVersion: 0,
    name,
    type,
    photoSlots,
    beds: type === "room" ? 2 : 4,
    description: null,
    priceMinor: type === "room" ? 7550 : 10500,
    enabled: true,
  });
  const ask = (unit, checkIn, checkOut) => ({
    checkIn,
    checkOut,
    expectedUnitVersion: unit.version,
    requestId: randomUUID(),
  });
  const request = (unit, actor, body) => http(`request/${business.id}/${unit.id}`, actor, body);
  const decision = (entry, actor, action) =>
    http(`decide/${business.id}/${entry.id}`, actor, { expectedVersion: entry.version, action });
  const interval = (forOwner, unit, from, to, kind = "calendar") =>
    `${forOwner ? ownerPath : publicPath}/${unit.id}/${kind}?${new URLSearchParams({ from, to })}`;
  // These two nights cover the spring change in Europe/Sarajevo, irrespective of year.
  const lastSunday = new Date(Date.UTC(year, 2, 31));
  lastSunday.setUTCDate(31 - lastSunday.getUTCDay());
  const day = (offset) =>
    new Date(lastSunday.getTime() + offset * 86400000).toISOString().slice(0, 10);
  const arrival = day(-1),
    departure = day(1);
  let room, apartment, winning, winner, competitor, roomData, apartmentData;
  await t.test(
    "a lodging owner can assign gallery photos and two mixed units; a racing third unit is rejected",
    async () => {
      assert.equal((await http(ownerPath)).status, 401);
      assert.equal((await http(ownerPath, customer)).status, 403);
      assert.equal((await http(`public/${unrelatedBusiness}`)).data.eligible, false);
      assert.equal((await http(ownerPath, owner)).data.eligible, true);
      roomData = fields("Soba s balkonom", "room", [2, 1]);
      assert.equal((await http(ownerPath, owner, { ...roomData, photoSlots: [7] })).status, 400);
      assert.equal((await http(ownerPath, owner, { ...roomData, beds: 0 })).status, 400);
      const saved = await http(ownerPath, owner, roomData);
      assert.equal(saved.status, 200, JSON.stringify(saved.data));
      room = saved.data.unit;
      assert.equal(room.beds, 2);
      assert.equal((await http(ownerPath, owner, roomData)).data.unit.id, room.id);
      const candidates = [
        fields("Apartman istok", "apartment", [3]),
        fields("Apartman zapad", "apartment", [3]),
      ];
      const results = await concurrent(
        candidates.map((input) => () => http(ownerPath, owner, input)),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      const index = results.findIndex((r) => r.status === 200);
      apartment = results[index].data.unit;
      apartmentData = candidates[index];
      assert.equal(apartment.beds, 4);
      assert.equal(results[1 - index].data.code, "STAY_LIMIT");
      const inventory = (await http(publicPath)).data.units;
      assert.equal(inventory.length, 2);
      assert.deepEqual(inventory.find((u) => u.id === room.id).photoSlots, [2, 1]);
      assert.deepEqual(inventory.find((u) => u.id === apartment.id).photoSlots, [3]);
    },
  );
  await t.test(
    "two guests racing for the same nights produce one hold, a private owner entry, and a two-night quote across DST",
    async () => {
      const guests = [customer, other];
      const inputs = guests.map(() => ask(room, arrival, departure));
      assert.equal((await request(room, undefined, inputs[0])).status, 401);
      assert.equal((await request(room, owner, inputs[0])).status, 403);
      assert.equal((await request(room, customer, ask(room, departure, departure))).status, 400);
      assert.equal((await request(room, customer, ask(room, departure, arrival))).status, 400);
      const results = await concurrent(
        guests.map((guest, i) => () => request(room, guest, inputs[i])),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409], JSON.stringify(results));
      const i = results.findIndex((r) => r.status === 201);
      winner = guests[i];
      competitor = guests[1 - i];
      winning = results[i].data.entry;
      assert.equal(results[1 - i].data.code, "STAY_OVERLAP");
      assert.equal(winning.totalMinor, 15100);
      assert.equal(winning.status, "requested");
      const onArrival = await readNextAppointment(
        pool,
        winner.user.id,
        new Date(`${arrival}T12:00:00+02:00`),
      );
      assert.equal(onArrival.id, winning.id);
      assert.equal(onArrival.startsAt, arrival);
      assert.equal(onArrival.endsAt, departure);
      assert.equal(onArrival.kind, "stay");
      assert.equal((await request(room, winner, inputs[i])).data.entry.id, winning.id);
      assert.equal(
        (await request(room, winner, { ...inputs[i], checkOut: day(2) })).data.code,
        "REQUEST_CONFLICT",
      );
      assert.deepEqual((await http(interval(false, room, day(-4), day(3)))).data.entries, [
        { checkIn: arrival, checkOut: departure },
      ]);
      assert.deepEqual((await http(interval(false, room, day(0), day(2)))).data.entries, [
        { checkIn: day(0), checkOut: departure },
      ]);
      assert.equal((await http(interval(true, room, day(-4), day(3)), competitor)).status, 403);
      assert.equal(
        (await http(interval(true, room, day(-4), day(3)), owner)).data.entries[0].customerName,
        winner.user.name,
      );
      assert.equal((await http("mine", winner)).data.entries[0].id, winning.id);
      assert.equal(
        (await http("mine?view=upcoming&page=1", winner)).data.entries[0].id,
        winning.id,
      );
      assert.deepEqual((await http("mine?view=history&page=1", winner)).data.entries, []);
      const beforeBoundary = clock;
      try {
        // The checkout follows Sarajevo's spring transition. Midnight locally is 22:00 UTC.
        const midnight = Date.parse(`${departure}T00:00:00+02:00`);
        clock = new Date(midnight - 1);
        assert.equal((await http("mine?view=upcoming", winner)).data.entries[0].id, winning.id);
        clock = new Date(midnight);
        assert.deepEqual((await http("mine?view=upcoming", winner)).data.entries, []);
        assert.equal((await http("mine?view=history", winner)).data.entries[0].id, winning.id);
      } finally {
        clock = beforeBoundary;
      }
      assert.equal((await decision(winning, winner, "approve")).status, 403);
      assert.equal((await decision(winning, competitor, "cancel")).status, 404);
    },
  );
  await t.test(
    "parallel units and same-day turnover work, including rejection of a partial overlap by the database",
    async () => {
      const overlapping = await request(room, competitor, ask(room, day(0), day(2)));
      assert.equal(overlapping.data.code, "STAY_OVERLAP");
      const [sameNights, turnover] = await Promise.all([
        request(apartment, competitor, ask(apartment, arrival, departure)),
        request(room, competitor, ask(room, departure, day(3))),
      ]);
      assert.deepEqual([sameNights.status, turnover.status], [201, 201]);
      assert.equal(sameNights.data.entry.totalMinor, 21000);
      assert.equal(turnover.data.entry.totalMinor, 15100);
      await assert.rejects(
        pool.query("UPDATE stay_booking SET check_in=$2, check_out=$3 WHERE id=$1", [
          turnover.data.entry.id,
          day(0),
          day(2),
        ]),
        { code: "23P01" },
      );
      assert.equal(
        (await decision(sameNights.data.entry, owner, "decline")).data.entry.status,
        "declined",
      );
      const confirmed = (await decision(winning, owner, "approve")).data.entry;
      assert.equal(confirmed.status, "confirmed");
      assert.equal(
        (await http("mine", winner)).data.entries.find((e) => e.id === winning.id).status,
        "confirmed",
      );
      assert.equal((await decision(confirmed, winner, "cancel")).data.entry.status, "cancelled");
      assert.deepEqual((await http("mine?view=upcoming", winner)).data.entries, []);
      assert.equal((await http("mine?view=history", winner)).data.entries[0].status, "cancelled");
      const released = await request(room, competitor, ask(room, arrival, departure));
      assert.equal(released.status, 201);
      assert.equal(
        (await decision(released.data.entry, owner, "decline")).data.entry.status,
        "declined",
      );
      assert.equal(
        (await decision(turnover.data.entry, competitor, "cancel")).data.entry.status,
        "cancelled",
      );
    },
  );
  await t.test(
    "owner blocks affect only that unit, and stale prices never become an unintended booking",
    async () => {
      const blocked = await http(
        `block/${business.id}/${room.id}`,
        owner,
        ask(room, arrival, departure),
      );
      assert.equal(blocked.status, 201);
      assert.equal(blocked.data.entry.kind, "block");
      assert.deepEqual(
        (await http(interval(false, room, arrival, departure, "availability"))).data,
        { available: false },
      );
      assert.deepEqual(
        (await http(interval(false, apartment, arrival, departure, "availability"))).data,
        { available: true },
      );
      assert.deepEqual(
        (await http(interval(false, room, departure, day(2), "availability"))).data,
        { available: true },
      );
      assert.equal(
        (await request(room, customer, ask(room, arrival, departure))).data.code,
        "STAY_OVERLAP",
      );
      assert.equal(
        (await decision(blocked.data.entry, owner, "cancel")).data.entry.status,
        "cancelled",
      );
      const updated = await http(ownerPath, owner, {
        ...apartmentData,
        expectedVersion: apartment.version,
        priceMinor: 11000,
      });
      assert.equal(updated.status, 200);
      assert.equal(
        (await request(apartment, customer, ask(apartment, arrival, departure))).status,
        409,
      );
      apartment = updated.data.unit;
      const fresh = await request(apartment, customer, ask(apartment, arrival, departure));
      assert.equal(fresh.data.entry.totalMinor, 22000);
      const closed = await http(ownerPath, owner, {
        ...apartmentData,
        expectedVersion: apartment.version,
        enabled: false,
        priceMinor: 11000,
      });
      assert.equal(closed.status, 200);
      assert.equal(
        (await http(publicPath)).data.units.some((u) => u.id === apartment.id),
        false,
      );
      assert.equal(
        (await http("mine", customer)).data.entries.some((e) => e.id === fresh.data.entry.id),
        true,
      );
      assert.equal(
        (
          await http(`archive/${business.id}/${apartment.id}`, owner, {
            expectedVersion: closed.data.unit.version,
          })
        ).status,
        409,
      );
      assert.equal(
        (await decision(fresh.data.entry, customer, "cancel")).data.entry.status,
        "cancelled",
      );
      assert.equal(
        (
          await http(`archive/${business.id}/${apartment.id}`, owner, {
            expectedVersion: closed.data.unit.version,
          })
        ).status,
        200,
      );
      assert.equal(
        (await http(ownerPath, owner, fields("Zamjenska soba", "room", []))).status,
        200,
      );
      clock = new Date(Date.UTC(year, 3, 10));
      assert.equal((await request(room, customer, ask(room, arrival, departure))).status, 400);
    },
  );
  await directory.archive(owner.headers, business.id, { expectedVersion: business.version });
}
