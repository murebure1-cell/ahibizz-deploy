import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { loadMigrations, runMigrations } from "../../scripts/migrate.mjs";
import {
  promotionCapacity,
  promotionPrices,
  promotionStatusLabel,
} from "../../src/lib/promotions.ts";
import { createPublicDirectoryService } from "../../src/server/directory/read-service.ts";
import { createPromotionsHttpHandler } from "../../src/server/promotions/http.ts";
import { activePromotionSql } from "../../src/server/promotions/read.ts";
import { createPromotionsService } from "../../src/server/promotions/service.ts";
import { integrationConfiguration } from "./postgres.test.mjs";

const baseURL = "https://promotions-ci.ahibizz.invalid";
const bank = {
  recipient: "Isolated fixture",
  name: "Fixture bank",
  currency: "EUR",
  iban: "GB82 WEST 1234 5698 7654 32",
  accountNumber: null,
  bic: null,
  address: null,
  note: null,
};
const denial = (status, code) => (error) =>
  error.status === status && (!code || error.code === code);

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  test("isolated promotions migration, purchase, confirmation, capacity and free visibility", {
    timeout: 120000,
  }, async (t) => {
    const configuration = integrationConfiguration(process.env);
    const schema = `ci_promotions_${randomBytes(10).toString("hex")}`;
    assert.match(schema, /^ci_promotions_[a-f0-9]{20}$/);
    const { Pool } = await import("pg");
    const control = new Pool({ ...configuration, max: 1 });
    control.on("error", () => {});
    let pool;
    let created = false;
    const originalFetch = globalThis.fetch;
    const outsideTables = async () =>
      (
        await control.query(
          "SELECT schemaname,tablename FROM pg_catalog.pg_tables WHERE schemaname !~ '^pg_' AND schemaname NOT IN ('information_schema',$1) ORDER BY schemaname,tablename",
          [schema],
        )
      ).rows;
    let outside;
    try {
      assert.deepEqual(
        (await control.query("SELECT current_database() AS db,current_user AS role")).rows,
        [{ db: "ahibizz_ci", role: "ahibizz_ci" }],
      );
      outside = await outsideTables();
      assert.equal(
        (await control.query("SELECT 1 FROM pg_namespace WHERE nspname=$1", [schema])).rowCount,
        0,
      );
      await control.query(`CREATE SCHEMA "${schema}"`);
      created = true;
      pool = new Pool({
        ...configuration,
        max: 12,
        options: `-c search_path=${schema}`,
        application_name: schema,
      });
      pool.on("error", () => {});
      const migrations = await loadMigrations();
      assert.equal(migrations.at(-1).version, "0054_promotions.sql");
      await runMigrations({ pool, migrations: migrations.slice(0, -1) });
      const actors = [];
      for (const [index, role] of ["owner", "member", "member"].entries()) {
        const user = {
          id: randomUUID(),
          role,
          name: `Promotion fixture ${index}`,
          email: `fixture-${index}@${schema}.invalid`,
          emailVerified: true,
          approval: "approved",
        };
        await pool.query(
          "INSERT INTO auth_user(id,name,email,\"emailVerified\",role,approval,\"createdAt\") VALUES($1,$2,$3,true,$4,'approved',now()-interval '3 years')",
          [user.id, user.name, user.email, role],
        );
        const session = {
          id: randomUUID(),
          userId: user.id,
          token: randomBytes(24).toString("hex"),
        };
        await pool.query(
          'INSERT INTO auth_session(id,"userId",token,"expiresAt") VALUES($1,$2,$3,now()+interval \'1 day\')',
          [session.id, user.id, session.token],
        );
        actors.push({
          user,
          session,
          headers: new Headers({
            origin: baseURL,
            "X-AhiBizz-Account-ID": user.id,
            cookie: session.token,
          }),
        });
      }
      const [admin, owner, other] = actors;
      const auth = {
        api: {
          getSession: async ({ headers }) => {
            const actor = actors.find(
              (candidate) => candidate.session.token === headers.get("cookie"),
            );
            return actor ? { user: actor.user, session: actor.session } : null;
          },
        },
      };
      const category = randomUUID();
      const otherCategory = randomUUID();
      await pool.query(
        "INSERT INTO directory_category(id,name,slug) VALUES($1,'Fixture services','fixture-services'),($2,'Other services','other-services')",
        [category, otherCategory],
      );
      const addBusiness = async (actor = owner, city = "Tuzla", categoryId = category) => {
        const businessId = randomUUID();
        await pool.query(
          "INSERT INTO directory_business(id,owner_user_id,title,category_id,city,status,published_at,created_at) VALUES($1,$2,$3,$4,$5,'published',now()-interval '3 years',now()-interval '3 years')",
          [businessId, actor.user.id, `Fixture ${businessId}`, categoryId, city],
        );
        return businessId;
      };
      const businessId = await addBusiness();
      const foreignBusiness = await addBusiness(other);
      const archivedOrder = randomUUID();
      await pool.query(
        "INSERT INTO marketing_order(id,account_id,kind,business_id,quantity) VALUES($1,$2,'featured',$3,7)",
        [archivedOrder, owner.user.id, businessId],
      );
      const archive = (
        await pool.query("SELECT to_jsonb(o) AS value FROM marketing_order o WHERE id=$1", [
          archivedOrder,
        ])
      ).rows[0].value;
      await runMigrations({ pool, migrations });
      assert.deepEqual(await runMigrations({ pool, migrations }), { applied: [] });
      globalThis.fetch = async () => {
        throw new Error("Outbound HTTP forbidden in isolated promotion tests");
      };
      const service = createPromotionsService({ pool, auth, bank: () => bank, play: false });
      const http = createPromotionsHttpHandler({ service, baseURL, play: false });
      const directory = createPublicDirectoryService({ database: pool });
      const input = (
        kind = "home",
        id = businessId,
        startsAt = new Date(Date.now() - 1000).toISOString(),
        durationDays = 7,
      ) => ({ businessId: id, kind, startsAt, durationDays });
      const confirmed = (order, currency = "EUR", statementReference) => ({
        currency,
        amountMinor: currency === "EUR" ? order.amountEurMinor : order.amountBamMinor,
        paymentReference: order.paymentReference,
        ...(statementReference ? { statementReference } : {}),
      });
      const request = async (method, route, actor, body) =>
        http(
          new Request(`${baseURL}${route}`, {
            method,
            headers: { ...Object.fromEntries(actor.headers), "content-type": "application/json" },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          }),
        );
      const promoted = async (id, kind) =>
        (
          await pool.query(
            `SELECT ${activePromotionSql("b", kind)} AS active FROM directory_business b WHERE b.id=$1`,
            [id],
          )
        ).rows[0].active;

      await t.test(
        "migration preserves the archive and published listings remain visible without any package",
        async () => {
          assert.deepEqual(
            (
              await pool.query("SELECT to_jsonb(o) AS value FROM marketing_order o WHERE id=$1", [
                archivedOrder,
              ])
            ).rows[0].value,
            archive,
          );
          assert.deepEqual(
            (
              await pool.query(
                "SELECT package_allows_listing(b) AS visible,paid_package_placement(b,'featured') AS old_featured FROM directory_business b WHERE b.id=$1",
                [businessId],
              )
            ).rows[0],
            { visible: true, old_featured: false },
          );
          assert.equal((await directory.readPublic(businessId)).id, businessId);
          assert.ok((await directory.listPublic()).items.some((item) => item.id === businessId));
          const prices = (await service.list(owner.headers)).prices.sort(
            (a, b) => a.kind.localeCompare(b.kind) || a.durationDays - b.durationDays,
          );
          assert.deepEqual(
            prices,
            [...promotionPrices].sort(
              (a, b) => a.kind.localeCompare(b.kind) || a.durationDays - b.durationDays,
            ),
          );
        },
      );

      await t.test(
        "owner request, exact payment confirmation and immediate activation use frozen prices",
        async () => {
          const response = await request("POST", "/api/promotions", owner, input());
          assert.equal(response.status, 201);
          const { order } = await response.json();
          assert.equal(order.status, "pending");
          assert.equal(order.amountBamMinor, 2500);
          assert.equal(order.amountEurMinor, 1278);
          assert.match(order.paymentReference, /^AHI-[a-f0-9]{32}$/);
          assert.equal(order.bank.recipient, bank.recipient);
          assert.equal(await promoted(businessId, "home"), false);
          await service.prices(admin.headers, {
            kind: "home",
            durationDays: 7,
            amountBamMinor: 2600,
          });
          await assert.rejects(
            service.confirm(admin.headers, order.id, {
              ...confirmed(order),
              amountMinor: order.amountEurMinor + 1,
            }),
            denial(409, "PROMOTION_AMOUNT_MISMATCH"),
          );
          await assert.rejects(
            service.confirm(admin.headers, order.id, {
              ...confirmed(order),
              paymentReference: `AHI-${"b".repeat(32)}`,
            }),
            denial(409, "PROMOTION_REFERENCE_MISMATCH"),
          );
          await assert.rejects(
            service.confirm(owner.headers, order.id, confirmed(order)),
            denial(403),
          );
          const saved = (
            await service.confirm(admin.headers, order.id, confirmed(order, "EUR", "STATEMENT-1"))
          ).order;
          assert.equal(saved.status, "active");
          assert.equal(saved.confirmedBy, admin.user.id);
          assert.ok(saved.confirmedAt);
          assert.equal(saved.amountBamMinor, 2500);
          assert.equal(await promoted(businessId, "home"), true);
          assert.ok(
            (await directory.homeAllPromotions()).items.some((item) => item.id === businessId),
          );
          await assert.rejects(
            service.confirm(admin.headers, order.id, confirmed(order)),
            denial(409, "PROMOTION_ALREADY_PROCESSED"),
          );
          await assert.rejects(service.cancel(owner.headers, order.id), denial(409));
          assert.equal(
            (await service.cancel(admin.headers, order.id, true)).order.status,
            "cancelled",
          );
          assert.equal(await promoted(businessId, "home"), false);
          const changed = (await service.create(owner.headers, input())).order;
          assert.equal(changed.amountBamMinor, 2600);
          await service.cancel(owner.headers, changed.id);
          await service.prices(admin.headers, {
            kind: "home",
            durationDays: 7,
            amountBamMinor: 2500,
          });
        },
      );

      await t.test(
        "authority, cancellation and absent bank configuration close all unsupported writes",
        async () => {
          await assert.rejects(
            service.create(owner.headers, input("home", foreignBusiness)),
            denial(404),
          );
          const missingIdentity = new Headers(owner.headers);
          missingIdentity.delete("X-AhiBizz-Account-ID");
          await assert.rejects(service.create(missingIdentity, input()), denial(401));
          const disabled = createPromotionsService({ pool, auth, bank: () => null, play: false });
          assert.equal((await disabled.list(owner.headers)).purchaseAvailable, false);
          await assert.rejects(
            disabled.create(owner.headers, input()),
            denial(503, "PROMOTION_PAYMENT_UNAVAILABLE"),
          );
          const pending = (await service.create(owner.headers, input())).order;
          await assert.rejects(service.cancel(other.headers, pending.id), denial(404));
          assert.equal((await service.cancel(owner.headers, pending.id)).order.status, "cancelled");
          await assert.rejects(
            service.confirm(admin.headers, pending.id, confirmed(pending)),
            denial(409),
          );
          await assert.rejects(
            service.manual(owner.headers, { ...input(), note: "Dogovor" }),
            denial(403),
          );
          await assert.rejects(disabled.manual(admin.headers, input()), denial(400));
          const manual = (
            await disabled.manual(admin.headers, { ...input(), note: "Dogovor vlasnika" })
          ).order;
          assert.equal(manual.manual, true);
          assert.equal(manual.status, "active");
          assert.equal(manual.bank, null);
          assert.equal(manual.note, "Dogovor vlasnika");
          await service.cancel(admin.headers, manual.id, true);
        },
      );

      await t.test(
        "double confirmation races activate once and a statement cannot fund another order",
        async () => {
          const first = (await service.create(owner.headers, input("nearby"))).order;
          const results = await Promise.allSettled([
            service.confirm(admin.headers, first.id, confirmed(first, "BAM", "RACE-STATEMENT")),
            service.confirm(admin.headers, first.id, confirmed(first, "BAM", "RACE-STATEMENT")),
          ]);
          assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
          assert.equal(
            results.filter(
              (result) =>
                result.status === "rejected" &&
                result.reason.code === "PROMOTION_ALREADY_PROCESSED",
            ).length,
            1,
          );
          const second = (await service.create(owner.headers, input("nearby"))).order;
          await assert.rejects(
            service.confirm(admin.headers, second.id, confirmed(second, "BAM", "RACE-STATEMENT")),
            denial(409, "PROMOTION_REFERENCE_USED"),
          );
          await service.cancel(owner.headers, second.id);
          await service.cancel(admin.headers, first.id, true);
        },
      );

      await t.test(
        "all four capacities include pending orders and offer the earliest free full period",
        async () => {
          const startsAt = new Date(Date.now() + 90 * 86400000).toISOString();
          const expectedEnd = new Date(Date.parse(startsAt) + 7 * 86400000).toISOString();
          for (const kind of ["home", "nearby", "category", "banner"]) {
            const cap = promotionCapacity[kind];
            const outcomes = await Promise.allSettled(
              Array.from({ length: cap + 1 }, (_, index) =>
                service.create(
                  index % 2 ? other.headers : owner.headers,
                  input(kind, index % 2 ? foreignBusiness : businessId, startsAt),
                ),
              ),
            );
            const orders = outcomes
              .filter((result) => result.status === "fulfilled")
              .map((result) => result.value.order);
            assert.equal(orders.length, cap, kind);
            const rejected = outcomes.find((result) => result.status === "rejected");
            assert.equal(rejected.reason.code, "PROMOTION_FULL", kind);
            assert.equal(rejected.reason.firstAvailableAt, expectedEnd, kind);
            assert.deepEqual(
              await service.availability(owner.headers, input(kind, businessId, startsAt)),
              { available: false, firstAvailableAt: expectedEnd, capacity: cap },
            );
            const later = (
              await service.create(owner.headers, input(kind, businessId, expectedEnd))
            ).order;
            assert.equal(later.startsAt, expectedEnd);
            await service.cancel(owner.headers, later.id);
            if (kind === "nearby" || kind === "category") {
              const separate = await addBusiness(owner, "Mostar", otherCategory);
              const independent = (
                await service.create(owner.headers, input(kind, separate, startsAt))
              ).order;
              assert.equal(independent.status, "pending");
              await service.cancel(owner.headers, independent.id);
            }
            for (const order of orders)
              await service.cancel(
                order.ownerId === owner.user.id ? owner.headers : other.headers,
                order.id,
              );
          }
        },
      );

      await t.test(
        "banner bytes are validated, hidden before confirmation and publicly readable in Play after activation",
        async () => {
          const order = (await service.create(owner.headers, input("banner"))).order;
          await assert.rejects(
            service.confirm(admin.headers, order.id, confirmed(order)),
            denial(409, "PROMOTION_IMAGE_REQUIRED"),
          );
          await assert.rejects(
            service.saveImage(owner.headers, order.id, Buffer.from("<svg/>")),
            denial(400),
          );
          await assert.rejects(
            service.saveImage(owner.headers, order.id, Buffer.alloc(4 * 1024 * 1024 + 1)),
            denial(413),
          );
          const png = await sharp({
            create: { width: 80, height: 30, channels: 3, background: "#123456" },
          })
            .png()
            .toBuffer();
          assert.equal(
            (await service.saveImage(owner.headers, order.id, png)).order.hasImage,
            true,
          );
          await assert.rejects(service.image(new Headers(), order.id), denial(401));
          await service.confirm(admin.headers, order.id, {
            amountMinor: order.amountBamMinor,
            currency: "BAM",
            statementReference: "BANNER-STATEMENT",
          });
          const play = createPromotionsService({ pool, auth, bank: () => null, play: true });
          const image = await play.image(new Headers(), order.id);
          assert.equal((await sharp(image).metadata()).format, "webp");
          assert.equal((await sharp(image).metadata()).width, 1600);
          await assert.rejects(play.create(owner.headers, input()), denial(404));
          await service.cancel(admin.headers, order.id, true);
          await assert.rejects(play.image(new Headers(), order.id), denial(404));
        },
      );

      await t.test(
        "database rejects malformed periods, incorrect EUR values, duplicate references and unconfirmed activation",
        async () => {
          const order = (await service.create(owner.headers, input("category"))).order;
          await service.cancel(owner.headers, order.id);
          const clone = async (reference, duration = 7, euroDelta = 0, status = "pending") =>
            pool.query(
              `INSERT INTO promotion_order(id,business_id,owner_id,kind,scope_id,scope_key,duration_days,starts_at,ends_at,amount_bam_minor,amount_eur_minor,payment_reference,status,bank_details)
          SELECT $1,business_id,owner_id,kind,scope_id,scope_key,$3,starts_at+interval '1 year',starts_at+interval '1 year'+$3*interval '24 hours',amount_bam_minor,amount_eur_minor+$4,$2,$5,bank_details FROM promotion_order WHERE id=$6`,
              [randomUUID(), reference, duration, euroDelta, status, order.id],
            );
          await assert.rejects(clone(order.paymentReference), { code: "23505" });
          await assert.rejects(clone(`AHI-${randomBytes(16).toString("hex")}`, 8), {
            code: "23514",
          });
          await assert.rejects(clone(`AHI-${randomBytes(16).toString("hex")}`, 7, 1), {
            code: "23514",
          });
          await assert.rejects(clone(`AHI-${randomBytes(16).toString("hex")}`, 7, 0, "active"), {
            code: "23514",
          });
          await assert.rejects(clone("wrong"), { code: "23514" });
        },
      );

      await t.test(
        "scheduled labels and listing changes affect only the new promotions, preserving archived rows",
        async () => {
          const future = (
            await service.manual(admin.headers, {
              ...input("category", businessId, new Date(Date.now() + 86400000).toISOString()),
              note: "Zakazani dogovor",
            })
          ).order;
          assert.equal(promotionStatusLabel(future), "Zakazano");
          assert.equal(await promoted(businessId, "category"), false);
          await pool.query("UPDATE directory_business SET status='draft' WHERE id=$1", [
            businessId,
          ]);
          assert.equal(
            (await service.list(owner.headers)).orders.find((order) => order.id === future.id)
              .status,
            "cancelled",
          );
          assert.deepEqual(
            (
              await pool.query("SELECT to_jsonb(o) AS value FROM marketing_order o WHERE id=$1", [
                archivedOrder,
              ])
            ).rows[0].value,
            archive,
          );
        },
      );
      assert.deepEqual(await outsideTables(), outside);
    } finally {
      globalThis.fetch = originalFetch;
      if (pool) await pool.end();
      if (created) await control.query(`DROP SCHEMA "${schema}" CASCADE`);
      await control.end();
    }
  });
}
