import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  type BillingCatalog,
  type BillingReceipt,
  type BillingSummary,
  billingAllocation,
  billingCatalogVersion,
  billingDevelopmentRateBps,
  billingPackages,
} from "../../lib/billing";
import { type AuthService, getAuthService } from "../auth";
import { AccountAccessError, type AccountService, getAccountService } from "../auth/accounts";
import { type CurrentAuthUser, getAuthDatabasePool } from "../auth/service";
import {
  adjustmentInput,
  BillingAccessError,
  businessesInput,
  createInput,
  fail,
  pageInput,
  uuid,
} from "./validation";

const pageSize = 30;
const columns = `r.id,r.kind,r.package_id AS "packageId",r.period,r.business_id AS "businessId",r.business_title AS "businessTitle",r.catalog_version AS "catalogVersion",r.quoted_price_minor AS "quotedPriceMinor",r.commitment_months AS "commitmentMonths",r.commitment_total_minor AS "commitmentTotalMinor",r.service_starts_on::text AS "serviceStartsOn",r.service_ends_on::text AS "serviceEndsOn",r.source,r.external_reference AS "externalReference",r.received_at AS "receivedAt",r.gross_minor AS "grossMinor",r.refunded_minor AS "refundedMinor",r.tax_minor AS "taxMinor",r.fee_minor AS "feeMinor",r.net_base_minor AS "netBaseMinor",r.development_rate_bps AS "developmentRateBps",r.development_minor AS "developmentMinor",r.allocation_status AS "allocationStatus",r.version,r.created_at AS "createdAt",r.updated_at AS "updatedAt"`;
type Row = Omit<BillingReceipt, "receivedAt" | "createdAt" | "updatedAt"> & {
  receivedAt: string | Date;
  createdAt: string | Date;
  updatedAt: string | Date;
};
type Identity = {
  id: string;
  session: { id: string; userId: string; token: string };
  expectedAccountId: string | null;
};
function dto(row: Row): BillingReceipt {
  return {
    ...row,
    receivedAt: new Date(row.receivedAt).toISOString(),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}
function eligible(user: CurrentAuthUser | undefined): asserts user is CurrentAuthUser {
  if (!user) fail(401, "AUTHENTICATION_REQUIRED");
  if (user.approval === "suspended") fail(403, "ACCOUNT_SUSPENDED");
  if (user.approval !== "approved") fail(403, "ACCOUNT_PENDING_APPROVAL");
  if (user.emailVerified !== true) fail(403, "EMAIL_NOT_VERIFIED");
  if (user.role !== "owner") fail(403, "OWNER_REQUIRED");
}
async function safe<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof BillingAccessError) throw error;
    if (error instanceof AccountAccessError) throw new BillingAccessError(error.status, error.code);
    if (error && typeof error === "object" && "code" in error && error.code === "23505")
      fail(409, "BILLING_REFERENCE_CONFLICT");
    throw new BillingAccessError(503, "BILLING_UNAVAILABLE");
  }
}
async function transaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  return safe(async () => {
    const client = await pool.connect();
    let begun = false,
      discard = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      begun = true;
      await client.query("SET LOCAL lock_timeout='2s'");
      await client.query("SET LOCAL statement_timeout='3s'");
      const result = await action(client);
      await client.query("COMMIT");
      begun = false;
      return result;
    } catch (error) {
      if (begun)
        try {
          await client.query("ROLLBACK");
        } catch {
          discard = true;
        }
      throw error;
    } finally {
      client.release(discard);
    }
  });
}
function actorDto(user: CurrentAuthUser) {
  return { id: user.id, role: "owner" as const };
}
async function lockedActor(client: PoolClient, identity: Identity) {
  const user = (
    await client.query<CurrentAuthUser>(
      'SELECT id,name,email,"emailVerified",role,approval FROM auth_user WHERE id=$1 FOR UPDATE',
      [identity.id],
    )
  ).rows[0];
  eligible(user);
  if (identity.expectedAccountId !== null && user.id !== identity.expectedAccountId)
    fail(401, "ACCOUNT_IDENTITY_CHANGED");
  const session = await client.query(
    'WITH locked_session AS MATERIALIZED (SELECT id,"expiresAt" FROM auth_session WHERE id=$1 AND "userId"=$2 AND token=$3 FOR UPDATE) SELECT id FROM locked_session WHERE "expiresAt">clock_timestamp()',
    [identity.session.id, user.id, identity.session.token],
  );
  if (session.rowCount !== 1) fail(401, "AUTHENTICATION_REQUIRED");
  return user;
}
async function receipt(client: Pick<PoolClient, "query">, id: string, lock = false) {
  const row = (
    await client.query<Row>(
      `SELECT ${columns} FROM billing_receipt r WHERE r.id=$1${lock ? " FOR UPDATE" : ""}`,
      [id],
    )
  ).rows[0];
  if (!row) fail(404, "BILLING_RECEIPT_NOT_FOUND");
  return dto(row);
}
function facts(value: BillingReceipt) {
  return {
    kind: value.kind,
    grossMinor: value.grossMinor,
    refundedMinor: value.refundedMinor,
    taxMinor: value.taxMinor,
    feeMinor: value.feeMinor,
    netBaseMinor: value.netBaseMinor,
    developmentRateBps: value.developmentRateBps,
    developmentMinor: value.developmentMinor,
    allocationStatus: value.allocationStatus,
    serviceStartsOn: value.serviceStartsOn,
    serviceEndsOn: value.serviceEndsOn,
  };
}
async function audit(
  client: PoolClient,
  actorId: string,
  before: BillingReceipt | null,
  after: BillingReceipt,
  reason: string,
  now: string,
) {
  const eventId = randomUUID(),
    delta = (after.developmentMinor ?? 0) - (before?.developmentMinor ?? 0);
  await client.query(
    "INSERT INTO billing_receipt_event(id,receipt_id,actor_user_id,action,previous_version,next_version,previous_facts,next_facts,development_delta_minor,reason,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    [
      eventId,
      after.id,
      actorId,
      before ? "adjust" : "create",
      before?.version ?? 0,
      after.version,
      before ? JSON.stringify(facts(before)) : null,
      JSON.stringify(facts(after)),
      delta,
      reason,
      now,
    ],
  );
  if (
    after.kind === "subscription" &&
    (after.developmentMinor !== null || (before !== null && before.developmentMinor !== null))
  )
    await client.query(
      "INSERT INTO billing_development_ledger(id,event_id,receipt_id,receipt_version,delta_minor,reason,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [randomUUID(), eventId, after.id, after.version, delta, reason, now],
    );
}
function summary(value: Record<keyof BillingSummary, string>): BillingSummary {
  const result = Object.fromEntries(
    Object.entries(value).map(([key, value]) => [key, Number(value)]),
  ) as BillingSummary;
  if (Object.values(result).some((value) => !Number.isSafeInteger(value) || value < 0))
    fail(503, "BILLING_UNAVAILABLE");
  return result;
}
export function getBillingCatalog(rate: number | null = billingDevelopmentRateBps): BillingCatalog {
  return {
    version: billingCatalogVersion,
    currency: "BAM",
    packages: billingPackages.map((row) => ({ ...row })),
    monthlyCommitmentMonths: 12,
    developmentRateBps: rate,
    developmentBasis: "gross_less_refunds_tax_fees",
    contractStatus: "draft",
    operatorStatus: "unconfirmed",
    checkoutEnabled: false,
    automaticCharging: false,
    membershipActivation: false,
  };
}
export function createBillingService({
  accounts,
  auth,
  pool,
  developmentRateBps = billingDevelopmentRateBps,
  now = () => new Date(),
}: {
  accounts: AccountService;
  auth: AuthService;
  pool: Pool;
  developmentRateBps?: number | null;
  now?: () => Date;
}) {
  if (
    developmentRateBps !== null &&
    (!Number.isInteger(developmentRateBps) || developmentRateBps < 0 || developmentRateBps > 10000)
  )
    fail(503, "BILLING_CONFIGURATION_INVALID");
  const identity = (headers: Headers) =>
    safe(async (): Promise<Identity> => {
      const expectedAccountId = headers.get("X-AhiBizz-Account-ID");
      if (expectedAccountId !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(expectedAccountId))
        fail(400, "INVALID_BILLING_INPUT");
      const user = await accounts.read(headers);
      eligible(user);
      const signed = await auth.api.getSession({
        headers,
        query: { disableCookieCache: true, disableRefresh: true },
      });
      if (!signed?.session || signed.session.userId !== user.id || signed.user.id !== user.id)
        fail(401, "AUTHENTICATION_REQUIRED");
      return { id: user.id, session: signed.session, expectedAccountId };
    });
  const clock = () => {
    const value = now();
    if (!Number.isFinite(value.getTime())) fail(503, "BILLING_UNAVAILABLE");
    return value.toISOString();
  };
  return {
    catalog: () => getBillingCatalog(developmentRateBps),
    async listAdmin(headers: Headers, input: unknown = {}) {
      const page = pageInput(input),
        signed = await identity(headers);
      return transaction(pool, async (client) => {
        const user = await lockedActor(client, signed);
        const result = (
          await client.query(
            `WITH selected AS (SELECT ${columns} FROM billing_receipt r ORDER BY r.created_at DESC,r.id DESC LIMIT $1 OFFSET $2), totals AS (SELECT count(*)::text AS "receiptCount",COALESCE(sum(gross_minor),0)::text AS "grossMinor",COALESCE(sum(refunded_minor),0)::text AS "refundedMinor",COALESCE(sum(net_base_minor),0)::text AS "knownNetBaseMinor",count(*) FILTER(WHERE net_base_minor IS NULL)::text AS "unknownNetCount",COALESCE(sum(gross_minor-refunded_minor) FILTER(WHERE net_base_minor IS NULL),0)::text AS "unknownNetCashMinor",count(*) FILTER(WHERE allocation_status='pending')::text AS "allocationPendingCount",COALESCE(sum(gross_minor) FILTER(WHERE kind='photo_video'),0)::text AS "photoVideoGrossMinor",(SELECT COALESCE(sum(delta_minor),0)::text FROM billing_development_ledger) AS "developmentPostedMinor" FROM billing_receipt) SELECT COALESCE((SELECT jsonb_agg(selected ORDER BY selected."createdAt" DESC,selected.id DESC) FROM selected),'[]'::jsonb) AS items,(SELECT row_to_json(totals) FROM totals) AS summary`,
            [pageSize + 1, (page - 1) * pageSize],
          )
        ).rows[0];
        return {
          actor: actorDto(user),
          receipts: (result.items as Row[]).slice(0, pageSize).map(dto),
          summary: summary(result.summary),
          page,
          hasMore: result.items.length > pageSize,
        };
      });
    },
    async listBusinesses(headers: Headers, input: unknown = {}) {
      const value = businessesInput(input),
        signed = await identity(headers);
      return transaction(pool, async (client) => {
        const user = await lockedActor(client, signed),
          pattern = value.q ? `%${value.q.replace(/[\\%_]/g, "\\$&")}%` : null;
        const result = await client.query<{ id: string; title: string }>(
          "SELECT id,title FROM directory_business WHERE $1::text IS NULL OR title ILIKE $1 ESCAPE E'\\\\' OR id::text ILIKE $1 ESCAPE E'\\\\' ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3",
          [pattern, pageSize + 1, (value.page - 1) * pageSize],
        );
        return {
          actor: actorDto(user),
          businesses: result.rows.slice(0, pageSize),
          page: value.page,
          hasMore: result.rows.length > pageSize,
        };
      });
    },
    async listDevelopment(headers: Headers, input: unknown = {}) {
      const page = pageInput(input),
        signed = await identity(headers);
      return transaction(pool, async (client) => {
        const user = await lockedActor(client, signed);
        const result = await client.query(
          'SELECT l.id,l.receipt_id AS "receiptId",r.external_reference AS "externalReference",l.receipt_version AS "receiptVersion",l.delta_minor AS "deltaMinor",l.reason,l.created_at AS "createdAt" FROM billing_development_ledger l JOIN billing_receipt r ON r.id=l.receipt_id ORDER BY l.created_at DESC,l.id DESC LIMIT $1 OFFSET $2',
          [pageSize + 1, (page - 1) * pageSize],
        );
        return {
          actor: actorDto(user),
          developmentEntries: result.rows
            .slice(0, pageSize)
            .map((row) => ({ ...row, createdAt: new Date(row.createdAt).toISOString() })),
          page,
          hasMore: result.rows.length > pageSize,
        };
      });
    },
    async readReceipt(headers: Headers, id: string) {
      const key = uuid(id),
        signed = await identity(headers);
      return transaction(pool, async (client) => ({
        actor: actorDto(await lockedActor(client, signed)),
        receipt: await receipt(client, key),
      }));
    },
    async readCommand(headers: Headers, requestId: string) {
      const key = uuid(requestId),
        signed = await identity(headers);
      return transaction(pool, async (client) => {
        const user = await lockedActor(client, signed),
          row = (
            await client.query<{ receipt_id: string }>(
              "SELECT receipt_id FROM billing_create_command WHERE actor_user_id=$1 AND request_id=$2",
              [user.id, key],
            )
          ).rows[0];
        return {
          actor: actorDto(user),
          receipt: row ? await receipt(client, row.receipt_id) : null,
        };
      });
    },
    async createReceipt(headers: Headers, input: unknown, requestId: string) {
      const value = createInput(input),
        key = uuid(requestId),
        hash = createHash("sha256").update(JSON.stringify(value)).digest("hex"),
        signed = await identity(headers);
      return transaction(pool, async (client) => {
        const user = await lockedActor(client, signed);
        const old = (
          await client.query<{ fingerprint: string; receipt_id: string }>(
            "SELECT fingerprint,receipt_id FROM billing_create_command WHERE actor_user_id=$1 AND request_id=$2",
            [user.id, key],
          )
        ).rows[0];
        if (old) {
          if (old.fingerprint !== hash) fail(409, "IDEMPOTENCY_CONFLICT");
          return { actor: actorDto(user), receipt: await receipt(client, old.receipt_id) };
        }
        const instant = clock();
        if (value.receivedAt > instant) fail(400, "INVALID_BILLING_INPUT");
        const business =
          value.businessId === null
            ? null
            : (
                await client.query<{ title: string }>(
                  "SELECT title FROM directory_business WHERE id=$1 FOR SHARE",
                  [value.businessId],
                )
              ).rows[0];
        if (value.businessId !== null && !business) fail(404, "BUSINESS_NOT_FOUND");
        const plan =
          value.kind === "subscription"
            ? billingPackages.find((plan) => plan.id === value.packageId)
            : null;
        const quote = plan
          ? value.period === "annual"
            ? plan.annualMinor
            : plan.monthlyMinor
          : null;
        const allocation = billingAllocation({
          ...value,
          refundedMinor: 0,
          developmentRateBps: plan ? developmentRateBps : null,
        });
        const id = randomUUID();
        await client.query(
          "INSERT INTO billing_receipt(id,kind,package_id,period,business_id,business_title,catalog_version,quoted_price_minor,commitment_months,commitment_total_minor,service_starts_on,service_ends_on,source,external_reference,received_at,gross_minor,tax_minor,fee_minor,net_base_minor,development_rate_bps,development_minor,allocation_status,created_by_user_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$24)",
          [
            id,
            value.kind,
            value.packageId,
            value.period,
            value.businessId,
            business?.title ?? null,
            plan ? billingCatalogVersion : null,
            quote,
            plan ? 12 : null,
            plan ? (value.period === "annual" ? plan.annualMinor : plan.monthlyMinor * 12) : null,
            value.serviceStartsOn,
            value.serviceEndsOn,
            value.source,
            value.externalReference,
            value.receivedAt,
            value.grossMinor,
            value.taxMinor,
            value.feeMinor,
            allocation.netBaseMinor,
            plan ? developmentRateBps : null,
            allocation.developmentMinor,
            allocation.allocationStatus,
            user.id,
            instant,
          ],
        );
        const after = await receipt(client, id);
        await audit(client, user.id, null, after, "Ručno potvrđen primitak", instant);
        await client.query(
          "INSERT INTO billing_create_command(actor_user_id,request_id,fingerprint,receipt_id,created_at) VALUES($1,$2,$3,$4,$5)",
          [user.id, key, hash, id, instant],
        );
        return { actor: actorDto(user), receipt: after };
      });
    },
    async adjustReceipt(headers: Headers, id: string, input: unknown) {
      const value = adjustmentInput(input),
        key = uuid(id),
        signed = await identity(headers);
      return transaction(pool, async (client) => {
        const user = await lockedActor(client, signed),
          before = await receipt(client, key, true);
        if (before.version !== value.expectedVersion) fail(409, "VERSION_CONFLICT");
        if (value.refundedMinor < before.refundedMinor || value.refundedMinor > before.grossMinor)
          fail(400, "INVALID_BILLING_INPUT");
        const dates = {
          serviceStartsOn:
            value.serviceStartsOn === undefined ? before.serviceStartsOn : value.serviceStartsOn,
          serviceEndsOn:
            value.serviceEndsOn === undefined ? before.serviceEndsOn : value.serviceEndsOn,
        };
        if (before.kind === "subscription" && dates.serviceStartsOn === null)
          fail(400, "INVALID_BILLING_INPUT");
        if (
          value.refundedMinor === before.refundedMinor &&
          value.taxMinor === before.taxMinor &&
          value.feeMinor === before.feeMinor &&
          dates.serviceStartsOn === before.serviceStartsOn &&
          dates.serviceEndsOn === before.serviceEndsOn
        )
          fail(400, "NO_ACCOUNTING_CHANGE");
        const allocation = billingAllocation({ ...before, ...value });
        const instant = clock();
        const changed = await client.query(
          "UPDATE billing_receipt SET refunded_minor=$1,tax_minor=$2,fee_minor=$3,net_base_minor=$4,development_minor=$5,allocation_status=$6,service_starts_on=$7,service_ends_on=$8,version=version+1,updated_at=$9 WHERE id=$10 AND version=$11",
          [
            value.refundedMinor,
            value.taxMinor,
            value.feeMinor,
            allocation.netBaseMinor,
            allocation.developmentMinor,
            allocation.allocationStatus,
            dates.serviceStartsOn,
            dates.serviceEndsOn,
            instant,
            key,
            before.version,
          ],
        );
        if (changed.rowCount !== 1) fail(409, "VERSION_CONFLICT");
        const after = await receipt(client, key);
        await audit(client, user.id, before, after, value.reason, instant);
        return { actor: actorDto(user), receipt: after };
      });
    },
  };
}
export type BillingService = ReturnType<typeof createBillingService>;
let service: BillingService | undefined;
export function getBillingService(): BillingService | null {
  if (service) return service;
  const accounts = getAccountService(),
    auth = getAuthService(),
    pool = getAuthDatabasePool();
  if (!accounts || !auth || !pool) return null;
  service = createBillingService({ accounts, auth, pool });
  return service;
}
