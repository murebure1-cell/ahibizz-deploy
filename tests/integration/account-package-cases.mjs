import assert from "node:assert/strict";
import { createAccountPackageService } from "../../src/server/account-package.ts";
import { createAccountPackageHttpHandler } from "../../src/server/account-package-http.ts";

/** Runs last in the directory suite: it leaves the member with four businesses and a package. */
export async function testAccountPackages(
  t,
  { auth, accounts, pool, owner, member, create, baseURL, DirectoryAccessError },
) {
  const api = createAccountPackageHttpHandler(createAccountPackageService({ auth, pool }), baseURL);
  const as = (actor, accountId = actor.user.id) => {
    const headers = new Headers(actor.headers);
    headers.set("X-AhiBizz-Account-ID", accountId);
    return headers;
  };
  const request = (id, headers, body) => {
    const outgoing = new Headers(headers);
    if (body !== undefined) outgoing.set("content-type", "application/json");
    return api(
      new Request(`${baseURL}/api/admin/packages/${id}`, {
        headers: outgoing,
        method: body === undefined ? "GET" : "PUT",
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  };
  const change = (name, expectedVersion, reason = "Ručna dodjela u testu") =>
    request(member.user.id, as(owner), { package: name, expectedVersion, reason });
  const refused = async (response, status, code) => {
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { code });
  };
  const full = (title) =>
    assert.rejects(
      () => create(member, title),
      (error) =>
        error instanceof DirectoryAccessError &&
        error.status === 409 &&
        error.code === "BUSINESS_LIMIT_REACHED",
    );
  // Start from an account that keeps nothing, whatever the earlier cases left behind.
  await pool.query(
    "UPDATE directory_business SET status='archived',archived_at=now() WHERE owner_user_id=$1 AND status<>'archived'",
    [member.user.id],
  );
  const identity = {
    id: member.user.id,
    subjectLabel: member.user.name,
    identity: member.user.email,
  };

  await t.test("an account without a decision holds Basic and keeps one business", async () => {
    const response = await request(member.user.id, as(owner));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ...identity,
      package: "basic",
      version: 0,
      businesses: 0,
      businessLimit: 1,
      lastDecision: null,
    });
    await create(member, "Paket prva");
    await full("Paket druga");
    const overview = await accounts.overview(as(member));
    assert.equal(overview.package, "basic");
    assert.equal(overview.businessLimit, 1);
    assert.equal(overview.businesses, 1);
    const administrator = await accounts.overview(as(owner));
    assert.equal(administrator.package, null);
    assert.equal(administrator.businessLimit, null);
  });

  await t.test("only the signed administrator reads or changes a package", async () => {
    await refused(await request(member.user.id, as(member)), 403, "OWNER_REQUIRED");
    await refused(
      await request(member.user.id, as(member), {
        package: "business",
        expectedVersion: 0,
        reason: "Sam",
      }),
      403,
      "OWNER_REQUIRED",
    );
    await refused(await request(member.user.id, owner.headers), 401, "AUTHENTICATION_REQUIRED");
    await refused(
      await request(member.user.id, as(owner, member.user.id)),
      401,
      "ACCOUNT_IDENTITY_CHANGED",
    );
    const foreign = as(owner);
    foreign.set("origin", "https://fixture.invalid");
    await refused(
      await request(member.user.id, foreign, {
        package: "startup",
        expectedVersion: 0,
        reason: "Tuđi",
      }),
      403,
      "INVALID_ORIGIN",
    );
    await refused(await request(owner.user.id, as(owner)), 409, "TARGET_NOT_ELIGIBLE");
    await refused(await request("nepostojeci-nalog", as(owner)), 404, "NOT_FOUND");
    assert.equal(
      (await pool.query("SELECT count(*)::integer AS n FROM account_package")).rows[0].n,
      0,
    );
  });

  await t.test(
    "a higher package makes room and a lower one never undercuts what exists",
    async () => {
      await refused(await change("startup", 1), 409, "VERSION_CONFLICT");
      await refused(await change("basic", 0), 409, "PACKAGE_UNCHANGED");
      await refused(await change("startup", 0, " "), 400, "INVALID_PACKAGE_INPUT");
      const raised = await change("startup", 0);
      assert.equal(raised.status, 200);
      const startup = await raised.json();
      assert.equal(startup.package, "startup");
      assert.equal(startup.version, 1);
      assert.equal(startup.businessLimit, 3);
      assert.equal(startup.businesses, 1);
      assert.equal(startup.lastDecision.previousPackage, "basic");
      assert.equal(startup.lastDecision.reason, "Ručna dodjela u testu");
      assert.equal(startup.lastDecision.actorName, owner.user.name);
      await refused(await change("business", 0), 409, "VERSION_CONFLICT");

      await create(member, "Paket druga");
      await create(member, "Paket treća");
      await full("Paket četvrta");
      await refused(await change("basic", 1), 409, "PACKAGE_BELOW_USAGE");

      const top = await (await change("business", 1)).json();
      assert.equal(top.version, 2);
      assert.equal(top.businessLimit, 10);
      await create(member, "Paket četvrta");
      await refused(await change("startup", 2), 409, "PACKAGE_BELOW_USAGE");
      assert.deepEqual(
        (
          await pool.query(
            "SELECT result_version,previous_package,package,actor_user_id FROM account_package_decision WHERE user_id=$1 ORDER BY result_version",
            [member.user.id],
          )
        ).rows.map((row) => [
          row.result_version,
          row.previous_package,
          row.package,
          row.actor_user_id,
        ]),
        [
          [1, "basic", "startup", owner.user.id],
          [2, "startup", "business", owner.user.id],
        ],
      );
      const overview = await accounts.overview(as(member));
      assert.equal(overview.package, "business");
      assert.equal(overview.businessLimit, 10);
      assert.equal(overview.businesses, 4);
    },
  );
}
