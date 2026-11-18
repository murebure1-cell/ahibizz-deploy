import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  type RentalBooking,
  type RentalCatalog,
  type RentalInterval,
  type RentalVehicle,
  rentalQuote,
} from "../../lib/rentals";
import { accountTransaction, createAccountAccess } from "../auth/accounts";
import {
  type AuthService,
  type CurrentAuthUser,
  getAuthDatabasePool,
  getAuthService,
} from "../auth/service";
import {
  decisionInput,
  fail,
  interval,
  requestInput,
  uuid,
  vehicleInput,
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
type VehicleRow = RentalVehicle & { key: string; archived: boolean };
type BookingRow = Omit<RentalBooking, "startsAt" | "endsAt" | "totalMinor"> & {
  startsAt: Date;
  endsAt: Date;
  totalMinor: string;
  customerId: string | null;
  fingerprint: string;
};
const vehicleColumns = `id,business_id AS "businessId",name,brand,model,year,seats,fuel,transmission,description,
  photo_slot AS "photoSlot",price_minor AS "priceMinor",price_unit AS "priceUnit",enabled,version,
  vehicle_key AS key,(archived_at IS NOT NULL) AS archived`;
const bookingColumns = `id,business_id AS "businessId",business_title AS "businessTitle",vehicle_id AS "vehicleId",
  vehicle_name AS "vehicleName",timezone,kind,status,version,customer_id AS "customerId",customer_name AS "customerName",
  total_minor AS "totalMinor",starts_at AS "startsAt",ends_at AS "endsAt",fingerprint`;
function vehicleDto({ key: _key, archived: _archived, ...vehicle }: VehicleRow): RentalVehicle {
  return vehicle;
}
function bookingDto({
  customerId: _customerId,
  fingerprint: _fingerprint,
  totalMinor,
  startsAt,
  endsAt,
  ...entry
}: BookingRow): RentalBooking {
  return {
    ...entry,
    totalMinor: Number(totalMinor),
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
  };
}
async function business(
  client: PoolClient,
  id: string,
  lock: "update" | "public" | "read",
): Promise<Business> {
  const locking = lock === "update" ? "FOR UPDATE OF b" : "FOR SHARE OF b";
  const result = await client.query<Business>(
    `SELECT b.id,b.title,b.owner_user_id AS "ownerId",b.status,(c.vehicle_rental OR COALESCE(s.vehicle_rental,false)) AS eligible,
      (b.status='published' AND u.approval='approved' AND u."emailVerified" AND u.role IN ('member','owner')) AS visible,
      COALESCE(d.timezone,bs.timezone,'Europe/Sarajevo') AS timezone
     FROM directory_business b JOIN auth_user u ON u.id=b.owner_user_id JOIN directory_category c ON c.id=b.category_id
     LEFT JOIN directory_category s ON s.id=b.subcategory_id LEFT JOIN directory_business_details d ON d.business_id=b.id
     LEFT JOIN booking_settings bs ON bs.business_id=b.id WHERE b.id=$1 ${locking}`,
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
  if (!manages(user, b)) fail(403, "RENTAL_OWNER_REQUIRED");
}
function requireAvailable(b: Business) {
  if (!b.eligible || !b.visible) fail(404, "RENTAL_NOT_AVAILABLE");
}
async function car(client: PoolClient, businessId: string, id: string) {
  const result = await client.query<VehicleRow>(
    `SELECT ${vehicleColumns} FROM rental_vehicle WHERE business_id=$1 AND id=$2`,
    [businessId, uuid(id)],
  );
  if (!result.rows[0]) fail(404, "RENTAL_NOT_AVAILABLE");
  return result.rows[0];
}
async function catalog(
  client: PoolClient,
  b: Business,
  publicOnly: boolean,
): Promise<RentalCatalog> {
  const eligible = b.eligible && b.status !== "archived";
  if (publicOnly && !eligible) return { eligible, timezone: b.timezone, vehicles: [] };
  const rows = await client.query<VehicleRow>(
    `SELECT ${vehicleColumns} FROM rental_vehicle
    WHERE business_id=$1 AND archived_at IS NULL ${publicOnly ? "AND enabled" : ""} ORDER BY free_slot,id`,
    [b.id],
  );
  return { eligible, timezone: b.timezone, vehicles: rows.rows.map(vehicleDto) };
}
function knownSqlError(error: unknown): never {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "23P01")
    fail(409, "RENTAL_OVERLAP");
  throw error;
}

export function createRentalService({
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
    vehicleId: string,
    input: unknown,
    kind: "customer" | "block",
  ) {
    const data = requestInput(input);
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify([
          kind,
          uuid(businessId),
          uuid(vehicleId),
          data.startsAt,
          data.endsAt,
          data.expectedVehicleVersion,
        ]),
      )
      .digest("hex");
    const session = await access.session(headers);
    return accountTransaction(pool, async (client) => {
      const hint = (
        await client.query<{ owner: string }>(
          "SELECT owner_user_id AS owner FROM directory_business WHERE id=$1",
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
        `SELECT ${bookingColumns} FROM rental_booking WHERE actor_user_id=$1 AND request_id=$2`,
        [user.id, data.requestId],
      );
      if (replay.rows[0]) {
        if (replay.rows[0].fingerprint !== fingerprint) fail(409, "REQUEST_CONFLICT");
        return bookingDto(replay.rows[0]);
      }
      if (kind === "customer") {
        requireAvailable(b);
        if (user.id === b.ownerId) fail(403, "SELF_BOOKING_NOT_ALLOWED");
      } else if (!b.eligible || b.status === "archived") fail(409, "RENTAL_NOT_AVAILABLE");
      const vehicle = await car(client, b.id, vehicleId);
      if (vehicle.archived || (kind === "customer" && !vehicle.enabled))
        fail(409, "RENTAL_NOT_AVAILABLE");
      if (vehicle.version !== data.expectedVehicleVersion) fail(409, "VERSION_CONFLICT");
      if (Date.parse(data.startsAt) <= now().getTime()) fail(400, "INVALID_RENTAL_INTERVAL");
      const total =
        kind === "block"
          ? 0
          : rentalQuote(vehicle.priceMinor, vehicle.priceUnit, data.startsAt, data.endsAt);
      const id = randomUUID();
      const result = await client
        .query<BookingRow>(
          `INSERT INTO rental_booking
        (id,business_id,vehicle_id,vehicle_key,actor_user_id,request_id,fingerprint,vehicle_version,vehicle_name,
        business_title,timezone,customer_id,customer_name,kind,status,starts_at,ends_at,price_minor,price_unit,total_minor)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING ${bookingColumns}`,
          [
            id,
            b.id,
            vehicle.id,
            vehicle.key,
            user.id,
            data.requestId,
            fingerprint,
            vehicle.version,
            vehicle.name,
            b.title,
            b.timezone,
            kind === "customer" ? user.id : null,
            kind === "customer" ? user.name : null,
            kind,
            kind === "block" ? "confirmed" : "requested",
            data.startsAt,
            data.endsAt,
            vehicle.priceMinor,
            vehicle.priceUnit,
            total,
          ],
        )
        .catch(knownSqlError);
      await client.query(
        "INSERT INTO rental_booking_event (booking_id,version,actor_user_id,action) VALUES($1,1,$2,$3)",
        [id, user.id, kind === "block" ? "block" : "request"],
      );
      return bookingDto(result.rows[0] ?? fail(503, "RENTAL_UNAVAILABLE"));
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
          `SELECT ${bookingColumns} FROM rental_booking
          WHERE business_id=$1 AND status='requested' AND ends_at>now() ORDER BY starts_at,id LIMIT 50`,
          [b.id],
        );
        return { ...base, upcoming: pending.rows.map(bookingDto) };
      });
    },
    saveVehicle(headers: Headers, businessId: string, input: unknown) {
      const data = vehicleInput(input);
      return signed(headers, async (client, user) => {
        const b = await business(client, businessId, "update");
        requireOwner(user, b);
        if (!b.eligible || b.status === "archived") fail(409, "RENTAL_NOT_AVAILABLE");
        const id = data.id ?? randomUUID();
        const old = (
          await client.query<VehicleRow>(
            `SELECT ${vehicleColumns} FROM rental_vehicle WHERE id=$1 AND business_id=$2`,
            [id, b.id],
          )
        ).rows[0];
        const photoSlot = data.photoSlot === undefined ? (old?.photoSlot ?? null) : data.photoSlot;
        const values = [
          id,
          b.id,
          data.name,
          data.brand,
          data.model,
          data.year,
          data.seats,
          data.fuel,
          data.transmission,
          data.description,
          photoSlot,
          data.priceMinor,
          data.priceUnit,
          data.enabled,
        ];
        if (old && data.expectedVersion === 0 && old.version === 1 && !old.archived) {
          const { id: _id, expectedVersion: _version, photoSlot: _photo, ...fields } = data;
          if (
            old.photoSlot === photoSlot &&
            (Object.entries(fields) as [keyof typeof fields, unknown][]).every(
              ([key, value]) => old[key] === value,
            )
          )
            return vehicleDto(old);
        }
        if ((old?.version ?? 0) !== data.expectedVersion || old?.archived)
          fail(409, "VERSION_CONFLICT");
        if (photoSlot !== null && photoSlot !== old?.photoSlot) {
          const exists = await client.query(
            "SELECT 1 FROM directory_business_image WHERE business_id=$1 AND kind='gallery' AND slot=$2 FOR SHARE",
            [b.id, photoSlot],
          );
          if (!exists.rowCount) fail(400, "INVALID_RENTAL_PHOTO");
        }
        if (old) {
          const updated = await client.query<VehicleRow>(
            `UPDATE rental_vehicle SET name=$3,brand=$4,model=$5,year=$6,seats=$7,
            fuel=$8,transmission=$9,description=$10,photo_slot=$11,price_minor=$12,price_unit=$13,enabled=$14,version=version+1
            WHERE id=$1 AND business_id=$2 RETURNING ${vehicleColumns}`,
            values,
          );
          return vehicleDto(updated.rows[0] ?? fail(503, "RENTAL_UNAVAILABLE"));
        }
        const free = (
          await client.query<{ slot: number }>(
            `SELECT slot FROM generate_series(1,2) slot WHERE NOT EXISTS
          (SELECT 1 FROM rental_vehicle v WHERE v.business_id=$1 AND v.free_slot=slot) ORDER BY slot LIMIT 1`,
            [b.id],
          )
        ).rows[0];
        if (!free) fail(409, "RENTAL_LIMIT");
        try {
          const added = await client.query<VehicleRow>(
            `INSERT INTO rental_vehicle
            (id,business_id,name,brand,model,year,seats,fuel,transmission,description,photo_slot,price_minor,price_unit,enabled,free_slot)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING ${vehicleColumns}`,
            [...values, free.slot],
          );
          return vehicleDto(added.rows[0] ?? fail(503, "RENTAL_UNAVAILABLE"));
        } catch (error) {
          if (error && typeof error === "object" && "code" in error && error.code === "23505")
            fail(409, "VERSION_CONFLICT");
          throw error;
        }
      });
    },
    archiveVehicle(headers: Headers, businessId: string, vehicleId: string, input: unknown) {
      const version = versionInput(input);
      return signed(headers, async (client, user) => {
        const b = await business(client, businessId, "update");
        requireOwner(user, b);
        const v = await car(client, b.id, vehicleId);
        if (v.archived && v.version === version + 1) return { archived: true as const };
        if (v.version !== version || v.archived) fail(409, "VERSION_CONFLICT");
        const active = await client.query(
          "SELECT 1 FROM rental_booking WHERE vehicle_id=$1 AND status IN ('requested','confirmed') AND ends_at>now() LIMIT 1",
          [v.id],
        );
        if (active.rowCount) fail(409, "RENTAL_HAS_BOOKINGS");
        await client.query(
          "UPDATE rental_vehicle SET archived_at=now(),enabled=false,free_slot=NULL,version=version+1 WHERE id=$1",
          [v.id],
        );
        return { archived: true as const };
      });
    },
    available(
      businessId: string,
      vehicleId: string,
      from: string,
      to: string,
      headers?: Headers,
    ): Promise<boolean> {
      const range = interval(from, to);
      async function read(client: PoolClient, user?: CurrentAuthUser) {
        const b = await business(client, businessId, user ? "read" : "public");
        if (user) requireOwner(user, b);
        else requireAvailable(b);
        const v = await car(client, b.id, vehicleId);
        if (!user && (!v.enabled || v.archived)) fail(404, "RENTAL_NOT_AVAILABLE");
        // Reuse the partial GiST index underlying the exclusion constraint, even for multi-year ranges.
        const result = await client.query<{ available: boolean }>(
          `SELECT NOT EXISTS(SELECT 1 FROM rental_booking
          WHERE status IN ('requested','confirmed') AND int8range(vehicle_key,vehicle_key,'[]') && int8range($1::bigint,$1::bigint,'[]')
          AND tstzrange(starts_at,ends_at,'[)') && tstzrange($2::timestamptz,$3::timestamptz,'[)')) AS available`,
          [v.key, range.startsAt, range.endsAt],
        );
        return result.rows[0]?.available ?? fail(503, "RENTAL_UNAVAILABLE");
      }
      return headers ? signed(headers, read) : accountTransaction(pool, (client) => read(client));
    },
    calendar(
      businessId: string,
      vehicleId: string,
      from: string,
      to: string,
    ): Promise<RentalInterval[]> {
      const range = interval(from, to, true);
      return accountTransaction(pool, async (client) => {
        const b = await business(client, businessId, "public");
        requireAvailable(b);
        const v = await car(client, b.id, vehicleId);
        if (!v.enabled || v.archived) fail(404, "RENTAL_NOT_AVAILABLE");
        const rows = await client.query<{ start: Date; end: Date }>(
          `SELECT greatest(starts_at,$2::timestamptz) AS start,least(ends_at,$3::timestamptz) AS "end"
          FROM rental_booking WHERE vehicle_id=$1 AND status IN ('requested','confirmed') AND starts_at<$3 AND ends_at>$2 ORDER BY starts_at`,
          [v.id, range.startsAt, range.endsAt],
        );
        return rows.rows.map((r) => ({
          startsAt: r.start.toISOString(),
          endsAt: r.end.toISOString(),
        }));
      });
    },
    ownerCalendar(
      headers: Headers,
      businessId: string,
      vehicleId: string,
      from: string,
      to: string,
    ) {
      const range = interval(from, to, true);
      return signed(headers, async (client, user) => {
        const b = await business(client, businessId, "read");
        requireOwner(user, b);
        const v = await car(client, b.id, vehicleId);
        const entries = await client.query<BookingRow>(
          `SELECT ${bookingColumns} FROM rental_booking
          WHERE vehicle_id=$1 AND starts_at<$3 AND ends_at>$2 ORDER BY starts_at,id`,
          [v.id, range.startsAt, range.endsAt],
        );
        return entries.rows.map(bookingDto);
      });
    },
    request: (headers: Headers, businessId: string, vehicleId: string, input: unknown) =>
      create(headers, businessId, vehicleId, input, "customer"),
    block: (headers: Headers, businessId: string, vehicleId: string, input: unknown) =>
      create(headers, businessId, vehicleId, input, "block"),
    myBookings(headers: Headers) {
      return signed(headers, async (client, user) => {
        const rows = await client.query<BookingRow>(
          `SELECT ${bookingColumns} FROM rental_booking WHERE customer_id=$1
          ORDER BY starts_at DESC,id`,
          [user.id],
        );
        return rows.rows.map(bookingDto);
      });
    },
    decide(headers: Headers, businessId: string, bookingId: string, input: unknown) {
      const data = decisionInput(input);
      return signed(headers, async (client, user) => {
        const b = await business(client, businessId, "update");
        const before = (
          await client.query<BookingRow>(
            `SELECT ${bookingColumns} FROM rental_booking WHERE business_id=$1 AND id=$2 FOR UPDATE`,
            [b.id, uuid(bookingId)],
          )
        ).rows[0];
        if (!before || (!manages(user, b) && before.customerId !== user.id))
          fail(404, "RENTAL_BOOKING_NOT_FOUND");
        if (!manages(user, b) && data.action !== "cancel") fail(403, "RENTAL_OWNER_REQUIRED");
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
            before.startsAt.getTime() <= now().getTime())
        )
          fail(409, "RENTAL_INVALID_TRANSITION");
        const updated = await client.query<BookingRow>(
          `UPDATE rental_booking SET status=$2,version=version+1 WHERE id=$1 RETURNING ${bookingColumns}`,
          [before.id, next],
        );
        await client.query(
          "INSERT INTO rental_booking_event(booking_id,version,actor_user_id,action) VALUES($1,$2,$3,$4)",
          [before.id, before.version + 1, user.id, data.action],
        );
        return bookingDto(updated.rows[0] ?? fail(503, "RENTAL_UNAVAILABLE"));
      });
    },
  };
}
export type RentalService = ReturnType<typeof createRentalService>;
let service: RentalService | undefined;
export function getRentalService(): RentalService | null {
  if (service) return service;
  const auth = getAuthService(),
    pool = getAuthDatabasePool();
  if (!auth || !pool) return null;
  service = createRentalService({ auth, pool });
  return service;
}
