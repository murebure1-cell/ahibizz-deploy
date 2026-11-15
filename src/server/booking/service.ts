import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  BookingEntry,
  BookingServiceOption,
  BookingSettings,
  BookingSlot,
  BookingStatus,
  BookingWindow,
  PublicBookingConfiguration,
} from "../../lib/booking";
import { addDays, dailySlots, dateKey, dayBounds } from "../../lib/booking-time";
import {
  AccountAccessError,
  type AccountService,
  type AuthService,
  getAccountService,
  getAuthService,
} from "../auth";
import { type CurrentAuthUser, getAuthDatabasePool } from "../auth/service";
import {
  BookingAccessError,
  fail,
  manualInput,
  mineInput,
  rangeInput,
  requestInput,
  settingsInput,
  slotInput,
  transitionInput,
  uuid,
} from "./validation";

type Query = Pick<PoolClient, "query">;
type BookingIdentity = CurrentAuthUser & {
  session: { id: string; userId: string; token: string };
  expectedAccountId?: string;
};
type Business = { id: string; owner_user_id: string; title: string; status: string };
type EntryRow = Omit<BookingEntry, "startsAt" | "endsAt"> & {
  startsAt: Date;
  endsAt: Date;
  businessOwnerId: string;
};
const serviceColumns =
  'id, name, duration_minutes AS "durationMinutes", price_minor AS "priceMinor", active';
const entryColumns =
  'e.id, e.business_id AS "businessId", e.business_title AS "businessTitle", e.business_owner_user_id AS "businessOwnerId", e.timezone, e.kind, e.service_id AS "serviceId", e.service_name AS "serviceName", e.duration_minutes AS "durationMinutes", e.price_minor AS "priceMinor", e.starts_at AS "startsAt", e.ends_at AS "endsAt", e.status, e.version, e.customer_user_id AS "customerId", e.client_name AS "clientName", e.client_email AS "clientEmail", e.client_phone AS "clientPhone"';

function eligible(user: CurrentAuthUser | undefined): asserts user is CurrentAuthUser {
  if (!user) fail(401, "AUTHENTICATION_REQUIRED");
  if (
    user.approval !== "approved" ||
    !user.emailVerified ||
    !["member", "owner"].includes(user.role)
  )
    fail(403, "ACCOUNT_ACCESS_DENIED");
}
function owner(actor: CurrentAuthUser, business: Business): void {
  if (actor.role !== "owner" && actor.id !== business.owner_user_id)
    fail(403, "BOOKING_OWNER_REQUIRED");
}
function visible(business: Business, businessOwner: CurrentAuthUser | undefined): void {
  if (
    business.status !== "published" ||
    !businessOwner ||
    businessOwner.approval !== "approved" ||
    !businessOwner.emailVerified ||
    !["member", "owner"].includes(businessOwner.role)
  )
    fail(404, "BUSINESS_NOT_FOUND");
}
async function safe<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof BookingAccessError) throw error;
    if (error instanceof AccountAccessError) throw new BookingAccessError(error.status, error.code);
    if (error && typeof error === "object" && "code" in error && error.code === "23P01")
      fail(409, "SLOT_UNAVAILABLE");
    throw new BookingAccessError(503, "BOOKING_UNAVAILABLE");
  }
}
async function transaction<T>(pool: Pool, body: (client: PoolClient) => Promise<T>): Promise<T> {
  return safe(async () => {
    const client = await pool.connect();
    let begun = false,
      discard = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      begun = true;
      await client.query("SET LOCAL lock_timeout = '2s'");
      await client.query("SET LOCAL statement_timeout = '3s'");
      const result = await body(client);
      await client.query("COMMIT");
      begun = false;
      return result;
    } catch (error) {
      if (begun) {
        try {
          await client.query("ROLLBACK");
        } catch {
          discard = true;
        }
      }
      throw error;
    } finally {
      client.release(discard);
    }
  });
}
async function business(query: Query, id: string): Promise<Business> {
  const row = (
    await query.query<Business>(
      "SELECT id, owner_user_id, title, status FROM directory_business WHERE id = $1",
      [id],
    )
  ).rows[0];
  if (!row) fail(404, "BUSINESS_NOT_FOUND");
  return row;
}
async function publicBusiness(query: Query, id: string): Promise<Business> {
  const row = (
    await query.query<Business>(
      "SELECT b.id, b.owner_user_id, b.title, b.status FROM directory_business b JOIN auth_user u ON u.id = b.owner_user_id WHERE b.id = $1 AND b.status = 'published' AND u.approval = 'approved' AND u.\"emailVerified\" = true AND u.role IN ('member','owner')",
      [id],
    )
  ).rows[0];
  if (!row) fail(404, "BUSINESS_NOT_FOUND");
  return row;
}
async function authority(client: PoolClient, identity: BookingIdentity, extra: string[] = []) {
  const actorId = identity.id;
  const ids = [...new Set([actorId, ...extra])].sort();
  const users = (
    await client.query<CurrentAuthUser>(
      'SELECT id, name, email, "emailVerified", role, approval FROM auth_user WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE',
      [ids],
    )
  ).rows;
  const actor = users.find((row) => row.id === actorId);
  eligible(actor);
  if (identity.expectedAccountId !== undefined && actor.id !== identity.expectedAccountId)
    fail(401, "ACCOUNT_IDENTITY_CHANGED");
  const session = await client.query(
    'WITH locked_session AS MATERIALIZED (SELECT id,"expiresAt" FROM auth_session WHERE id=$1 AND "userId"=$2 AND token=$3 FOR UPDATE) SELECT id FROM locked_session WHERE "expiresAt">clock_timestamp()',
    [identity.session.id, actorId, identity.session.token],
  );
  if (session.rowCount !== 1) fail(401, "AUTHENTICATION_REQUIRED");
  return { actor, users };
}
async function context(
  client: PoolClient,
  identity: BookingIdentity,
  businessId: string,
  extra: string[] = [],
) {
  const hint = await business(client, businessId);
  const { actor, users } = await authority(client, identity, [hint.owner_user_id, ...extra]);
  const locked = (
    await client.query<Business>(
      "SELECT id, owner_user_id, title, status FROM directory_business WHERE id = $1 FOR UPDATE",
      [businessId],
    )
  ).rows[0];
  if (!locked || locked.owner_user_id !== hint.owner_user_id) fail(409, "VERSION_CONFLICT");
  return {
    actor,
    business: locked,
    businessOwner: users.find((row) => row.id === locked.owner_user_id),
  };
}
async function settings(query: Query, businessId: string): Promise<BookingSettings> {
  const row = (
    await query.query<{
      enabled: boolean;
      timezone: string;
      version: number;
      windows: BookingWindow[];
      service_ids: string[];
    }>(
      "SELECT enabled, timezone, version, windows, service_ids FROM booking_settings WHERE business_id = $1",
      [businessId],
    )
  ).rows[0];
  if (!row)
    return { enabled: false, timezone: "Europe/Sarajevo", version: 0, windows: [], services: [] };
  const services = (
    await query.query<BookingServiceOption>(
      `SELECT ${serviceColumns} FROM booking_service WHERE business_id = $1 AND id = ANY($2::uuid[]) ORDER BY array_position($2::uuid[], id)`,
      [businessId, row.service_ids],
    )
  ).rows;
  return {
    enabled: row.enabled,
    timezone: row.timezone,
    version: row.version,
    windows: row.windows,
    services,
  };
}
function publicSettings(value: BookingSettings): PublicBookingConfiguration {
  const services = value.services
    .filter((row) => row.active)
    .map(({ active: _active, ...row }) => row);
  const enabled = value.enabled && value.windows.length > 0 && services.length > 0;
  return {
    enabled,
    timezone: value.timezone,
    version: value.version,
    services: enabled ? services : [],
  };
}
function activeService(value: BookingSettings, id: string): BookingServiceOption {
  const service = value.services.find((row) => row.id === id && row.active);
  if (!service) fail(404, "BOOKING_SERVICE_NOT_FOUND");
  return service;
}
function entryDto(row: EntryRow): BookingEntry {
  const { businessOwnerId: _owner, startsAt, endsAt, ...value } = row;
  return { ...value, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
}
async function entry(query: Query, id: string, lock = false): Promise<EntryRow> {
  const row = (
    await query.query<EntryRow>(
      `SELECT ${entryColumns} FROM booking_entry e WHERE e.id = $1${lock ? " FOR UPDATE" : ""}`,
      [id],
    )
  ).rows[0];
  if (!row) fail(404, "BOOKING_NOT_FOUND");
  return row;
}
async function occupied(
  query: Query,
  businessId: string,
  from: string,
  to: string,
): Promise<BookingSlot[]> {
  const rows = (
    await query.query<{ starts_at: Date; ends_at: Date }>(
      "SELECT starts_at, ends_at FROM booking_entry WHERE business_id = $1 AND status IN ('requested','confirmed') AND starts_at < $3 AND ends_at > $2 ORDER BY starts_at LIMIT 5001",
      [businessId, from, to],
    )
  ).rows;
  if (rows.length > 5000) fail(503, "BOOKING_CAPACITY_EXCEEDED");
  return rows.map((row) => ({
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
  }));
}
async function generatedSlots(
  query: Query,
  businessId: string,
  config: BookingSettings,
  service: BookingServiceOption,
  date: string,
  clock: Date,
) {
  const today = dateKey(clock, config.timezone);
  if (date < today || date > addDays(today, 90)) fail(400, "INVALID_BOOKING_INPUT");
  const bounds = dayBounds(date, config.timezone);
  if (!bounds) fail(400, "INVALID_BOOKING_INPUT");
  return dailySlots({
    date,
    timezone: config.timezone,
    windows: config.windows,
    durationMinutes: service.durationMinutes,
    occupied: await occupied(query, businessId, bounds.from, bounds.to),
    now: clock,
  });
}
async function free(
  client: PoolClient,
  businessId: string,
  startsAt: string,
  endsAt: string,
  except?: string,
) {
  const row = (
    await client.query(
      "SELECT id FROM booking_entry WHERE business_id = $1 AND status IN ('requested','confirmed') AND starts_at < $3 AND ends_at > $2 AND ($4::uuid IS NULL OR id <> $4) LIMIT 1",
      [businessId, startsAt, endsAt, except ?? null],
    )
  ).rows[0];
  if (row) fail(409, "SLOT_UNAVAILABLE");
}
function future(startsAt: string, endsAt: string, clock: Date) {
  if (Date.parse(startsAt) <= clock.getTime() || Date.parse(endsAt) <= Date.parse(startsAt))
    fail(400, "INVALID_BOOKING_INPUT");
}
function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
async function replay(client: PoolClient, actorId: string, requestId: string, hash: string) {
  const old = (
    await client.query<{ fingerprint: string; entry_id: string }>(
      "SELECT fingerprint, entry_id FROM booking_create_commands WHERE actor_user_id = $1 AND request_id = $2",
      [actorId, requestId],
    )
  ).rows[0];
  if (!old) return null;
  if (old.fingerprint !== hash) fail(409, "IDEMPOTENCY_CONFLICT");
  return entryDto(await entry(client, old.entry_id));
}
async function command(
  client: PoolClient,
  actorId: string,
  requestId: string,
  hash: string,
  entryId: string,
) {
  await client.query(
    "INSERT INTO booking_create_commands (actor_user_id,request_id,fingerprint,entry_id) VALUES ($1,$2,$3,$4)",
    [actorId, requestId, hash, entryId],
  );
}
async function event(
  client: PoolClient,
  actorId: string,
  entryId: string,
  action: string,
  previousStatus: BookingStatus | null,
  nextStatus: BookingStatus,
  previousVersion: number,
  clock: Date,
) {
  await client.query(
    "INSERT INTO booking_entry_event (id,entry_id,actor_user_id,action,previous_status,next_status,previous_version,next_version,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      randomUUID(),
      entryId,
      actorId,
      action,
      previousStatus,
      nextStatus,
      previousVersion,
      previousVersion + 1,
      clock.toISOString(),
    ],
  );
}
type NewEntry = {
  kind: "customer" | "manual" | "block";
  customerId: string | null;
  service: BookingServiceOption | null;
  timezone: string;
  startsAt: string;
  endsAt: string;
  clientName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
};
async function insert(
  client: PoolClient,
  actor: CurrentAuthUser,
  business: Business,
  value: NewEntry,
  clock: Date,
) {
  const id = randomUUID();
  const values = [
    id,
    business.id,
    business.owner_user_id,
    business.title,
    value.customerId,
    actor.id,
    value.kind,
    value.kind === "customer" ? "requested" : "confirmed",
    value.service?.id ?? null,
    value.service?.name ?? null,
    value.service?.durationMinutes ?? null,
    value.service?.priceMinor ?? 0,
    value.timezone,
    value.startsAt,
    value.endsAt,
    value.clientName,
    value.clientEmail,
    value.clientPhone,
    clock.toISOString(),
  ];
  await client.query(
    "INSERT INTO booking_entry (id,business_id,business_owner_user_id,business_title,customer_user_id,created_by_user_id,kind,status,service_id,service_name,duration_minutes,price_minor,timezone,starts_at,ends_at,client_name,client_email,client_phone,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19)",
    values,
  );
  await event(
    client,
    actor.id,
    id,
    "create",
    null,
    value.kind === "customer" ? "requested" : "confirmed",
    0,
    clock,
  );
  return entryDto(await entry(client, id));
}
async function creditTotal(
  query: Query,
  column: "business_id" | "recipient_user_id",
  id: string,
): Promise<number> {
  const value = Number(
    (
      await query.query<{ amount: string }>(
        `SELECT COALESCE(SUM(amount),0)::text AS amount FROM booking_completion_credit WHERE ${column} = $1`,
        [id],
      )
    ).rows[0]?.amount,
  );
  if (!Number.isSafeInteger(value) || value < 0) fail(503, "BOOKING_UNAVAILABLE");
  return value;
}

export function createBookingService({
  accounts,
  auth,
  pool,
  now = () => new Date(),
}: {
  accounts: AccountService;
  auth: AuthService;
  pool: Pool;
  now?: () => Date;
}) {
  const actor = (headers: Headers): Promise<BookingIdentity> =>
    safe(async () => {
      const expectedAccountId = headers.get("X-AhiBizz-Account-ID");
      if (expectedAccountId !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(expectedAccountId))
        fail(400, "INVALID_BOOKING_INPUT");
      const identity = await accounts.read(headers);
      eligible(identity);
      const signed = await auth.api.getSession({
        headers,
        query: { disableCookieCache: true, disableRefresh: true },
      });
      if (
        !signed?.session ||
        signed.session.userId !== identity.id ||
        signed.user.id !== identity.id
      )
        fail(401, "AUTHENTICATION_REQUIRED");
      return {
        ...identity,
        session: signed.session,
        ...(expectedAccountId === null ? {} : { expectedAccountId }),
      };
    });
  const clock = () => {
    const value = now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
      fail(503, "BOOKING_UNAVAILABLE");
    return new Date(value.getTime());
  };
  return {
    async publicConfig(businessId: string): Promise<PublicBookingConfiguration> {
      const id = uuid(businessId);
      return safe(async () => {
        await publicBusiness(pool, id);
        return publicSettings(await settings(pool, id));
      });
    },
    async slots(businessId: string, input: unknown) {
      const id = uuid(businessId),
        value = slotInput(input);
      return safe(async () => {
        await publicBusiness(pool, id);
        const config = await settings(pool, id);
        if (!publicSettings(config).enabled) fail(409, "BOOKING_DISABLED");
        const service = activeService(config, value.serviceId);
        return {
          timezone: config.timezone,
          date: value.date,
          serviceId: service.id,
          configurationVersion: config.version,
          slots: await generatedSlots(pool, id, config, service, value.date, clock()),
        };
      });
    },
    async readSettings(headers: Headers, businessId: string): Promise<BookingSettings> {
      const identity = await actor(headers),
        id = uuid(businessId);
      return transaction(pool, async (client) => {
        const ctx = await context(client, identity, id);
        owner(ctx.actor, ctx.business);
        return settings(client, id);
      });
    },
    async saveSettings(
      headers: Headers,
      businessId: string,
      input: unknown,
    ): Promise<BookingSettings> {
      const value = settingsInput(input),
        identity = await actor(headers),
        id = uuid(businessId);
      return transaction(pool, async (client) => {
        const ctx = await context(client, identity, id);
        owner(ctx.actor, ctx.business);
        const before = await settings(client, id),
          instant = clock();
        if (before.version !== value.expectedVersion || before.version >= 2147483647)
          fail(409, "VERSION_CONFLICT");
        if (
          before.timezone !== value.timezone &&
          (
            await client.query(
              "SELECT id FROM booking_entry WHERE business_id = $1 AND status IN ('requested','confirmed') AND ends_at > $2 LIMIT 1",
              [id, instant.toISOString()],
            )
          ).rows.length
        )
          fail(409, "BOOKING_TIMEZONE_IN_USE");
        const ids: string[] = [];
        for (const service of value.services) {
          const serviceId = service.id ?? randomUUID();
          if (
            service.id &&
            !(
              await client.query(
                "SELECT id FROM booking_service WHERE id = $1 AND business_id = $2",
                [service.id, id],
              )
            ).rows.length
          )
            fail(400, "INVALID_BOOKING_INPUT");
          const written = await client.query(
            "INSERT INTO booking_service (id,business_id,name,duration_minutes,price_minor,active) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,duration_minutes=EXCLUDED.duration_minutes,price_minor=EXCLUDED.price_minor,active=EXCLUDED.active,updated_at=$7 WHERE booking_service.business_id=EXCLUDED.business_id",
            [
              serviceId,
              id,
              service.name,
              service.durationMinutes,
              service.priceMinor,
              service.active,
              instant.toISOString(),
            ],
          );
          if (written.rowCount !== 1) fail(409, "VERSION_CONFLICT");
          ids.push(serviceId);
        }
        await client.query(
          "UPDATE booking_service SET active=false,updated_at=$3 WHERE business_id=$1 AND NOT (id=ANY($2::uuid[]))",
          [id, ids, instant.toISOString()],
        );
        const saved = await client.query(
          "INSERT INTO booking_settings (business_id,enabled,timezone,windows,service_ids,version,updated_at) VALUES ($1,$2,$3,$4,$5,1,$6) ON CONFLICT (business_id) DO UPDATE SET enabled=EXCLUDED.enabled,timezone=EXCLUDED.timezone,windows=EXCLUDED.windows,service_ids=EXCLUDED.service_ids,version=booking_settings.version+1,updated_at=EXCLUDED.updated_at WHERE booking_settings.version=$7",
          [
            id,
            value.enabled,
            value.timezone,
            JSON.stringify(value.windows),
            ids,
            instant.toISOString(),
            value.expectedVersion,
          ],
        );
        if (saved.rowCount !== 1) fail(409, "VERSION_CONFLICT");
        return settings(client, id);
      });
    },
    async calendar(headers: Headers, businessId: string, input: unknown) {
      const identity = await actor(headers),
        id = uuid(businessId),
        value = rangeInput(input);
      return transaction(pool, async (client) => {
        const ctx = await context(client, identity, id);
        owner(ctx.actor, ctx.business);
        const rows = (
          await client.query<EntryRow>(
            `SELECT ${entryColumns} FROM booking_entry e WHERE e.business_id=$1 AND e.starts_at<$3 AND e.ends_at>$2 ORDER BY e.starts_at,e.id LIMIT 5001`,
            [id, value.from, value.to],
          )
        ).rows;
        if (rows.length > 5000) fail(503, "BOOKING_CAPACITY_EXCEEDED");
        return {
          entries: rows.map(entryDto),
          earnedCredits: await creditTotal(client, "business_id", id),
        };
      });
    },
    async listMine(headers: Headers, input: unknown = {}) {
      const identity = await actor(headers),
        { page, view } = mineInput(input);
      return transaction(pool, async (client) => {
        const { actor: currentActor } = await authority(client, identity);
        const asOf = clock().toISOString();
        const active = "e.status IN ('requested','confirmed') AND e.ends_at > $3::timestamptz";
        const filter =
          view === "upcoming" ? `AND (${active})` : view === "history" ? `AND NOT (${active})` : "";
        const order =
          view === "upcoming" ? "e.starts_at ASC,e.id ASC" : "e.starts_at DESC,e.id DESC";
        const rows = (
          await client.query<EntryRow>(
            `SELECT ${entryColumns} FROM booking_entry e WHERE e.customer_user_id=$1 ${filter} ORDER BY ${order} LIMIT 21 OFFSET $2`,
            view ? [currentActor.id, (page - 1) * 20, asOf] : [currentActor.id, (page - 1) * 20],
          )
        ).rows;
        return {
          entries: rows.slice(0, 20).map(entryDto),
          page,
          hasMore: rows.length > 20,
          credits: await creditTotal(client, "recipient_user_id", currentActor.id),
          ...(view ? { view, asOf } : {}),
        };
      });
    },
    async createRequest(
      headers: Headers,
      businessId: string,
      input: unknown,
      requestId: string,
    ): Promise<BookingEntry> {
      const value = requestInput(input),
        id = uuid(businessId),
        key = uuid(requestId),
        hash = fingerprint(["customer", id, value]),
        identity = await actor(headers);
      return transaction(pool, async (client) => {
        const ctx = await context(client, identity, id);
        const old = await replay(client, identity.id, key, hash);
        if (old) return old;
        visible(ctx.business, ctx.businessOwner);
        if (ctx.actor.id === ctx.business.owner_user_id) fail(403, "SELF_BOOKING_NOT_ALLOWED");
        const config = await settings(client, id);
        if (config.version !== value.configurationVersion)
          fail(409, "BOOKING_CONFIGURATION_CHANGED");
        if (!publicSettings(config).enabled) fail(409, "BOOKING_DISABLED");
        const service = activeService(config, value.serviceId),
          instant = clock();
        const date = dateKey(new Date(value.startsAt), config.timezone);
        const slots = await generatedSlots(client, id, config, service, date, instant);
        const selected = slots.find((slot) => slot.startsAt === value.startsAt);
        if (!selected) fail(409, "SLOT_UNAVAILABLE");
        await free(client, id, selected.startsAt, selected.endsAt);
        const result = await insert(
          client,
          ctx.actor,
          ctx.business,
          {
            kind: "customer",
            customerId: ctx.actor.id,
            service,
            timezone: config.timezone,
            ...selected,
            clientName: ctx.actor.name,
            clientEmail: ctx.actor.email,
            clientPhone: null,
          },
          instant,
        );
        await command(client, ctx.actor.id, key, hash, result.id);
        return result;
      });
    },
    async createManual(
      headers: Headers,
      businessId: string,
      input: unknown,
      requestId: string,
    ): Promise<BookingEntry> {
      const value = manualInput(input),
        id = uuid(businessId),
        key = uuid(requestId),
        hash = fingerprint(["manual", id, value]),
        identity = await actor(headers);
      return transaction(pool, async (client) => {
        const ctx = await context(client, identity, id);
        owner(ctx.actor, ctx.business);
        const old = await replay(client, identity.id, key, hash);
        if (old) return old;
        const config = await settings(client, id),
          instant = clock();
        if (config.version !== value.configurationVersion)
          fail(409, "BOOKING_CONFIGURATION_CHANGED");
        const service =
          value.kind === "manual" ? activeService(config, value.serviceId as string) : null;
        const endsAt = service
          ? new Date(Date.parse(value.startsAt) + service.durationMinutes * 60000).toISOString()
          : value.endsAt;
        if (!endsAt || (service && value.endsAt && value.endsAt !== endsAt))
          fail(400, "INVALID_BOOKING_INPUT");
        future(value.startsAt, endsAt, instant);
        if (
          value.kind === "block" &&
          Date.parse(endsAt) - Date.parse(value.startsAt) > 31 * 86400000
        )
          fail(400, "INVALID_BOOKING_INPUT");
        await free(client, id, value.startsAt, endsAt);
        const result = await insert(
          client,
          ctx.actor,
          ctx.business,
          {
            kind: value.kind,
            customerId: null,
            service,
            timezone: config.timezone,
            startsAt: value.startsAt,
            endsAt,
            clientName: value.clientName,
            clientEmail: null,
            clientPhone: value.clientPhone,
          },
          instant,
        );
        await command(client, ctx.actor.id, key, hash, result.id);
        return result;
      });
    },
    async transition(headers: Headers, entryId: string, input: unknown): Promise<BookingEntry> {
      const value = transitionInput(input),
        id = uuid(entryId),
        identity = await actor(headers);
      return transaction(pool, async (client) => {
        const hint = await entry(client, id);
        const ctx = await context(
          client,
          identity,
          hint.businessId,
          hint.customerId ? [hint.customerId] : [],
        );
        const before = await entry(client, id, true);
        const manages = ctx.actor.role === "owner" || ctx.actor.id === ctx.business.owner_user_id;
        const customer = before.kind === "customer" && before.customerId === ctx.actor.id;
        if (!manages && !customer) fail(404, "BOOKING_NOT_FOUND");
        if (before.version !== value.expectedVersion || before.version >= 2147483647)
          fail(409, "VERSION_CONFLICT");
        const instant = clock();
        let status: BookingStatus;
        if (value.action === "approve") {
          if (
            !manages ||
            before.status !== "requested" ||
            before.startsAt.getTime() <= instant.getTime()
          )
            fail(409, "INVALID_BOOKING_TRANSITION");
          status = "confirmed";
          await free(
            client,
            before.businessId,
            before.startsAt.toISOString(),
            before.endsAt.toISOString(),
            before.id,
          );
        } else if (value.action === "decline") {
          if (!manages || before.status !== "requested") fail(409, "INVALID_BOOKING_TRANSITION");
          status = "declined";
        } else if (value.action === "cancel") {
          if (
            !["requested", "confirmed"].includes(before.status) ||
            (!manages && before.startsAt.getTime() <= instant.getTime())
          )
            fail(409, "INVALID_BOOKING_TRANSITION");
          status = "cancelled";
        } else {
          if (
            !manages ||
            before.status !== "confirmed" ||
            before.kind === "block" ||
            before.endsAt.getTime() > instant.getTime()
          )
            fail(409, "INVALID_BOOKING_TRANSITION");
          status = "completed";
        }
        const changed = await client.query(
          "UPDATE booking_entry SET status=$1,version=version+1,updated_at=$2 WHERE id=$3 AND version=$4",
          [status, instant.toISOString(), id, before.version],
        );
        if (changed.rowCount !== 1) fail(409, "VERSION_CONFLICT");
        await event(
          client,
          ctx.actor.id,
          id,
          value.action,
          before.status,
          status,
          before.version,
          instant,
        );
        if (
          status === "completed" &&
          before.kind === "customer" &&
          before.customerId &&
          before.customerId !== before.businessOwnerId
        ) {
          await client.query(
            "INSERT INTO booking_completion_credit (entry_id,business_id,recipient_user_id,amount,created_at) VALUES ($1,$2,$3,5,$4) ON CONFLICT (entry_id) DO NOTHING",
            [id, before.businessId, before.businessOwnerId, instant.toISOString()],
          );
        }
        return entryDto(await entry(client, id));
      });
    },
  };
}

export type BookingService = ReturnType<typeof createBookingService>;
let service: BookingService | undefined;
export function getBookingService(): BookingService | null {
  if (service) return service;
  const accounts = getAccountService(),
    auth = getAuthService(),
    pool = getAuthDatabasePool();
  if (!accounts || !auth || !pool) return null;
  service = createBookingService({ accounts, auth, pool });
  return service;
}
