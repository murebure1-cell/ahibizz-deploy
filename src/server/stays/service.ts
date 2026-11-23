import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { dateKey } from "../../lib/booking-time";
import {
  type StayBooking,
  type StayCatalog,
  type StayInterval,
  type StayUnit,
  stayQuote,
} from "../../lib/stays";
import { accountTransaction, createAccountAccess } from "../auth/accounts";
import {
  type AuthService,
  type CurrentAuthUser,
  getAuthDatabasePool,
  getAuthService,
} from "../auth/service";
import { type InventorySelection, inventoryAppointments } from "../inventory-appointments";
import {
  decisionInput,
  fail,
  interval,
  requestInput,
  unitInput,
  uuid,
  versionInput,
} from "./validation";

type Business = {
  id: string;
  ownerId: string;
  title: string;
  status: string;
  eligible: boolean;
  visible: boolean;
  timezone: string;
};
type UnitRow = StayUnit & { key: string; archived: boolean };
type BookingRow = Omit<StayBooking, "totalMinor"> & {
  totalMinor: string;
  customerId: string | null;
  fingerprint: string;
};
const unitColumns = `u.id,u.business_id AS "businessId",u.name,u.type,u.beds,u.description,
  ARRAY(SELECT p.slot FROM stay_unit_photo p WHERE p.unit_id=u.id ORDER BY p.position) AS "photoSlots",
  u.price_minor AS "priceMinor",u.enabled,u.version,u.unit_key AS key,(u.archived_at IS NOT NULL) AS archived`;
const bookingColumns = `id,business_id AS "businessId",business_title AS "businessTitle",unit_id AS "unitId",
  unit_name AS "unitName",timezone,kind,status,version,customer_id AS "customerId",customer_name AS "customerName",
  total_minor AS "totalMinor",to_char(check_in,'YYYY-MM-DD') AS "checkIn",to_char(check_out,'YYYY-MM-DD') AS "checkOut",fingerprint`;
function unitDto({ key: _key, archived: _archived, ...unit }: UnitRow): StayUnit {
  return unit;
}
function bookingDto({
  customerId: _customer,
  fingerprint: _fingerprint,
  totalMinor,
  ...entry
}: BookingRow): StayBooking {
  return { ...entry, totalMinor: Number(totalMinor) };
}
async function business(
  client: PoolClient,
  id: string,
  lock: "update" | "public" | "read",
): Promise<Business> {
  const locking = lock === "update" ? "FOR UPDATE OF b" : "FOR SHARE OF b";
  const result = await client.query<Business>(
    `SELECT b.id,b.title,b.owner_user_id AS "ownerId",b.status,(c.accommodation OR COALESCE(s.accommodation,false)) AS eligible,
      (b.status='published' AND u.approval='approved' AND u."emailVerified" AND u.role IN ('member','owner')) AS visible,
      COALESCE(d.timezone,bs.timezone,'Europe/Sarajevo') AS timezone
     FROM directory_business b JOIN auth_user u ON u.id=b.owner_user_id JOIN directory_category c ON c.id=b.category_id
     LEFT JOIN directory_category s ON s.id=b.subcategory_id LEFT JOIN directory_business_details d ON d.business_id=b.id
     LEFT JOIN booking_settings bs ON bs.business_id=b.id WHERE b.id=$1 AND b.deleted_at IS NULL ${locking}`,
    [uuid(id)],
  );
  const row = result.rows[0];
  if (!row || (lock === "public" && !row.visible)) fail(404, "BUSINESS_NOT_FOUND");
  return row;
}
function manages(user: CurrentAuthUser, b: Business) {
  return user.id === b.ownerId || user.role === "owner";
}
function requireOwner(user: CurrentAuthUser, b: Business) {
  if (!manages(user, b)) fail(403, "STAY_OWNER_REQUIRED");
}
function requireAvailable(b: Business) {
  if (!b.eligible || !b.visible) fail(404, "STAY_NOT_AVAILABLE");
}
async function unitById(client: PoolClient, businessId: string, id: string) {
  const result = await client.query<UnitRow>(
    `SELECT ${unitColumns} FROM stay_unit u WHERE u.business_id=$1 AND u.id=$2`,
    [businessId, uuid(id)],
  );
  if (!result.rows[0]) fail(404, "STAY_NOT_AVAILABLE");
  return result.rows[0];
}
async function catalog(client: PoolClient, b: Business, publicOnly: boolean): Promise<StayCatalog> {
  const eligible = b.eligible && b.status !== "archived";
  if (publicOnly && !eligible) return { eligible, timezone: b.timezone, units: [] };
  const rows = await client.query<UnitRow>(
    `SELECT ${unitColumns} FROM stay_unit u
    WHERE business_id=$1 AND archived_at IS NULL ${publicOnly ? "AND enabled" : ""} ORDER BY free_slot,id`,
    [b.id],
  );
  return { eligible, timezone: b.timezone, units: rows.rows.map(unitDto) };
}
function knownSqlError(error: unknown): never {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "23P01")
    fail(409, "STAY_OVERLAP");
  throw error;
}

export function createStayService({
  auth,
  pool,
  now = () => new Date(),
}: {
  auth: AuthService;
  pool: Pool;
  now?: () => Date;
}) {
  const access = createAccountAccess(auth);
  async function signed<T>(
    headers: Headers,
    work: (client: PoolClient, user: CurrentAuthUser) => Promise<T>,
  ) {
    const session = await access.session(headers);
    return accountTransaction(pool, async (client) =>
      work(client, await access.authority(client, session)),
    );
  }
  async function create(
    headers: Headers,
    businessId: string,
    unitId: string,
    input: unknown,
    kind: "customer" | "block",
  ) {
    const data = requestInput(input);
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify([
          kind,
          uuid(businessId),
          uuid(unitId),
          data.checkIn,
          data.checkOut,
          data.expectedUnitVersion,
        ]),
      )
      .digest("hex");
    const session = await access.session(headers);
    return accountTransaction(pool, async (client) => {
      const hint = (
        await client.query<{ owner: string }>(
          "SELECT owner_user_id AS owner FROM directory_business WHERE id=$1 AND deleted_at IS NULL",
          [uuid(businessId)],
        )
      ).rows[0];
      if (!hint) fail(404, "BUSINESS_NOT_FOUND");
      // Use the same account order as ownership transfer and ordinary booking.
      await client.query(
        "SELECT id FROM auth_user WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE",
        [[session.userId, hint.owner]],
      );
      const user = await access.authority(client, session);
      const b = await business(client, businessId, "update");
      if (b.ownerId !== hint.owner) fail(409, "VERSION_CONFLICT");
      if (kind === "block") requireOwner(user, b);
      const replay = await client.query<BookingRow>(
        `SELECT ${bookingColumns} FROM stay_booking WHERE actor_user_id=$1 AND request_id=$2`,
        [user.id, data.requestId],
      );
      if (replay.rows[0]) {
        if (replay.rows[0].fingerprint !== fingerprint) fail(409, "REQUEST_CONFLICT");
        return bookingDto(replay.rows[0]);
      }
      if (kind === "customer") {
        requireAvailable(b);
        if (user.id === b.ownerId) fail(403, "SELF_BOOKING_NOT_ALLOWED");
      } else if (!b.eligible || b.status === "archived") fail(409, "STAY_NOT_AVAILABLE");
      const unit = await unitById(client, b.id, unitId);
      if (unit.archived || (kind === "customer" && !unit.enabled)) fail(409, "STAY_NOT_AVAILABLE");
      if (unit.version !== data.expectedUnitVersion) fail(409, "VERSION_CONFLICT");
      if (data.checkIn < dateKey(now(), b.timezone)) fail(400, "INVALID_STAY_INTERVAL");
      const total = kind === "block" ? 0 : stayQuote(unit.priceMinor, data.checkIn, data.checkOut);
      const id = randomUUID();
      const result = await client
        .query<BookingRow>(
          `INSERT INTO stay_booking
        (id,business_id,unit_id,unit_key,actor_user_id,request_id,fingerprint,unit_version,unit_name,
        business_title,timezone,customer_id,customer_name,kind,status,check_in,check_out,price_minor,total_minor)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING ${bookingColumns}`,
          [
            id,
            b.id,
            unit.id,
            unit.key,
            user.id,
            data.requestId,
            fingerprint,
            unit.version,
            unit.name,
            b.title,
            b.timezone,
            kind === "customer" ? user.id : null,
            kind === "customer" ? user.name : null,
            kind,
            kind === "block" ? "confirmed" : "requested",
            data.checkIn,
            data.checkOut,
            unit.priceMinor,
            total,
          ],
        )
        .catch(knownSqlError);
      await client.query(
        "INSERT INTO stay_booking_event (booking_id,version,actor_user_id,action) VALUES($1,1,$2,$3)",
        [id, user.id, kind === "block" ? "block" : "request"],
      );
      return bookingDto(result.rows[0] ?? fail(503, "STAY_UNAVAILABLE"));
    });
  }
  return {
    publicCatalog(businessId: string) {
      return accountTransaction(pool, async (client) =>
        catalog(client, await business(client, businessId, "public"), true),
      );
    },
    ownerCatalog(headers: Headers, businessId: string) {
      return signed(headers, async (client, user) => {
        const b = await business(client, businessId, "read");
        requireOwner(user, b);
        const base = await catalog(client, b, false);
        const pending = await client.query<BookingRow>(
          `SELECT ${bookingColumns} FROM stay_booking
          WHERE business_id=$1 AND status='requested' AND check_out>($2::timestamptz AT TIME ZONE timezone)::date ORDER BY check_in,id LIMIT 50`,
          [b.id, now()],
        );
        return { ...base, upcoming: pending.rows.map(bookingDto) };
      });
    },
    saveUnit(headers: Headers, businessId: string, input: unknown) {
      const data = unitInput(input);
      return signed(headers, async (client, user) => {
        const b = await business(client, businessId, "update");
        requireOwner(user, b);
        if (!b.eligible || b.status === "archived") fail(409, "STAY_NOT_AVAILABLE");
        const id = data.id ?? randomUUID();
        const old = (
          await client.query<UnitRow>(
            `SELECT ${unitColumns} FROM stay_unit u WHERE u.id=$1 AND u.business_id=$2`,
            [id, b.id],
          )
        ).rows[0];
        const photoSlots = data.photoSlots ?? old?.photoSlots ?? [];
        const samePhotos =
          old?.photoSlots.length === photoSlots.length &&
          photoSlots.every((slot, i) => slot === old?.photoSlots[i]);
        if (
          old &&
          data.expectedVersion === 0 &&
          old.version === 1 &&
          !old.archived &&
          samePhotos &&
          old.name === data.name &&
          old.type === data.type &&
          old.beds === data.beds &&
          old.description === data.description &&
          old.priceMinor === data.priceMinor &&
          old.enabled === data.enabled
        )
          return unitDto(old);
        if ((old?.version ?? 0) !== data.expectedVersion || old?.archived)
          fail(409, "VERSION_CONFLICT");
        const values = [
          id,
          b.id,
          data.name,
          data.type,
          data.beds,
          data.description,
          data.priceMinor,
          data.enabled,
        ];
        if (old) {
          await client.query(
            `UPDATE stay_unit SET name=$3,type=$4,beds=$5,description=$6,price_minor=$7,enabled=$8,version=version+1 WHERE id=$1 AND business_id=$2`,
            values,
          );
        } else {
          const free = (
            await client.query<{ slot: number }>(
              `SELECT slot FROM generate_series(1,2) slot WHERE NOT EXISTS
            (SELECT 1 FROM stay_unit u WHERE u.business_id=$1 AND u.free_slot=slot) ORDER BY slot LIMIT 1`,
              [b.id],
            )
          ).rows[0];
          if (!free) fail(409, "STAY_LIMIT");
          await client
            .query(
              `INSERT INTO stay_unit(id,business_id,name,type,beds,description,price_minor,enabled,free_slot)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
              [...values, free.slot],
            )
            .catch((error: unknown) => {
              if (error && typeof error === "object" && "code" in error && error.code === "23505")
                fail(409, "VERSION_CONFLICT");
              throw error;
            });
        }
        if (!samePhotos) {
          await client.query("DELETE FROM stay_unit_photo WHERE unit_id=$1", [id]);
          if (photoSlots.length) {
            const inserted = await client.query(
              `INSERT INTO stay_unit_photo(unit_id,business_id,slot,position)
                SELECT $1,$2,img.slot,p.ord FROM unnest($3::int[]) WITH ORDINALITY p(slot,ord)
                JOIN directory_business_image img ON img.business_id=$2 AND img.kind='gallery' AND img.slot=p.slot`,
              [id, b.id, photoSlots],
            );
            if (inserted.rowCount !== photoSlots.length) fail(400, "INVALID_STAY_PHOTO");
          }
        }
        return unitDto(await unitById(client, b.id, id));
      });
    },
    archiveUnit(headers: Headers, businessId: string, unitId: string, input: unknown) {
      const version = versionInput(input);
      return signed(headers, async (client, user) => {
        const b = await business(client, businessId, "update");
        requireOwner(user, b);
        const v = await unitById(client, b.id, unitId);
        if (v.archived && v.version === version + 1) return { archived: true as const };
        if (v.version !== version || v.archived) fail(409, "VERSION_CONFLICT");
        const active = await client.query(
          "SELECT 1 FROM stay_booking WHERE unit_id=$1 AND status IN ('requested','confirmed') AND check_out>($2::timestamptz AT TIME ZONE timezone)::date LIMIT 1",
          [v.id, now()],
        );
        if (active.rowCount) fail(409, "STAY_HAS_BOOKINGS");
        await client.query(
          "UPDATE stay_unit SET archived_at=now(),enabled=false,free_slot=NULL,version=version+1 WHERE id=$1",
          [v.id],
        );
        return { archived: true as const };
      });
    },
    available(
      businessId: string,
      unitId: string,
      from: string,
      to: string,
      headers?: Headers,
    ): Promise<boolean> {
      const range = interval(from, to);
      async function read(client: PoolClient, user?: CurrentAuthUser) {
        const b = await business(client, businessId, user ? "read" : "public");
        if (user) requireOwner(user, b);
        else requireAvailable(b);
        const v = await unitById(client, b.id, unitId);
        if (!user && (!v.enabled || v.archived)) fail(404, "STAY_NOT_AVAILABLE");
        // Reuse the partial GiST index underlying the exclusion constraint, even for multi-year ranges.
        const result = await client.query<{ available: boolean }>(
          `SELECT NOT EXISTS(SELECT 1 FROM stay_booking
          WHERE status IN ('requested','confirmed') AND int8range(unit_key,unit_key,'[]') && int8range($1::bigint,$1::bigint,'[]')
          AND daterange(check_in,check_out,'[)') && daterange($2::date,$3::date,'[)')) AS available`,
          [v.key, range.checkIn, range.checkOut],
        );
        return result.rows[0]?.available ?? fail(503, "STAY_UNAVAILABLE");
      }
      return headers ? signed(headers, read) : accountTransaction(pool, (client) => read(client));
    },
    calendar(
      businessId: string,
      unitId: string,
      from: string,
      to: string,
    ): Promise<StayInterval[]> {
      const range = interval(from, to, true);
      return accountTransaction(pool, async (client) => {
        const b = await business(client, businessId, "public");
        requireAvailable(b);
        const v = await unitById(client, b.id, unitId);
        if (!v.enabled || v.archived) fail(404, "STAY_NOT_AVAILABLE");
        const rows = await client.query<StayInterval>(
          `SELECT to_char(greatest(check_in,$2::date),'YYYY-MM-DD') AS "checkIn",
             to_char(least(check_out,$3::date),'YYYY-MM-DD') AS "checkOut" FROM stay_booking
             WHERE unit_id=$1 AND status IN ('requested','confirmed') AND check_in<$3 AND check_out>$2 ORDER BY check_in`,
          [v.id, range.checkIn, range.checkOut],
        );
        return rows.rows;
      });
    },
    ownerCalendar(headers: Headers, businessId: string, unitId: string, from: string, to: string) {
      const range = interval(from, to, true);
      return signed(headers, async (client, user) => {
        const b = await business(client, businessId, "read");
        requireOwner(user, b);
        const v = await unitById(client, b.id, unitId);
        const entries = await client.query<BookingRow>(
          `SELECT ${bookingColumns} FROM stay_booking
          WHERE unit_id=$1 AND check_in<$3 AND check_out>$2 ORDER BY check_in,id`,
          [v.id, range.checkIn, range.checkOut],
        );
        return entries.rows.map(bookingDto);
      });
    },
    request: (headers: Headers, businessId: string, unitId: string, input: unknown) =>
      create(headers, businessId, unitId, input, "customer"),
    block: (headers: Headers, businessId: string, unitId: string, input: unknown) =>
      create(headers, businessId, unitId, input, "block"),
    myBookings(headers: Headers, selection: InventorySelection) {
      return signed(headers, (client, user) =>
        inventoryAppointments(
          client,
          user.id,
          "stay",
          selection,
          now(),
          bookingColumns,
          bookingDto,
        ),
      );
    },
    decide(headers: Headers, businessId: string, bookingId: string, input: unknown) {
      const data = decisionInput(input);
      return signed(headers, async (client, user) => {
        const b = await business(client, businessId, "update");
        const before = (
          await client.query<BookingRow>(
            `SELECT ${bookingColumns} FROM stay_booking WHERE business_id=$1 AND id=$2 FOR UPDATE`,
            [b.id, uuid(bookingId)],
          )
        ).rows[0];
        if (!before || (!manages(user, b) && before.customerId !== user.id))
          fail(404, "STAY_BOOKING_NOT_FOUND");
        if (!manages(user, b) && data.action !== "cancel") fail(403, "STAY_OWNER_REQUIRED");
        if (before.customerId === user.id && data.action === "approve")
          fail(403, "SELF_BOOKING_NOT_ALLOWED");
        const next =
          data.action === "approve"
            ? "confirmed"
            : data.action === "decline"
              ? "declined"
              : "cancelled";
        if (before.version !== data.expectedVersion) {
          if (before.status === next && before.version === data.expectedVersion + 1)
            return bookingDto(before);
          fail(409, "VERSION_CONFLICT");
        }
        const allowed =
          before.status === "requested" ||
          (before.status === "confirmed" && data.action === "cancel");
        if (
          !allowed ||
          ((data.action === "approve" || data.action === "cancel") &&
            before.checkIn < dateKey(now(), before.timezone))
        )
          fail(409, "STAY_INVALID_TRANSITION");
        const updated = await client.query<BookingRow>(
          `UPDATE stay_booking SET status=$2,version=version+1 WHERE id=$1 RETURNING ${bookingColumns}`,
          [before.id, next],
        );
        await client.query(
          "INSERT INTO stay_booking_event(booking_id,version,actor_user_id,action) VALUES($1,$2,$3,$4)",
          [before.id, before.version + 1, user.id, data.action],
        );
        return bookingDto(updated.rows[0] ?? fail(503, "STAY_UNAVAILABLE"));
      });
    },
  };
}
export type StayService = ReturnType<typeof createStayService>;
let service: StayService | undefined;
export function getStayService(): StayService | null {
  if (service) return service;
  const auth = getAuthService(),
    pool = getAuthDatabasePool();
  if (!auth || !pool) return null;
  service = createStayService({ auth, pool });
  return service;
}
