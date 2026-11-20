import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readNextAppointment } from "../../src/server/customer-next-appointment.ts";
import { createRentalService } from "../../src/server/rentals/service.ts";
import { createRentalHttpHandler } from "../../src/server/rentals-http.ts";

export async function testVehicleRentals(
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
    name: "Najam vozila",
    slug: "rental-fixture",
    parentId: null,
    vehicleRental: true,
  });
  const category = await directory.createCategory(operator.headers, {
    name: "Gradska vozila",
    slug: "rental-fixture-city",
    parentId: parent.id,
  });
  assert.equal(category.vehicleRental, true);
  let agency = await directory.create(
    owner.headers,
    {
      title: "Agencija za probu",
      categoryId: parent.id,
      subcategoryId: category.id,
      description: "Izolirana rent-a-car djelatnost.",
      contactEmail: "agency@booking-fixture.invalid",
      contactPhone: "+38761123456",
      websiteUrl: null,
      addressLine: "Testna ulica 5",
      city: "Tuzla",
      countryCode: "BA",
      latitude: null,
      longitude: null,
    },
    randomUUID(),
  );
  agency = await directory.publish(owner.headers, agency.id, { expectedVersion: agency.version });
  agency = await directory.moderate(operator.headers, agency.id, {
    status: "published",
    expectedVersion: agency.version,
  });
  // Only hour/minute inputs and non-rounded pickup/return times are used here.
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() + 8);
  const at = (hour, minute = 0) =>
    new Date(day.getTime() + (hour * 60 + minute) * 60000).toISOString();
  let clock = day.getTime() - 86400000;
  const service = createRentalService({ auth, pool, now: () => new Date(clock) });
  const handler = createRentalHttpHandler(service, baseURL);
  async function http(path, actor, body, expectedAccount = actor?.user.id) {
    const headers = new Headers(actor?.headers);
    headers.set("origin", baseURL);
    if (expectedAccount) headers.set("X-AhiBizz-Account-ID", expectedAccount);
    if (body !== undefined) headers.set("Content-Type", "application/json");
    const response = await handler(
      new Request(new URL(`/api/rentals/${path}`, baseURL), {
        method: body === undefined ? "GET" : "POST",
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    assert.equal(response.headers.get("cache-control"), "no-store");
    return { status: response.status, data: await response.json() };
  }
  const carFields = (name, priceUnit = "hour") => ({
    id: randomUUID(),
    expectedVersion: 0,
    name,
    brand: "Toyota",
    model: "Corolla",
    year: 2022,
    seats: 5,
    fuel: "hybrid",
    transmission: "automatic",
    description: null,
    priceMinor: 2500,
    priceUnit,
    enabled: true,
  });
  const firstFields = carFields("Toyota bijela");
  const ownerPath = `owner/${agency.id}`;
  const publicPath = `public/${agency.id}`;
  const ask = (car, startsAt = at(10, 15), endsAt = at(12, 45)) => ({
    startsAt,
    endsAt,
    requestId: randomUUID(),
    expectedVehicleVersion: car.version,
  });
  const request = (car, actor, input) => http(`request/${agency.id}/${car.id}`, actor, input);
  const decide = (entry, actor, action) =>
    http(`decide/${agency.id}/${entry.id}`, actor, {
      action,
      expectedVersion: entry.version,
    });
  const calendarPath = (which, car, from = at(0), to = at(24)) =>
    `${which}/${car.id}/calendar?${new URLSearchParams({ from, to })}`;
  const availabilityPath = (which, car, from = at(0), to = at(24 * 400)) =>
    `${which}/${car.id}/availability?${new URLSearchParams({ from, to })}`;
  async function concurrent(attempts) {
    const locker = await pool.connect();
    let writes;
    try {
      await locker.query("BEGIN");
      await locker.query("SELECT id FROM directory_business WHERE id=$1 FOR UPDATE", [agency.id]);
      writes = Promise.all(attempts.map((start) => start()));
      await waitForTwoWriters();
    } finally {
      try {
        await locker.query("ROLLBACK");
      } finally {
        locker.release();
      }
      if (writes) await writes;
    }
    return writes;
  }
  let first, second, secondFields, winner, winnerActor, loserActor, winningInput;
  await t.test(
    "rental catalogue verifies the owner's session and grants exactly two free cars under concurrency",
    async () => {
      assert.equal((await http(ownerPath)).status, 401);
      assert.equal((await http(ownerPath, customer)).status, 403);
      assert.equal(
        (await http(ownerPath, owner, undefined, customer.user.id)).data.code,
        "ACCOUNT_IDENTITY_CHANGED",
      );
      assert.equal((await http(`public/${unrelatedBusiness}`)).data.eligible, false);
      assert.equal((await http(ownerPath, owner)).data.eligible, true);
      assert.equal((await http(ownerPath, customer, firstFields)).status, 403);
      const saved = await http(ownerPath, owner, firstFields);
      assert.equal(saved.status, 200, JSON.stringify(saved.data));
      first = saved.data.vehicle;
      assert.equal((await http(ownerPath, owner, firstFields)).data.vehicle.id, first.id);
      const attempts = [carFields("Toyota siva", "day"), carFields("Toyota plava", "day")];
      const result = await concurrent(attempts.map((input) => () => http(ownerPath, owner, input)));
      assert.deepEqual(result.map((r) => r.status).sort(), [200, 409]);
      assert.equal(result.find((r) => r.status === 409).data.code, "RENTAL_LIMIT");
      const index = result.findIndex((r) => r.status === 200);
      second = result[index].data.vehicle;
      secondFields = attempts[index];
      assert.equal(
        (await http(ownerPath, owner, carFields("Treće vozilo"))).data.code,
        "RENTAL_LIMIT",
      );
      assert.deepEqual(
        (await http(publicPath)).data.vehicles.map((v) => v.id),
        [first.id, second.id],
      );
      assert.deepEqual((await http(calendarPath(publicPath, first))).data.entries, []);
    },
  );

  await t.test(
    "two customers at the same pickup time obtain a single hold, safely replay it, and cannot approve it",
    async () => {
      const actors = [customer, other];
      const inputs = actors.map(() => ask(first));
      assert.equal((await request(first, owner, inputs[0])).data.code, "SELF_BOOKING_NOT_ALLOWED");
      assert.equal((await request(first, undefined, inputs[0])).status, 401);
      const result = await concurrent(
        actors.map((actor, i) => () => request(first, actor, inputs[i])),
      );
      assert.deepEqual(result.map((r) => r.status).sort(), [201, 409], JSON.stringify(result));
      const index = result.findIndex((r) => r.status === 201);
      winner = result[index].data.entry;
      winnerActor = actors[index];
      loserActor = actors[1 - index];
      winningInput = inputs[index];
      assert.equal(result[1 - index].data.code, "RENTAL_OVERLAP");
      assert.equal(winner.totalMinor, 7500);
      assert.equal(winner.status, "requested");
      assert.equal((await request(first, winnerActor, winningInput)).data.entry.id, winner.id);
      assert.equal(
        (await request(first, winnerActor, { ...winningInput, endsAt: at(14) })).data.code,
        "REQUEST_CONFLICT",
      );
      const range = { startsAt: at(10, 15), endsAt: at(12, 45) };
      assert.deepEqual((await http(calendarPath(publicPath, first))).data.entries, [range]);
      assert.deepEqual((await http(availabilityPath(publicPath, first))).data, {
        available: false,
      });
      assert.deepEqual((await http(availabilityPath(publicPath, second))).data, {
        available: true,
      });
      assert.deepEqual((await http(availabilityPath(publicPath, first, at(12, 45), at(15)))).data, {
        available: true,
      });
      assert.deepEqual((await http(calendarPath(publicPath, first, at(11), at(12)))).data.entries, [
        { startsAt: at(11), endsAt: at(12) },
      ]);
      assert.equal((await http(calendarPath(ownerPath, first), winnerActor)).status, 403);
      assert.equal(
        (await http(calendarPath(ownerPath, first), owner)).data.entries[0].customerName,
        winnerActor.user.name,
      );
      assert.equal((await http("mine", winnerActor)).data.entries[0].id, winner.id);
      assert.equal(
        (await http("mine?view=upcoming&page=1", winnerActor)).data.entries[0].id,
        winner.id,
      );
      assert.deepEqual((await http("mine?view=history&page=1", winnerActor)).data.entries, []);
      assert.equal((await http("mine?view=history&page=0", winnerActor)).status, 400);
      assert.equal((await http("mine?view=history&view=upcoming", winnerActor)).status, 400);
      const beforeBoundary = clock;
      try {
        clock = Date.parse(winner.endsAt) - 1;
        assert.equal((await http("mine?view=upcoming", winnerActor)).data.entries[0].id, winner.id);
        clock += 1;
        assert.deepEqual((await http("mine?view=upcoming", winnerActor)).data.entries, []);
        assert.equal((await http("mine?view=history", winnerActor)).data.entries[0].id, winner.id);
      } finally {
        clock = beforeBoundary;
      }
      assert.deepEqual((await http("mine", loserActor)).data.entries, []);
      assert.equal((await decide(winner, winnerActor, "approve")).status, 403);
      assert.equal((await decide(winner, loserActor, "cancel")).status, 404);
      assert.equal(
        (await request(first, loserActor, ask(first, at(12, 44), at(13)))).data.code,
        "RENTAL_OVERLAP",
      );
    },
  );

  await t.test(
    "different cars may overlap, the return instant is free, and the database itself excludes duplicate occupancy",
    async () => {
      const results = await Promise.all([
        request(second, loserActor, ask(second)),
        request(first, loserActor, ask(first, at(12, 45), at(15))),
      ]);
      assert.deepEqual(
        results.map((r) => r.status),
        [201, 201],
      );
      assert.equal(results[0].data.entry.totalMinor, 2500);
      assert.equal((await http(calendarPath(publicPath, second))).data.entries.length, 1);
      assert.equal((await http(calendarPath(publicPath, first))).data.entries.length, 2);
      // A separate writer cannot bypass the vehicle/time exclusion by supplying a fresh command id.
      await assert.rejects(
        pool.query(
          `INSERT INTO rental_booking
       (id,business_id,vehicle_id,vehicle_key,actor_user_id,request_id,fingerprint,vehicle_version,
        vehicle_name,business_title,timezone,customer_id,customer_name,kind,status,starts_at,
        ends_at,price_minor,price_unit,total_minor)
       SELECT $2,business_id,vehicle_id,vehicle_key,actor_user_id,$3,fingerprint,vehicle_version,
        vehicle_name,business_title,timezone,customer_id,customer_name,kind,status,starts_at,
        ends_at,price_minor,price_unit,total_minor FROM rental_booking WHERE id=$1`,
          [winner.id, randomUUID(), randomUUID()],
        ),
        { code: "23P01", constraint: "rental_booking_no_overlap" },
      );
      const approved = (await decide(winner, owner, "approve")).data.entry;
      assert.equal(approved.status, "confirmed");
      const nextPickup = await readNextAppointment(
        pool,
        winnerActor.user.id,
        new Date(approved.startsAt),
      );
      assert.equal(nextPickup.id, approved.id);
      assert.equal(nextPickup.kind, "rental");
      assert.equal(nextPickup.status, "confirmed");
      assert.equal((await decide(winner, owner, "approve")).data.entry.version, approved.version);
      assert.equal((await request(first, loserActor, ask(first))).data.code, "RENTAL_OVERLAP");
      assert.equal(
        (await http(`archive/${agency.id}/${first.id}`, owner, { expectedVersion: first.version }))
          .data.code,
        "RENTAL_HAS_BOOKINGS",
      );
      const cancelled = (await decide(approved, winnerActor, "cancel")).data.entry;
      assert.equal(cancelled.status, "cancelled");
      assert.deepEqual((await http("mine?view=upcoming", winnerActor)).data.entries, []);
      assert.equal(
        (await http("mine?view=history", winnerActor)).data.entries[0].status,
        "cancelled",
      );
      const copies = await pool.query(
        `INSERT INTO rental_booking
         (id,business_id,vehicle_id,vehicle_key,actor_user_id,request_id,fingerprint,vehicle_version,
          vehicle_name,business_title,timezone,customer_id,customer_name,kind,status,starts_at,
          ends_at,price_minor,price_unit,total_minor)
         SELECT gen_random_uuid(),business_id,vehicle_id,vehicle_key,actor_user_id,gen_random_uuid(),fingerprint,vehicle_version,
          vehicle_name,business_title,timezone,customer_id,customer_name,kind,status,starts_at,
          ends_at,price_minor,price_unit,total_minor FROM rental_booking,generate_series(1,20) WHERE id=$1 RETURNING id`,
        [winner.id],
      );
      try {
        const firstPage = (await http("mine?view=history&page=1", winnerActor)).data;
        const nextPage = (await http("mine?view=history&page=2", winnerActor)).data;
        assert.deepEqual(
          [firstPage.entries.length, firstPage.hasMore, nextPage.entries.length, nextPage.hasMore],
          [20, true, 1, false],
        );
        assert.deepEqual(
          [...firstPage.entries, ...nextPage.entries].map((entry) => entry.id),
          [winner.id, ...copies.rows.map((row) => row.id)].sort().reverse(),
        );
      } finally {
        await pool.query("DELETE FROM rental_booking WHERE id=ANY($1::uuid[])", [
          copies.rows.map((row) => row.id),
        ]);
      }
      const freed = await request(first, loserActor, ask(first));
      assert.equal(freed.status, 201);
      assert.equal(
        (await decide(freed.data.entry, owner, "decline")).data.entry.status,
        "declined",
      );
      const ownerBlock = await http(`block/${agency.id}/${first.id}`, owner, ask(first));
      assert.equal(ownerBlock.status, 201);
      assert.equal(ownerBlock.data.entry.kind, "block");
      assert.equal((await request(first, customer, ask(first))).data.code, "RENTAL_OVERLAP");
      assert.equal(
        (await decide(ownerBlock.data.entry, owner, "cancel")).data.entry.status,
        "cancelled",
      );
      assert.equal((await http(calendarPath(publicPath, first))).data.entries.length, 1);
    },
  );

  await t.test(
    "disabling a car preserves its calendar, occupied rentals cannot be cancelled after pickup, and free capacity respects archives",
    async () => {
      const pending = (await request(first, customer, ask(first, at(16), at(18)))).data.entry;
      const holding = (await http(calendarPath(ownerPath, second), owner)).data.entries[0];
      const confirmed = (await decide(holding, owner, "approve")).data.entry;
      const update = await http(ownerPath, owner, {
        ...secondFields,
        expectedVersion: second.version,
        enabled: false,
      });
      assert.equal(update.status, 200);
      assert.deepEqual(
        (await http(publicPath)).data.vehicles.map((v) => v.id),
        [first.id],
      );
      assert.equal((await http(availabilityPath(publicPath, second))).status, 404);
      assert.deepEqual((await http(availabilityPath(ownerPath, second), owner)).data, {
        available: false,
      });
      assert.equal(
        (await request(second, other, ask(second, at(19), at(20)))).data.code,
        "RENTAL_NOT_AVAILABLE",
      );
      assert.equal(
        (await http(ownerPath, owner, carFields("Novi automobil"))).data.code,
        "RENTAL_LIMIT",
      );
      assert.equal(
        (await http(calendarPath(ownerPath, second), owner)).data.entries[0].id,
        holding.id,
      );
      const initialClock = clock;
      try {
        clock = Date.parse(at(16));
        assert.equal(
          (await decide(pending, owner, "approve")).data.code,
          "RENTAL_INVALID_TRANSITION",
        );
        for (const actor of [loserActor, owner]) {
          assert.equal(
            (await decide(confirmed, actor, "cancel")).data.code,
            "RENTAL_INVALID_TRANSITION",
          );
        }
      } finally {
        clock = initialClock;
      }
      assert.equal((await decide(confirmed, loserActor, "cancel")).data.entry.status, "cancelled");
      assert.equal(
        (
          await http(`archive/${agency.id}/${second.id}`, owner, {
            expectedVersion: update.data.vehicle.version,
          })
        ).status,
        200,
      );
      assert.equal((await http(ownerPath, owner, carFields("Zamjensko vozilo"))).status, 200);
      assert.equal((await http(ownerPath, owner)).data.vehicles.length, 2);
    },
  );
  await t.test(
    "a revoked session or a listing returned to draft cannot create a rental",
    async () => {
      await auth.api.signOut({ headers: other.headers });
      assert.equal((await http("mine", other)).status, 401);
      assert.equal((await request(first, other, ask(first, at(20), at(21)))).status, 401);
      const historical = (await http("mine", customer)).data.entries.map((e) => e.id);
      assert.ok(historical.length);
      await directory.moderate(operator.headers, agency.id, {
        expectedVersion: agency.version,
        status: "draft",
        reason: "Provjera vlasničkih podataka.",
      });
      assert.equal((await http(publicPath)).status, 404);
      assert.equal((await http(calendarPath(publicPath, first))).status, 404);
      assert.equal((await http(availabilityPath(publicPath, first))).status, 404);
      assert.equal((await request(first, customer, ask(first, at(20), at(21)))).status, 404);
      assert.deepEqual(
        (await http("mine", customer)).data.entries.map((e) => e.id),
        historical,
      );
      assert.ok((await http(calendarPath(ownerPath, first), owner)).data.entries.length);
    },
  );
}
