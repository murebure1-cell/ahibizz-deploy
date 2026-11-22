import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { hashPassword } from "better-auth/crypto";
import { Pool } from "pg";
import { loadMigrations, runMigrations } from "../../scripts/migrate.mjs";
import { createAccountErasure } from "../../src/server/account-erasure.ts";
import { createAccountService, createAuthService } from "../../src/server/auth/index.ts";
import { createMessagingService } from "../../src/server/messaging/service.ts";
import { createSupportRequests } from "../../src/server/support-requests.ts";
import { integrationConfiguration } from "./postgres.test.mjs";

const baseURL = "https://erasure-ci.ahibizz.invalid";
const password = "Erasure-only-fixture-810!";
const authHeaders = new Headers({ origin: baseURL, "user-agent": "Account erasure fixture" });
const deny = (status, code) => (failure) =>
  failure.status === status && (code === undefined || failure.code === code);

test("role-bound erasure deletes private data and preserves closed financial records", {
  timeout: 60000,
}, async (t) => {
  const config = integrationConfiguration(process.env);
  const schema = `ci_erasure_${randomBytes(10).toString("hex")}`;
  assert.match(schema, /^ci_erasure_[a-f0-9]{20}$/);
  const db = new Pool({ ...config, max: 1 });
  let pool;
  try {
    assert.deepEqual(
      (await db.query("SELECT current_database() AS db,current_user AS role")).rows,
      [{ db: "ahibizz_ci", role: "ahibizz_ci" }],
    );
    await db.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ ...config, options: `-c search_path=${schema}` });
    assert.equal((await pool.query("SELECT current_schema() AS name")).rows[0].name, schema);
    const migrations = await loadMigrations();
    assert.ok(migrations.some((migration) => migration.version === "0051_account_erasure.sql"));
    await runMigrations({ pool, migrations });
    const auth = createAuthService({
      pool,
      baseURL,
      production: true,
      secret: `isolated-erasure-${randomBytes(32).toString("hex")}`,
      sendEmail: () => {
        throw Error("Unexpected external email in account erasure fixture");
      },
    });
    const accounts = createAccountService({ auth, pool });
    const support = createSupportRequests(auth, pool);
    const erase = createAccountErasure(auth, pool);
    const messages = createMessagingService({ accounts, auth, pool });
    const hashed = await hashPassword(password);
    async function fixture(name, role) {
      const id = randomUUID(),
        email = `${id}@erasure-ci.invalid`;
      await pool.query(
        `INSERT INTO auth_user(id,name,email,"emailVerified",role,approval)
         VALUES($1,$2,$3,true,$4,'approved')`,
        [id, name, email, role],
      );
      await pool.query(
        `INSERT INTO auth_account(id,"accountId","providerId","userId",password)
         VALUES($1,$2,'credential',$2,$3)`,
        [randomUUID(), id, hashed],
      );
      const signed = await auth.api.signInEmail({
        headers: authHeaders,
        body: { email, password },
        asResponse: true,
      });
      assert.equal(signed.status, 200);
      const headers = new Headers(authHeaders);
      headers.set(
        "cookie",
        signed.headers
          .getSetCookie()
          .map((line) => line.split(";")[0])
          .join("; "),
      );
      headers.set("X-AhiBizz-Account-ID", id);
      const session = await auth.api.getSession({ headers });
      assert.equal(session.user.id, id);
      return { id, email, headers, session: session.session };
    }
    const operator = await fixture("Operator fixture", "owner");
    const subject = await fixture("Osoba za brisanje", "member");
    const peer = await fixture("Drugi korisnik", "member");
    async function deletionRequest(user) {
      await support.submit(user.headers, "deletion", "", "");
      const queue = await support.pending(operator.headers, 0);
      return queue.requests.find((item) => item.subject === "deletion" && item.email === user.email)
        .id;
    }
    const request = await deletionRequest(subject);
    const ownerRequest = await deletionRequest(operator);
    const category = randomUUID(),
      listing = randomUUID(),
      otherListing = randomUUID();

    await t.test("confirm the exact request and reject wrong accounts", async () => {
      await assert.rejects(erase(peer.headers, request, subject.email), deny(403));
      await assert.rejects(
        erase(operator.headers, request, peer.email),
        deny(400, "INVALID_ERASURE_CONFIRMATION"),
      );
      await assert.rejects(
        erase(operator.headers, ownerRequest, operator.email),
        deny(403, "ERASURE_PROTECTED_ACCOUNT"),
      );
      await assert.rejects(
        erase(operator.headers, randomUUID(), subject.email),
        deny(409, "ERASURE_REQUEST_CHANGED"),
      );
      const stale = new Headers(operator.headers);
      stale.set("X-AhiBizz-Account-ID", peer.id);
      await assert.rejects(
        erase(stale, request, subject.email),
        deny(401, "ACCOUNT_IDENTITY_CHANGED"),
      );
      assert.equal((await accounts.read(subject.headers)).id, subject.id);
    });

    await pool.query(
      "INSERT INTO directory_category(id,name,slug) VALUES($1,'Brisanje QA','eris-qa')",
      [category],
    );
    await pool.query(
      `INSERT INTO directory_business(id,owner_user_id,title,category_id,contact_email,status,published_at)
       VALUES($1,$2,'Podaci firme',$3,$4,'published',now()),
             ($5,$6,'Druga firma',$3,NULL,'published',now())`,
      [listing, subject.id, category, subject.email, otherListing, peer.id],
    );
    const service = randomUUID(),
      booking = randomUUID(),
      order = randomUUID();
    await pool.query(
      "INSERT INTO booking_service(id,business_id,name,duration_minutes,price_minor) VALUES($1,$2,'Usluga',30,0)",
      [service, otherListing],
    );
    await pool.query(
      `INSERT INTO booking_entry(id,business_id,business_owner_user_id,business_title,customer_user_id,
        created_by_user_id,kind,status,service_id,service_name,duration_minutes,timezone,starts_at,
        ends_at,client_name,client_email,client_phone)
       VALUES($1,$2,$3,'Druga firma',$4,$4,'customer','confirmed',$5,'Usluga',30,'Europe/Sarajevo',
              now()+interval '1 day',now()+interval '1 day 30 minutes','Privatni korisnik',$6,'321-543')`,
      [booking, otherListing, peer.id, subject.id, service, subject.email],
    );
    await pool.query(
      `INSERT INTO paypal_checkout_order(id,user_id,request_id,fingerprint,environment,kind,offer_version,
         amount_minor,merchant_id,create_request_id,capture_request_id)
       VALUES($1,$2,$3,'account-erasure-test','live','support','v1',1200,'fixture-merchant',$4,$5)`,
      [order, subject.id, randomUUID(), randomUUID(), randomUUID()],
    );
    await t.test(
      "do not erase during a checkout or before handling future commitments",
      async () => {
        await assert.rejects(
          erase(operator.headers, request, subject.email),
          deny(409, "ERASURE_PAYMENT_PENDING"),
        );
        await pool.query(
          "UPDATE paypal_checkout_order SET status='cancelled',version=2 WHERE id=$1",
          [order],
        );
        await assert.rejects(
          erase(operator.headers, request, subject.email),
          deny(409, "ERASURE_BOOKING_PENDING"),
        );
        await pool.query("UPDATE booking_entry SET status='cancelled',version=2 WHERE id=$1", [
          booking,
        ]);
        await assert.rejects(
          erase(operator.headers, request, subject.email),
          deny(409, "ERASURE_BUSINESS_PENDING"),
        );
        await pool.query(
          `UPDATE directory_business SET status='archived',archived_at=now(),deleted_at=now(),deleted_by=$2
         WHERE id=$1`,
          [listing, subject.id],
        );
      },
    );

    await pool.query(
      `INSERT INTO personal_profile(user_id,bio,version,is_public) VALUES
         ($1,'Privatni opis',1,true),($2,'Profil druge osobe',1,true)`,
      [subject.id, peer.id],
    );
    await pool.query(
      `INSERT INTO personal_profile_image(user_id,kind,bytes,mime,width,height,version)
       VALUES($1,'photo',decode('aabb','hex'),'image/webp',512,512,1)`,
      [subject.id],
    );
    await pool.query(
      "INSERT INTO directory_saved_search(account_id,filters,label) VALUES($1,'?q=test','Privatna pretraga')",
      [subject.id],
    );
    await pool.query(
      "INSERT INTO auth_verification(id,identifier,value,\"expiresAt\") VALUES($1,'reset-password:fixture',$2,now()+interval '1 hour')",
      [randomUUID(), subject.id],
    );
    await pool.query(
      `INSERT INTO business_review(id,business_id,author_user_id,rating,body,version)
       VALUES($1,$2,$3,5,'Privatni komentar',1)`,
      [randomUUID(), otherListing, subject.id],
    );
    const { threadId } = await messages.open(
      subject.headers,
      { kind: "person", targetId: peer.id },
      randomUUID(),
    );
    await messages.send(subject.headers, threadId, { body: "Sadržaj za brisanje" }, randomUUID());
    await messages.send(peer.headers, threadId, { body: "Poruka druge osobe" }, randomUUID());
    const receipt = randomUUID();
    await pool.query(
      `INSERT INTO billing_receipt(id,kind,business_id,business_title,source,external_reference,
          received_at,gross_minor,allocation_status,created_by_user_id)
       VALUES($1,'photo_video',$2,'Dokumentovani naziv','cash','test-erasure',now(),5400,
          'not_applicable',$3)`,
      [receipt, listing, operator.id],
    );
    await t.test(
      "remove personal data, close the request and preserve unrelated data atomically",
      async () => {
        await erase(operator.headers, request, subject.email.toUpperCase());
        await erase(operator.headers, request, subject.email);
        assert.equal(await auth.api.getSession({ headers: subject.headers }), null);
        await assert.rejects(accounts.read(subject.headers), deny(401));
        assert.deepEqual(
          (
            await pool.query(
              `SELECT name,email,approval,"emailVerified",erased_at IS NOT NULL AS erased
          FROM auth_user WHERE id=$1`,
              [subject.id],
            )
          ).rows.map(({ email, ...user }) => user),
          [{ name: "Obrisan nalog", approval: "suspended", emailVerified: false, erased: true }],
        );
        assert.equal(
          (await pool.query("SELECT 1 FROM auth_user WHERE email=$1", [subject.email])).rowCount,
          0,
        );
        assert.deepEqual(
          (
            await pool.query(
              `SELECT (SELECT count(*)::int FROM auth_account WHERE "userId"=$1) AS credentials,
                  (SELECT count(*)::int FROM auth_verification WHERE value=$1) AS reset,
                  (SELECT count(*)::int FROM personal_profile WHERE user_id=$1) AS profile,
                  (SELECT count(*)::int FROM personal_profile_image WHERE user_id=$1) AS photo,
                  (SELECT count(*)::int FROM directory_saved_search WHERE account_id=$1) AS searches,
                  (SELECT count(*)::int FROM business_review WHERE author_user_id=$1) AS review,
                  (SELECT count(*)::int FROM support_request WHERE actor_id=$1) AS requests,
                  (SELECT count(*)::int FROM account_erasure_receipt
                    WHERE account_id=$1 AND processed_by=$2 AND request_id=$3) AS receipts`,
              [subject.id, operator.id, request],
            )
          ).rows[0],
          {
            credentials: 0,
            reset: 0,
            profile: 0,
            photo: 0,
            searches: 0,
            review: 0,
            requests: 0,
            receipts: 1,
          },
        );
        assert.deepEqual(
          (
            await pool.query(
              "SELECT body FROM message_message WHERE thread_id=$1 ORDER BY sequence",
              [threadId],
            )
          ).rows,
          [{ body: "[Poruka obrisana]" }, { body: "Poruka druge osobe" }],
        );
        assert.deepEqual(
          (
            await pool.query(
              "SELECT client_name,client_email,client_phone,status FROM booking_entry WHERE id=$1",
              [booking],
            )
          ).rows,
          [{ client_name: null, client_email: null, client_phone: null, status: "cancelled" }],
        );
        assert.deepEqual(
          (
            await pool.query("SELECT title,contact_email FROM directory_business WHERE id=$1", [
              listing,
            ])
          ).rows,
          [{ title: "Uklonjena djelatnost", contact_email: null }],
        );
        assert.equal(
          (await pool.query("SELECT gross_minor FROM billing_receipt WHERE id=$1", [receipt]))
            .rows[0].gross_minor,
          5400,
        );
        assert.equal((await accounts.read(peer.headers)).email, peer.email);
        await assert.rejects(
          pool.query("UPDATE auth_user SET approval='approved' WHERE id=$1", [subject.id]),
          { code: "23514" },
        );
      },
    );
  } finally {
    if (pool) {
      await pool.end();
      await db.query(`DROP SCHEMA "${schema}" CASCADE`);
    }
    await db.end();
  }
});
