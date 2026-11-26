import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import {
  administrationSignInEmail,
  createAdministration,
  handOverAdministration,
  readAdministration,
  renewAdministrationLink,
} from "../../src/server/auth/administration.ts";
import { readCurrentAuthUser } from "../../src/server/auth/index.ts";
import { createAuthHttpHandler } from "../../src/server/auth-http.ts";
import { readPublicMenu, saveOwnMenu } from "../../src/server/business-menu.ts";
import { recordView, viewTarget } from "../../src/server/views.ts";

/**
 * Runs last in the directory suite: it separates the administration, so the bootstrapped owner
 * ends as an ordinary founder account and a new administration account holds the owner role.
 */
export async function testAdministration(t, { auth, pool, owner, member, create, baseURL }) {
  const authHttp = createAuthHttpHandler({
    auth,
    baseURL,
    readUser: (id) => readCurrentAuthUser(pool, id),
    signInName: (name) => administrationSignInEmail(pool, name),
  });
  const authRequest = (method, route, body) => {
    const headers = new Headers({ origin: baseURL, "user-agent": "Isolated administration" });
    if (body !== undefined) headers.set("content-type", "application/json");
    return authHttp(
      new Request(new URL(route, baseURL), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  };
  const refused = (operation, status, code) =>
    assert.rejects(operation, (error) => error.status === status && error.code === code);
  const audit = async (action) =>
    (
      await pool.query(
        "SELECT actor_user_id,target_user_id,previous_role,next_role FROM auth_account_audit WHERE action=$1 ORDER BY created_at,id",
        [action],
      )
    ).rows;
  let link;
  let administration;

  await t.test("only the owner creates the administration account, once", async () => {
    await refused(() => readAdministration(auth, pool, member.headers), 403, "OWNER_REQUIRED");
    await refused(
      () => createAdministration(auth, pool, member.headers, baseURL),
      403,
      "OWNER_REQUIRED",
    );
    assert.deepEqual(await readAdministration(auth, pool, owner.headers), {
      actor: "founder-owner",
      administration: null,
      handOverPending: true,
    });
    ({ link } = await createAdministration(auth, pool, owner.headers, baseURL));
    assert.equal(new URL(link).origin, baseURL);
    assert.match(new URL(link).pathname, /^\/api\/auth\/reset-password\/[A-Za-z0-9_-]{32}$/);
    administration = (
      await pool.query(
        `SELECT id,name,email,"emailVerified",role,approval,account_kind,founder FROM auth_user WHERE account_kind='administration'`,
      )
    ).rows[0];
    assert.deepEqual(
      { ...administration, id: undefined },
      {
        id: undefined,
        name: "AhiBizz administracija",
        email: "administracija@ahibizz.com",
        emailVerified: true,
        role: "owner",
        approval: "approved",
        account_kind: "administration",
        founder: false,
      },
    );
    assert.deepEqual(await audit("create-administration"), [
      {
        actor_user_id: owner.user.id,
        target_user_id: administration.id,
        previous_role: "member",
        next_role: "owner",
      },
    ]);
    assert.equal(
      (
        await pool.query(`SELECT count(*)::int AS n FROM auth_account WHERE "userId"=$1`, [
          administration.id,
        ])
      ).rows[0].n,
      0,
    );
    await refused(
      () => createAdministration(auth, pool, owner.headers, baseURL),
      409,
      "ADMINISTRATION_EXISTS",
    );
  });

  await t.test("the one-time link sets the password once and a new link replaces it", async () => {
    const stale = link;
    ({ link } = await renewAdministrationLink(auth, pool, owner.headers, baseURL));
    const staleToken = new URL(stale).pathname.split("/").pop();
    assert.equal(
      (
        await authRequest("POST", "/api/auth/reset-password", {
          newPassword: "x".repeat(16),
          token: staleToken,
        })
      ).status,
      400,
    );
    const opened = await authRequest("GET", `${new URL(link).pathname}${new URL(link).search}`);
    assert.equal(opened.status, 302);
    const token = new URL(opened.headers.get("location")).searchParams.get("token");
    assert.ok(token);
    const password = `Admin-${randomBytes(12).toString("hex")}`;
    const set = await authRequest("POST", "/api/auth/reset-password", {
      newPassword: password,
      token,
    });
    assert.equal(set.status, 200);
    assert.equal(
      (await authRequest("POST", "/api/auth/reset-password", { newPassword: password, token }))
        .status,
      400,
    );
    assert.deepEqual((await readAdministration(auth, pool, owner.headers)).administration, {
      email: "administracija@ahibizz.com",
      passwordSet: true,
    });
    const signed = await authRequest("POST", "/api/auth/sign-in/email", {
      email: "Administrator",
      password,
    });
    assert.equal(signed.status, 200);
    const cookie = signed.headers
      .getSetCookie()
      .map((line) => line.split(";", 1)[0])
      .join("; ");
    administration.headers = new Headers({ origin: baseURL, cookie });
    assert.equal(
      (await auth.api.getSession({ headers: administration.headers })).user.id,
      administration.id,
    );
    assert.equal(
      (
        await authRequest("POST", "/api/auth/sign-in/email", {
          email: "administrator",
          password: "wrong-password-1",
        })
      ).status,
      401,
    );
  });

  await t.test(
    "the administration hands over: the founder becomes an ordinary account",
    async () => {
      await refused(
        () => handOverAdministration(auth, pool, owner.headers),
        403,
        "ADMINISTRATION_REQUIRED",
      );
      assert.deepEqual(await readAdministration(auth, pool, administration.headers), {
        actor: "administration",
        administration: { email: "administracija@ahibizz.com", passwordSet: true },
        handOverPending: true,
      });
      assert.deepEqual(await handOverAdministration(auth, pool, administration.headers), {
        ok: true,
      });
      assert.deepEqual(
        (
          await pool.query("SELECT role,founder,account_kind FROM auth_user WHERE id=$1", [
            owner.user.id,
          ])
        ).rows[0],
        { role: "member", founder: true, account_kind: "personal" },
      );
      assert.deepEqual(await audit("hand-over-administration"), [
        {
          actor_user_id: administration.id,
          target_user_id: owner.user.id,
          previous_role: "owner",
          next_role: "member",
        },
      ]);
      await refused(
        () => handOverAdministration(auth, pool, administration.headers),
        409,
        "HAND_OVER_DONE",
      );
      await refused(() => readAdministration(auth, pool, owner.headers), 403, "OWNER_REQUIRED");
      // Only one founder and one administration account can ever exist.
      await assert.rejects(() =>
        pool.query("UPDATE auth_user SET founder=true WHERE id=$1", [member.user.id]),
      );
      await assert.rejects(() =>
        pool.query("UPDATE auth_user SET founder=true WHERE id=$1", [administration.id]),
      );
    },
  );

  await t.test("the founder keeps businesses beyond every package", async () => {
    const held = (
      await pool.query(
        "SELECT count(*)::int AS n FROM directory_business WHERE owner_user_id=$1 AND status<>'archived'",
        [owner.user.id],
      )
    ).rows[0].n;
    assert.ok(held >= 1);
    const extra = Math.max(0, 2 - held);
    for (let index = 0; index <= extra; index++)
      await create(owner, `Founder business ${randomUUID().slice(0, 8)}`);
  });

  await t.test("views are counted per day, never the owner's own", async () => {
    const business = (
      await pool.query(
        "SELECT b.id, b.owner_user_id FROM directory_business b JOIN auth_user u ON u.id=b.owner_user_id WHERE b.status='published' AND b.deleted_at IS NULL AND u.approval='approved' LIMIT 1",
      )
    ).rows[0];
    assert.equal(viewTarget("business", "not-a-uuid"), null);
    assert.equal(viewTarget("other", "x"), null);
    if (!business) return;
    const target = viewTarget("business", business.id);
    assert.equal(await recordView(pool, target, null), true);
    assert.equal(await recordView(pool, target, member.user.id), true);
    assert.equal(await recordView(pool, target, business.owner_user_id), false);
    const row = (
      await pool.query("SELECT sum(views)::int AS n FROM business_view_day WHERE business_id=$1", [
        business.id,
      ])
    ).rows[0];
    assert.equal(row.n, 2);
  });

  await t.test("only the business owner writes its menu, guarded by version", async () => {
    const business = (
      await pool.query(
        "SELECT id, status FROM directory_business WHERE owner_user_id=$1 AND deleted_at IS NULL AND status<>'archived' LIMIT 1",
        [member.user.id],
      )
    ).rows[0];
    if (!business) return;
    const input = {
      items: [{ name: "Begova čorba", priceCents: 700 }],
      meat: [{ kind: "Piletina", supplier: "Mesnica" }],
      expectedVersion: 0,
    };
    await assert.rejects(
      () => saveOwnMenu(auth, pool, owner.headers, business.id, input),
      (error) => error.status === 404,
    );
    const saved = await saveOwnMenu(auth, pool, member.headers, business.id, input);
    assert.equal(saved.version, 1);
    await assert.rejects(
      () => saveOwnMenu(auth, pool, member.headers, business.id, input),
      (error) => error.status === 409,
    );
    const shown = await readPublicMenu(pool, business.id);
    if (business.status === "published") assert.deepEqual(shown.items, input.items);
    else assert.deepEqual(shown.items, []);
  });
}
