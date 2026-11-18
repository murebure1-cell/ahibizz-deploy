import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createConnectionsService } from "../../src/server/connections/service.ts";
import { createPublicDirectoryService } from "../../src/server/directory/read-service.ts";
import { createVerificationService } from "../../src/server/verification.ts";
import { createVerificationHttpHandler } from "../../src/server/verification-http.ts";

export async function testManualVerification(
  t,
  { auth, accounts, pool, admin, member, create, archive, baseURL },
) {
  const service = createVerificationService({ auth, pool });
  const people = createConnectionsService({ auth, accounts, pool });
  const publicDirectory = createPublicDirectoryService({ database: pool });
  const api = createVerificationHttpHandler(service, baseURL);
  const person = randomUUID();
  const email = `${person}@verification-fixture.invalid`;
  await pool.query(
    `INSERT INTO auth_user(id,name,email,"emailVerified",approval) VALUES ($1,'Lični profil',$2,true,'approved')`,
    [person, email],
  );
  await pool.query("INSERT INTO personal_profile(user_id, version, is_public) VALUES ($1,1,true)", [
    person,
  ]);
  const business = await create(admin, "Ručna provjera");
  await pool.query(
    "UPDATE directory_business SET status='published',published_at=now() WHERE id=$1",
    [business.id],
  );
  const command = (expectedVersion, verified, reason = "Provjera u evidenciji") => ({
    expectedVersion,
    verified,
    reason,
  });
  const request = (kind, id, headers, body, method = "PUT") => {
    const outgoing = new Headers(headers);
    outgoing.set("content-type", "application/json");
    return api(
      new Request(`${baseURL}/api/admin/verification/${kind}/${id}`, {
        headers: outgoing,
        method,
        ...(body === undefined
          ? {}
          : { body: typeof body === "string" ? body : JSON.stringify(body) }),
      }),
    );
  };

  await t.test("verification read and grant require the same signed administrator", async () => {
    const path = ["person", person];
    const response = await request(...path, admin.headers, undefined, "GET");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      kind: "person",
      id: person,
      subjectLabel: "Lični profil",
      identity: email,
      verified: false,
      version: 0,
      lastDecision: null,
    });
    assert.equal((await request(...path, member.headers, command(0, true))).status, 403);
    assert.equal((await request(...path, member.headers, undefined, "GET")).status, 403);
    const switched = new Headers(admin.headers);
    switched.set("X-AhiBizz-Account-ID", member.user.id);
    assert.equal((await request(...path, switched, command(0, true))).status, 401);
    const foreign = new Headers(admin.headers);
    foreign.set("origin", "https://fixture.invalid");
    assert.equal((await request(...path, foreign, command(0, true))).status, 403);
    assert.equal(
      (
        await request(
          ...path,
          admin.headers,
          '{"expectedVersion":0,"verified":false,"verified":true,"reason":"Odlučeno"}',
        )
      ).status,
      400,
    );
    assert.equal((await request(...path, admin.headers, command(0, true, " "))).status, 400);
    assert.equal(
      (await request(...path, admin.headers, { ...command(0, true), role: "owner" })).status,
      400,
    );
  });

  await t.test("personal approval, revocation, stale writes and immutable audit", async () => {
    const grants = await Promise.all(
      [1, 2].map(() => request("person", person, admin.headers, command(0, true))),
    );
    assert.deepEqual(grants.map((res) => res.status).sort(), [200, 409]);
    const decision = await service.read(admin.headers, "person", person);
    assert.equal(decision.verified, true);
    assert.equal(decision.version, 1);
    assert.equal(decision.lastDecision.reason, "Provjera u evidenciji");
    assert.equal(decision.lastDecision.actorName, admin.user.name);
    const publicPerson = await people.readPublic(person);
    const searchResult = (await people.searchPublic({ q: "Lični profil" })).items.find(
      (item) => item.id === person,
    );
    for (const result of [publicPerson, searchResult]) {
      assert.equal(result.verified, true);
      for (const key of ["lastDecision", "reason", "identity", "actorName", "email"])
        assert.equal(key in result, false);
    }
    assert.equal((await service.read(admin.headers, "business", business.id)).verified, false);
    const revoke = await service.decide(
      admin.headers,
      "person",
      person,
      command(1, false, "Provjera opozvana"),
    );
    assert.equal(revoke.verified, false);
    assert.equal((await people.readPublic(person)).verified, false);
    assert.equal(revoke.version, 2);
    const records = await pool.query(
      "SELECT result_version,verified FROM profile_verification_decision WHERE kind='person' AND target_id=$1 ORDER BY result_version",
      [person],
    );
    assert.deepEqual(records.rows, [
      { result_version: 1, verified: true },
      { result_version: 2, verified: false },
    ]);
    await assert.rejects(
      pool.query("UPDATE profile_verification_decision SET reason='changed' WHERE target_id=$1", [
        person,
      ]),
      { code: "23514" },
    );
    await assert.rejects(
      pool.query("DELETE FROM profile_verification_decision WHERE target_id=$1", [person]),
      { code: "23514" },
    );
  });

  await t.test(
    "personal identity changes invalidate pending reviews and granted badges",
    async () => {
      await pool.query("UPDATE auth_user SET name='Promijenjeno ime' WHERE id=$1", [person]);
      assert.equal((await request("person", person, admin.headers, command(2, true))).status, 409);
      const fresh = await service.read(admin.headers, "person", person);
      assert.equal(fresh.subjectLabel, "Promijenjeno ime");
      await service.decide(admin.headers, "person", person, command(fresh.version, true));
      await pool.query(
        "UPDATE auth_user SET email='renamed@verification-fixture.invalid' WHERE id=$1",
        [person],
      );
      const reset = await service.read(admin.headers, "person", person);
      assert.equal(reset.verified, false);
      assert.equal(reset.identity, "renamed@verification-fixture.invalid");
      assert.equal(reset.lastDecision.actorName, null);
      assert.equal(reset.lastDecision.verified, false);
      await pool.query("UPDATE auth_user SET approval='suspended' WHERE id=$1", [person]);
      assert.equal(
        (await request("person", person, admin.headers, command(reset.version, true))).status,
        409,
      );
    },
  );

  await t.test(
    "business ownership and title changes require a fresh verification decision",
    async () => {
      const state = await service.read(admin.headers, "business", business.id);
      assert.equal(state.verified, false);
      assert.equal(state.subjectLabel, "Ručna provjera");
      assert.equal(state.identity, admin.user.id);
      const approved = await service.decide(
        admin.headers,
        "business",
        business.id,
        command(state.version, true),
      );
      const publicBusiness = await publicDirectory.readPublic(business.id);
      assert.equal(publicBusiness.verified, true);
      assert.equal("lastDecision" in publicBusiness, false);
      assert.equal(
        (await pool.query("SELECT is_verified FROM directory_business WHERE id=$1", [business.id]))
          .rows[0].is_verified,
        true,
      );
      await pool.query("UPDATE directory_business SET owner_user_id=$2 WHERE id=$1", [
        business.id,
        member.user.id,
      ]);
      const transferred = await service.read(admin.headers, "business", business.id);
      assert.equal((await publicDirectory.readPublic(business.id)).verified, false);
      assert.equal(transferred.verified, false);
      assert.equal(transferred.identity, member.user.id);
      assert.equal(transferred.lastDecision.actorName, null);
      assert.equal(
        (await request("business", business.id, admin.headers, command(approved.version, true)))
          .status,
        409,
      );
      await pool.query("UPDATE directory_business SET title='Nova djelatnost' WHERE id=$1", [
        business.id,
      ]);
      assert.equal(
        (await request("business", business.id, admin.headers, command(transferred.version, true)))
          .status,
        409,
      );
      const renamed = await service.read(admin.headers, "business", business.id);
      assert.equal(renamed.subjectLabel, "Nova djelatnost");
      const granted = await service.decide(
        admin.headers,
        "business",
        business.id,
        command(renamed.version, true),
      );
      await service.decide(admin.headers, "business", business.id, command(granted.version, false));
      await pool.query("UPDATE directory_business SET owner_user_id=$2 WHERE id=$1", [
        business.id,
        admin.user.id,
      ]);
      await archive(business);
      const archived = await service.read(admin.headers, "business", business.id);
      assert.equal(
        (await request("business", business.id, admin.headers, command(archived.version, true)))
          .status,
        409,
      );
    },
  );
}
