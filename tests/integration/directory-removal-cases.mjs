import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function testDirectoryRemoval(
  t,
  { pool, directoryRequest, owner, member, other, categoryId },
) {
  async function fixture() {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO directory_business (id,owner_user_id,title,category_id,status,package_access)
       VALUES($1,$2,'Uklanjanje QA',$3,'published','first_year')`,
      [id, member.user.id, categoryId],
    );
    return id;
  }
  function remove(id, actor = member, expectedVersion = 1) {
    return directoryRequest("DELETE", `/api/directory/mine/${id}`, {
      actor,
      body: { expectedVersion },
    });
  }
  async function blocked(id, code) {
    assert.deepEqual(await remove(id), { status: 409, data: { code } });
    assert.equal(
      (await directoryRequest("GET", `/api/directory/mine/${id}`, { actor: member })).status,
      200,
    );
  }

  await t.test(
    "permanent removal checks actor and version, disappears from every list, cannot be recovered",
    async () => {
      const id = await fixture();
      assert.equal((await remove(id, other)).status, 404);
      assert.equal((await remove(id, member, 9)).data.code, "VERSION_CONFLICT");
      assert.equal(
        (
          await directoryRequest("DELETE", `/api/directory/mine/${id}`, {
            actor: member,
            body: { expectedVersion: 1 },
            origin: "https://other.invalid",
          })
        ).status,
        403,
      );
      const results = await Promise.all([remove(id), remove(id)]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 404]);
      assert.deepEqual(results.find((r) => r.status === 200).data, { deleted: true });
      for (const [route, actor] of [
        [`/api/directory/mine/${id}`, member],
        [`/api/directory/mine/${id}`, owner],
        [`/api/directory/businesses/${id}`, null],
      ]) {
        assert.equal((await directoryRequest("GET", route, { actor })).status, 404);
      }
      for (const [route, actor] of [
        ["/api/directory/mine?status=archived&q=Uklanjanje", member],
        ["/api/directory/admin?status=archived&q=Uklanjanje", owner],
        ["/api/directory/review?q=Uklanjanje", owner],
        ["/api/directory/businesses?q=Uklanjanje", null],
      ]) {
        const result = await directoryRequest("GET", route, { actor });
        assert.equal(result.status, 200);
        assert.ok(!result.data.items.some((row) => row.id === id));
      }
      assert.equal(
        (
          await directoryRequest("POST", `/api/directory/mine/${id}/recover`, {
            actor: owner,
            body: { expectedVersion: 2 },
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await directoryRequest("PATCH", `/api/directory/mine/${id}`, {
            actor: owner,
            body: { expectedVersion: 2, title: "Novo ime" },
          })
        ).status,
        404,
      );
      const tombstone = (
        await pool.query(
          "SELECT status,package_access,version,deleted_at,deleted_by FROM directory_business WHERE id=$1",
          [id],
        )
      ).rows[0];
      assert.equal(tombstone.version, 2);
      assert.equal(tombstone.status, "archived");
      assert.equal(tombstone.package_access, "first_year");
      assert.equal(tombstone.deleted_by, member.user.id);
      assert.ok(tombstone.deleted_at);
      await assert.rejects(
        pool.query("UPDATE directory_business SET deleted_at=NULL,deleted_by=NULL WHERE id=$1", [
          id,
        ]),
        (err) => err.code === "23514",
      );
      const managed = await fixture();
      assert.equal((await remove(managed, owner)).status, 200);
      assert.equal(
        (await pool.query("SELECT deleted_by FROM directory_business WHERE id=$1", [managed]))
          .rows[0].deleted_by,
        owner.user.id,
      );
    },
  );

  await t.test(
    "open service, vehicle and accommodation bookings prevent removal, resolved entries keep their history",
    async () => {
      const id = await fixture();
      const service = randomUUID(),
        vehicle = randomUUID(),
        unit = randomUUID();
      await pool.query(
        "INSERT INTO booking_service(id,business_id,name,duration_minutes,price_minor) VALUES ($1,$2,'QA',30,0)",
        [service, id],
      );
      await pool.query(
        `INSERT INTO booking_entry(id,business_id,business_owner_user_id,business_title,created_by_user_id,kind,status,service_id,service_name,duration_minutes,timezone,starts_at,ends_at)
      VALUES($1,$2,$3,'QA',$3,'manual','confirmed',$4,'QA',30,'Europe/Sarajevo',now()+interval '1 day',now()+interval '1 day 30 minutes')`,
        [randomUUID(), id, member.user.id, service],
      );
      await blocked(id, "BUSINESS_HAS_BOOKINGS");
      await pool.query("UPDATE booking_entry SET status='completed' WHERE business_id=$1", [id]);
      await pool.query(
        "INSERT INTO rental_vehicle(id,business_id,free_slot,name,brand,model,seats,fuel,transmission,price_minor,price_unit,enabled,version) VALUES($1,$2,1,'QA','QA','QA',5,'diesel','manual',0,'day',true,1)",
        [vehicle, id],
      );
      await pool.query(
        `INSERT INTO rental_booking(id,business_id,vehicle_id,vehicle_key,actor_user_id,request_id,fingerprint,vehicle_version,vehicle_name,business_title,timezone,customer_id,customer_name,kind,status,starts_at,ends_at,price_minor,price_unit,total_minor)
      SELECT $1,$2,id,vehicle_key,$3,$4,repeat('a',64),1,'QA','QA','Europe/Sarajevo',$3,'QA','customer','requested',now()+interval '1 day',now()+interval '2 days',0,'day',0 FROM rental_vehicle WHERE id=$5`,
        [randomUUID(), id, other.user.id, randomUUID(), vehicle],
      );
      await blocked(id, "BUSINESS_HAS_BOOKINGS");
      await pool.query("UPDATE rental_booking SET status='declined' WHERE business_id=$1", [id]);
      await pool.query(
        "INSERT INTO stay_unit(id,business_id,free_slot,name,type,beds,price_minor,enabled,version) VALUES($1,$2,1,'QA','room',2,0,true,1)",
        [unit, id],
      );
      await pool.query(
        `INSERT INTO stay_booking(id,business_id,unit_id,unit_key,actor_user_id,request_id,fingerprint,unit_version,unit_name,business_title,timezone,customer_id,customer_name,kind,status,check_in,check_out,price_minor,total_minor)
      SELECT $1,$2,id,unit_key,$3,$4,repeat('b',64),1,'QA','QA','Europe/Sarajevo',$3,'QA','customer','confirmed',current_date+1,current_date+2,0,0 FROM stay_unit WHERE id=$5`,
        [randomUUID(), id, other.user.id, randomUUID(), unit],
      );
      await blocked(id, "BUSINESS_HAS_BOOKINGS");
      await pool.query("UPDATE stay_booking SET status='cancelled' WHERE business_id=$1", [id]);
      assert.equal((await remove(id)).status, 200);
      for (const table of ["booking_entry", "rental_booking", "stay_booking"]) {
        assert.equal(
          (
            await pool.query(`SELECT count(*)::int AS count FROM ${table} WHERE business_id=$1`, [
              id,
            ])
          ).rows[0].count,
          1,
        );
      }
    },
  );

  await t.test("completed credit coverage protects removal only until its paid end", async () => {
    const id = await fixture();
    const contractId = randomUUID();
    await pool.query(
      `INSERT INTO live_package_contract(id,user_id,business_id,business_title,request_id,package_id,period,amount_bam_minor,amount_eur_minor,total_cycles,benefits_version,nearby_days,featured_days,payment_method,cycle_credit_minor,plan_id,status,paid_cycles,starts_at,ends_at)
       VALUES($1,$2,$3,'QA',$4,'basic','annual',29000,14827,1,1,0,0,'credits',29000,NULL,'ACTIVE',1,now()-interval '11 months',now()+interval '1 month')`,
      [contractId, member.user.id, id, randomUUID()],
    );
    await blocked(id, "BUSINESS_HAS_CONTRACT");
    await pool.query(
      "UPDATE live_package_contract SET starts_at=now()-interval '13 months',ends_at=now()-interval '1 month' WHERE id=$1",
      [contractId],
    );
    assert.equal((await remove(id)).status, 200);
    assert.equal(
      (await pool.query("SELECT paid_cycles FROM live_package_contract WHERE id=$1", [contractId]))
        .rows[0].paid_cycles,
      1,
    );
  });

  await t.test(
    "active contracts, paid coverage and unsettled payments are protected; untouched offers close",
    async () => {
      const id = await fixture();
      await pool.query(
        `INSERT INTO live_package_contract(id,user_id,business_id,business_title,request_id,package_id,period,amount_bam_minor,amount_eur_minor,total_cycles,benefits_version,nearby_days,featured_days,plan_id,status,ends_at)
      VALUES($1,$2,$3,'QA',$4,'basic','annual',29000,14827,1,1,0,0,'qa','ACTIVE',now()+interval '10 days')`,
        [randomUUID(), member.user.id, id, randomUUID()],
      );
      await blocked(id, "BUSINESS_HAS_CONTRACT");
      await pool.query("UPDATE live_package_contract SET status='CANCELLED' WHERE business_id=$1", [
        id,
      ]);
      await blocked(id, "BUSINESS_HAS_CONTRACT");
      await pool.query(
        "UPDATE live_package_contract SET ends_at=now()-interval '1 day' WHERE business_id=$1",
        [id],
      );
      await pool.query(
        `INSERT INTO marketing_order(id,account_id,kind,business_id,quantity,status,amount_minor,instructions,quoted_by,quoted_at)
      VALUES($1,$2,'banner',$3,1,'quoted',1000,'Probna ponuda',$4,now())`,
        [randomUUID(), member.user.id, id, owner.user.id],
      );
      const orderId = randomUUID();
      await pool.query(
        `INSERT INTO paypal_checkout_order(id,user_id,request_id,fingerprint,environment,kind,business_id,category_id,business_title,offer_version,original_bam_minor,amount_minor,merchant_id,create_request_id,capture_request_id,status)
       VALUES($1,$2,$3,'qa','live','promotion',$4,$5,'QA','qa',1000,511,'qa',$6,$7,'review')`,
        [orderId, member.user.id, randomUUID(), id, categoryId, randomUUID(), randomUUID()],
      );
      await blocked(id, "BUSINESS_HAS_PAYMENTS");
      await pool.query("UPDATE paypal_checkout_order SET status='cancelled' WHERE id=$1", [
        orderId,
      ]);
      assert.equal((await remove(id)).status, 200);
      assert.equal(
        (await pool.query("SELECT status FROM marketing_order WHERE business_id=$1", [id])).rows[0]
          .status,
        "closed",
      );
      assert.equal(
        (await pool.query("SELECT status FROM live_package_contract WHERE business_id=$1", [id]))
          .rows[0].status,
        "CANCELLED",
      );
    },
  );
}
