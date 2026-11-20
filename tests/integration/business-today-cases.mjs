import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createAccountHttpHandler } from "../../src/server/account-http.ts";
import { readBusinessToday } from "../../src/server/business-today.ts";

export async function testBusinessToday(
  t,
  { pool, accounts, operator, customer, business, baseURL },
) {
  await t.test(
    "owner day covers the DST boundary, vehicle occupancy, arrivals and departures, and only the selected business inbox",
    async () => {
      const owner = operator.user.id,
        guest = customer.user.id;
      const client = await pool.connect();
      const id = randomUUID(),
        other = randomUUID(),
        service = randomUUID(),
        vehicle = randomUUID(),
        unit = randomUUID();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO directory_business (id,title,owner_user_id,category_id,status) VALUES
      ($1,'Nacrt za raspored',$3,$4,'draft'),($2,'Drugi posao',$3,$4,'pending')`,
          [id, other, owner, business.categoryId],
        );
        await client.query(
          "INSERT INTO booking_settings(business_id,enabled,timezone,windows,version) VALUES ($1,false,'Europe/Sarajevo','[]',1)",
          [id],
        );
        await client.query(
          "INSERT INTO booking_service(id,business_id,name,duration_minutes,price_minor) VALUES($1,$2,'Pregled',30,0)",
          [service, id],
        );
        const appoint = async (start, status) => {
          await client.query(
            `INSERT INTO booking_entry (id,business_id,business_owner_user_id,business_title,customer_user_id,created_by_user_id,
        kind,status,service_id,service_name,duration_minutes,timezone,starts_at,ends_at)
        VALUES($1,$2,$3,'Nacrt',$4,$4,'customer',$5,$6,'Pregled',30,'Europe/Sarajevo',$7,$7::timestamptz+interval '30 min')`,
            [randomUUID(), id, owner, guest, status, service, start],
          );
        };
        // The Sarajevo clock moves back on 25 October 2026. Test both edges of the 25-hour day.
        await appoint("2026-10-24T21:30Z", "confirmed");
        await appoint("2026-10-24T22:00Z", "confirmed");
        await appoint("2026-10-25T22:30Z", "confirmed");
        await appoint("2026-10-25T23:00Z", "requested");
        await appoint("2026-10-25T12:00Z", "cancelled");
        await client.query(
          `INSERT INTO rental_vehicle (id,business_id,free_slot,name,brand,model,seats,fuel,transmission,price_minor,price_unit,enabled)
      VALUES($1,$2,1,'Vozilo','Marka','Model',4,'diesel','manual',100,'day',true)`,
          [vehicle, id],
        );
        await client.query(
          `INSERT INTO rental_booking (id,business_id,vehicle_id,vehicle_key,actor_user_id,request_id,fingerprint,vehicle_version,
      vehicle_name,business_title,timezone,customer_id,customer_name,kind,status,starts_at,ends_at,price_minor,price_unit,total_minor)
      SELECT $1,business_id,id,vehicle_key,$3,$1,repeat('a',64),1,'Vozilo','Nacrt','Europe/Sarajevo',$3,'Gost','customer','confirmed',
      '2026-10-24T11:30Z','2026-10-26T12:30Z',100,'day',300 FROM rental_vehicle WHERE id=$2`,
          [randomUUID(), vehicle, guest],
        );
        await client.query(
          "INSERT INTO stay_unit (id,business_id,free_slot,name,type,beds,price_minor,enabled) VALUES($1,$2,1,'Soba','room',2,100,true)",
          [unit, id],
        );
        for (const [from, to, status] of [
          ["2026-10-24", "2026-10-25", "confirmed"],
          ["2026-10-25", "2026-10-26", "requested"],
        ]) {
          await client.query(
            `INSERT INTO stay_booking (id,business_id,unit_id,unit_key,actor_user_id,request_id,fingerprint,unit_version,unit_name,
        business_title,timezone,customer_id,customer_name,kind,status,check_in,check_out,price_minor,total_minor)
        SELECT $1,business_id,id,unit_key,$3,$1,repeat('b',64),1,'Soba','Nacrt','Europe/Sarajevo',$3,'Gost','customer',$4,$5,$6,100,100
        FROM stay_unit WHERE id=$2`,
            [randomUUID(), unit, guest, status, from, to],
          );
        }
        const inquiry = async (businessId) => {
          const thread = randomUUID();
          await client.query(
            `INSERT INTO message_thread(id,kind,left_user_id,right_user_id,business_id,created_by_user_id,latest_sequence)
        VALUES($1,'business',$2,$3,$4,$2,0)`,
            [thread, guest, owner, businessId],
          );
          await client.query(
            "INSERT INTO message_thread_member(thread_id,user_id) VALUES($1,$2),($1,$3)",
            [thread, owner, guest],
          );
          await client.query("UPDATE message_thread SET latest_sequence=1 WHERE id=$1", [thread]);
          await client.query(
            "INSERT INTO message_message(id,thread_id,sender_user_id,sequence,body) VALUES($1,$2,$3,1,'Upit')",
            [randomUUID(), thread, guest],
          );
          return thread;
        };
        const thread = await inquiry(id);
        await inquiry(other);
        const read = () => readBusinessToday(client, owner, id, new Date("2026-10-25T12:00Z"));
        const result = await read();
        assert.equal(result.selectedId, id);
        assert.ok(result.businesses.some((b) => b.id === other));
        assert.ok(!result.businesses.some((b) => b.id === business.id));
        const [appointments, rentals, stays] = result.agendas;
        assert.deepEqual(
          [appointments.total, appointments.pending, appointments.pendingDay],
          [2, 1, "2026-10-26"],
        );
        assert.deepEqual(
          appointments.entries.map((e) => e.time),
          ["00:00", "23:30"],
        );
        assert.equal(rentals.total, 1);
        assert.deepEqual(
          stays.entries.map((e) => e.time),
          ["Odlazak", "Dolazak"],
        );
        assert.equal(stays.pending, 1);
        assert.deepEqual(result.inquiries, { threadId: thread, count: 1 });
        await client.query(
          "UPDATE message_thread_member SET read_sequence=1 WHERE thread_id=$1 AND user_id=$2",
          [thread, owner],
        );
        assert.deepEqual((await read()).inquiries, { threadId: null, count: 0 });
        assert.equal(await readBusinessToday(client, guest, id), null);
        const empty = await readBusinessToday(client, owner, other, new Date("2026-10-25T12:00Z"));
        assert.equal(empty.agendas[0].total, 0);
        assert.equal(empty.inquiries.count, 1);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    },
  );
  await t.test(
    "only the exact signed-in owner reads the business-day endpoint, even when the caller administers the platform",
    async () => {
      const http = createAccountHttpHandler({ service: accounts, baseURL });
      const request = (search, headers) =>
        http(new Request(`${baseURL}/api/account/business-today${search}`, { headers }));
      assert.equal((await request("", {})).status, 401);
      assert.equal((await request(`?djelatnost=${business.id}`, operator.headers)).status, 404);
      assert.equal((await request("?djelatnost=not-valid", operator.headers)).status, 400);
      const mismatch = new Headers(operator.headers);
      mismatch.set("X-AhiBizz-Account-ID", customer.user.id);
      assert.ok([401, 403].includes((await request("", mismatch)).status));
      const res = await request("", operator.headers);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.equal((await res.json()).accountId, operator.user.id);
    },
  );
}
