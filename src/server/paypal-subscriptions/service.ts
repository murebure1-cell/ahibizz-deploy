import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { BillingPackageId, BillingPeriod } from "../../lib/billing";
import { creditsForBamMinor } from "../../lib/wallet";
import { AccountAccessError, accountTransaction, createAccountAccess } from "../auth/accounts";
import type { AuthService } from "../auth/service";
import { readPlatformCreditsOnly } from "../wallet/platform-policy";
import { debitWallet, readWalletRate, walletBalance } from "../wallet/service";
import { getPackageBenefits } from "./benefits";
import { type PlanReferences, packageQuote, type SubscriptionEnvironment } from "./config";
import {
  remoteStatuses,
  type Snapshot,
  type SubscriptionProvider,
  subscriptionApproval,
} from "./provider";

export type SandboxRecord = {
  id: string;
  userId: string;
  businessId: string;
  businessTitle: string;
  requestId: string;
  packageId: BillingPackageId;
  period: BillingPeriod;
  amountBamMinor: number;
  amountEurMinor: number;
  totalCycles: number;
  planId: string;
  providerId: string | null;
  approvalUrl: string | null;
  status: string;
  providerUpdatedAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  paidCycles: number;
  paidEurMinor: number;
  paymentMethod?: "paypal" | "credits";
  cycleCreditMinor?: number | null;
  reportedCycles?: number;
  benefitsVersion?: number;
  nearbyDays?: number;
  featuredDays?: number;
  createdAt: string;
};
const commonColumns = `id,user_id AS "userId",business_id AS "businessId",business_title AS "businessTitle",request_id AS "requestId",package_id AS "packageId",period,amount_bam_minor AS "amountBamMinor",amount_eur_minor AS "amountEurMinor",total_cycles AS "totalCycles",plan_id AS "planId",provider_id AS "providerId",approval_url AS "approvalUrl",status,provider_updated_at AS "providerUpdatedAt",starts_at AS "startsAt",ends_at AS "endsAt",paid_cycles AS "paidCycles",paid_eur_minor AS "paidEurMinor",reported_cycles AS "reportedCycles",created_at AS "createdAt"`;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function fail(status: number, code: string): never {
  throw new AccountAccessError(status, code);
}
function uuid(v: unknown) {
  if (typeof v !== "string" || !uuidPattern.test(v)) return fail(400, "INVALID_SUBSCRIPTION_INPUT");
  return v.toLowerCase();
}
function normalized(r: SandboxRecord): SandboxRecord {
  const iso = (s: string | null) => (s === null ? null : new Date(s).toISOString());
  return {
    ...r,
    createdAt: new Date(r.createdAt).toISOString(),
    providerUpdatedAt: iso(r.providerUpdatedAt),
    startsAt: iso(r.startsAt),
    endsAt: iso(r.endsAt),
  };
}
function dto(r: SandboxRecord) {
  const {
    id,
    requestId,
    businessId,
    businessTitle,
    packageId,
    period,
    status,
    amountBamMinor,
    amountEurMinor,
    totalCycles,
    paidCycles,
    paidEurMinor,
    startsAt,
    endsAt,
    createdAt,
  } = normalized(r);
  const anniversary = startsAt ? new Date(startsAt) : null;
  if (anniversary) {
    const month = anniversary.getUTCMonth();
    anniversary.setUTCFullYear(anniversary.getUTCFullYear() + 1);
    if (anniversary.getUTCMonth() !== month) anniversary.setUTCDate(0);
  }
  return {
    contractualEndsAt: anniversary?.toISOString() ?? null,
    ...(r.benefitsVersion
      ? {
          benefitsVersion: r.benefitsVersion,
          nearbyDays: r.nearbyDays,
          featuredDays: r.featuredDays,
        }
      : {}),
    ...(r.paymentMethod === "credits"
      ? { paymentMethod: "credits" as const, cycleCreditMinor: Number(r.cycleCreditMinor) }
      : r.paymentMethod === "paypal"
        ? { paymentMethod: "paypal" as const }
        : {}),
    id,
    requestId,
    businessId,
    businessTitle,
    packageId,
    period,
    status,
    amountBamMinor,
    amountEurMinor,
    totalCycles,
    paidCycles,
    paidEurMinor,
    startsAt,
    endsAt,
    createdAt,
  };
}
export type StartInput = {
  businessId: string;
  requestId: string;
  packageId: BillingPackageId;
  period: BillingPeriod;
  accepted: boolean;
  expectedCreditMinor?: number;
  benefitsVersion?: number;
};
function approval(record: SandboxRecord) {
  const pending = record.status === "APPROVAL_PENDING";
  return {
    contract: dto(record),
    approvalUrl: pending ? record.approvalUrl : null,
    subscriptionId: pending ? record.providerId : null,
  };
}
function validateStart(value: unknown, wallet: boolean): StartInput {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (k) =>
        ![
          "businessId",
          "requestId",
          "packageId",
          "period",
          "accepted",
          "benefitsVersion",
          ...(wallet ? ["expectedCreditMinor"] : []),
        ].includes(k),
    )
  )
    return fail(400, "INVALID_SUBSCRIPTION_INPUT");
  const v = value as StartInput;
  const offer = packageQuote(v.packageId, v.period);
  if (
    !offer ||
    v.accepted !== true ||
    (wallet && (!Number.isSafeInteger(v.expectedCreditMinor) || Number(v.expectedCreditMinor) < 1))
  )
    return fail(400, "INVALID_SUBSCRIPTION_INPUT");
  return { ...v, businessId: uuid(v.businessId), requestId: uuid(v.requestId) };
}
export function createPackageSubscriptions({
  environment = "sandbox",
  pool,
  auth,
  plans,
  provider,
}: {
  environment?: SubscriptionEnvironment;
  pool: Pool;
  auth: AuthService;
  plans: PlanReferences;
  provider: SubscriptionProvider | null;
}) {
  const columns =
    commonColumns +
    (environment === "live"
      ? ',benefits_version AS "benefitsVersion",nearby_days AS "nearbyDays",featured_days AS "featuredDays",payment_method AS "paymentMethod",cycle_credit_minor AS "cycleCreditMinor"'
      : "");
  const contracts = environment === "live" ? "live_package_contract" : "sandbox_package_contract";
  const payments = environment === "live" ? "live_package_payment" : "sandbox_package_payment";
  async function read(c: PoolClient, id: string, owner?: string) {
    const row = (
      await c.query<SandboxRecord>(`SELECT ${columns} FROM ${contracts} WHERE id=$1 FOR UPDATE`, [
        uuid(id),
      ])
    ).rows[0];
    if (!row || (owner && row.userId !== owner)) return fail(404, "SUBSCRIPTION_NOT_FOUND");
    return normalized(row);
  }
  const access = createAccountAccess(auth);
  async function owner<T>(
    h: Headers,
    body: (c: PoolClient, id: string) => Promise<T>,
    mode: "read" | "write" = "write",
  ) {
    if (!h.get("X-AhiBizz-Account-ID")) return fail(401, "ACCOUNT_IDENTITY_CHANGED");
    const session = await access.session(h);
    return accountTransaction(pool, async (c) => {
      const user = await access.authority(c, session, false, mode);
      return body(c, user.id);
    });
  }
  async function ownBusiness(c: PoolClient, id: string, ownerId: string) {
    const b = (
      await c.query<{
        owner_user_id: string;
        status: string;
        title: string;
        alreadyCovered: boolean;
        located: boolean;
      }>(
        'SELECT owner_user_id,status,title,(latitude IS NOT NULL AND longitude IS NOT NULL) AS located,package_allows_listing(b) AS "alreadyCovered" FROM directory_business b WHERE id=$1 AND b.deleted_at IS NULL FOR UPDATE',
        [id],
      )
    ).rows[0];
    if (
      !b ||
      b.owner_user_id !== ownerId ||
      (environment === "sandbox" ? b.status !== "published" : b.status === "archived")
    )
      return fail(403, "BUSINESS_NOT_ELIGIBLE");
    return b;
  }
  async function chargeWalletPeriod(c: PoolClient, contract: SandboxRecord, cycle: number) {
    const creditMinor = Number(contract.cycleCreditMinor);
    const debitId = randomUUID();
    const covered = await c.query(
      `SELECT 1 FROM live_package_contract c JOIN billing_receipt r
      ON r.business_id=c.business_id AND r.kind='subscription' AND r.gross_minor>r.refunded_minor
      WHERE c.id=$1 AND r.service_ends_on >= ((coalesce(c.ends_at,now()) AT TIME ZONE 'Europe/Sarajevo')::date)
        AND r.service_starts_on < ((((coalesce(c.starts_at,now()) AT TIME ZONE 'UTC')+
          make_interval(months=>CASE WHEN c.period='annual' THEN 12 ELSE $2::int END)) AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Sarajevo')::date
      LIMIT 1`,
      [contract.id, cycle],
    );
    if (covered.rowCount) return fail(409, "PACKAGE_PERIOD_ALREADY_PAID");
    const updated = await c.query(
      `UPDATE live_package_contract SET starts_at=coalesce(starts_at,now()),
        ends_at=((coalesce(starts_at,now()) AT TIME ZONE 'UTC')+make_interval(months=>
          CASE WHEN period='annual' THEN 12 ELSE $2::int END)) AT TIME ZONE 'UTC',
        status=CASE WHEN total_cycles=$2 THEN 'EXPIRED' ELSE 'ACTIVE' END,paid_cycles=$2
        WHERE id=$1 AND payment_method='credits' AND paid_cycles=$2::int-1 AND (ends_at IS NULL OR ends_at<=now())`,
      [contract.id, cycle],
    );
    if (updated.rowCount !== 1) return fail(409, "PACKAGE_CYCLE_NOT_DUE");
    await debitWallet(c, {
      accountId: contract.userId,
      purchaseId: debitId,
      kind: "package",
      creditMinor,
    });
    await c.query(
      `INSERT INTO wallet_package_period(contract_id,account_id,cycle_number,credit_minor,debit_id)
       VALUES($1,$2,$3,$4,$5)`,
      [contract.id, contract.userId, cycle, creditMinor, debitId],
    );
  }
  async function snapshot(c: PoolClient, r: SandboxRecord, s: Snapshot) {
    if (!remoteStatuses.some((x) => x === s.status) || !Number.isFinite(Date.parse(s.updatedAt)))
      return fail(502, "SANDBOX_PROVIDER_MISMATCH");
    for (const p of s.payments) {
      if (
        p.amountEurMinor !== r.amountEurMinor ||
        !Number.isFinite(Date.parse(p.at)) ||
        !["COMPLETED", "REFUNDED", "REVERSED", "PARTIALLY_REFUNDED"].includes(p.status)
      )
        return fail(502, "SANDBOX_PAYMENT_MISMATCH");
      const write = await c.query(
        `INSERT INTO ${payments}(id,contract_id,amount_eur_minor,paid_at,status) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET status=CASE WHEN ${payments}.status IN ('REFUNDED','REVERSED') THEN ${payments}.status WHEN ${payments}.status='PARTIALLY_REFUNDED' AND EXCLUDED.status='COMPLETED' THEN ${payments}.status ELSE EXCLUDED.status END WHERE ${payments}.contract_id=EXCLUDED.contract_id AND ${payments}.paid_at=EXCLUDED.paid_at AND ${payments}.amount_eur_minor=EXCLUDED.amount_eur_minor`,
        [p.id, r.id, p.amountEurMinor, p.at, p.status],
      );
      if (write.rowCount !== 1) return fail(409, "SANDBOX_TRANSACTION_CONFLICT");
    }
    const terminal = r.status === "CANCELLED" || r.status === "EXPIRED";
    const newer =
      !r.providerUpdatedAt || Date.parse(s.updatedAt) >= Date.parse(r.providerUpdatedAt);
    const next = newer && !terminal ? s.status : r.status;
    const effectiveTime = terminal && r.providerUpdatedAt ? r.providerUpdatedAt : s.updatedAt;
    // Late evidence of an earlier sale is valid. A charge dated after cancellation is held for review.
    if (next === "CANCELLED")
      await c.query(
        `UPDATE ${payments} SET needs_review=true WHERE contract_id=$1 AND paid_at>$2::timestamptz`,
        [r.id, effectiveTime],
      );
    const verified = (
      await c.query<{
        n: number;
        throughCycle: number;
        first: string | null;
        last: string | null;
        total: number;
        observed: number;
      }>(
        `SELECT (count(*) FILTER (WHERE status='COMPLETED'))::int n,COALESCE(max(position) FILTER (WHERE status='COMPLETED'),0)::int AS "throughCycle",count(*)::int observed,min(paid_at)::text first,max(paid_at)::text last,coalesce(sum(amount_eur_minor) FILTER (WHERE status='COMPLETED'),0)::int total FROM (SELECT *,row_number() OVER (ORDER BY paid_at,id) AS position FROM ${payments} WHERE contract_id=$1) payment_period WHERE NOT needs_review`,
        [r.id],
      )
    ).rows[0];
    if (!verified || verified.observed > r.totalCycles)
      return fail(409, "SANDBOX_PAYMENT_MISMATCH");
    const start = verified.first === null ? null : (r.startsAt ?? s.startsAt ?? verified.first);
    const monthsPerCycle = r.period === "annual" ? 12 : 1;
    // PayPal can finish its final billing cycle before the sale ID is queryable.
    // A billing summary only prevents overlapping purchases; it never credits money or time.
    const unlistedLastPayment =
      s.lastPaymentAt &&
      (!verified.last || Date.parse(s.lastPaymentAt) > Date.parse(verified.last));
    const cycleHint =
      s.reportedCycles ||
      (unlistedLastPayment ? Math.min(verified.observed + 1, r.totalCycles) : 0);
    const reportedCycles = Math.max(r.reportedCycles ?? 0, cycleHint);
    const holdAnchor = s.lastPaymentAt ?? s.startsAt ?? r.startsAt ?? r.createdAt;
    const holdMonths = monthsPerCycle * (s.lastPaymentAt ? 1 : reportedCycles);
    await c.query(
      `UPDATE ${contracts} SET status=$2,provider_updated_at=GREATEST(provider_updated_at,$3::timestamptz),approval_url=CASE WHEN $2='APPROVAL_PENDING' THEN approval_url ELSE NULL END,paid_cycles=$4,paid_eur_minor=$5,starts_at=$6,
        ends_at=CASE WHEN $4::int>0 THEN (($6::timestamptz AT TIME ZONE 'UTC')+make_interval(months=>$7::int)) AT TIME ZONE 'UTC' ELSE NULL END,
        reported_cycles=$8,settlement_hold_until=CASE WHEN $9 THEN GREATEST(settlement_hold_until,(($10::timestamptz AT TIME ZONE 'UTC')+make_interval(months=>$11::int)) AT TIME ZONE 'UTC') ELSE NULL END WHERE id=$1`,
      [
        r.id,
        next,
        effectiveTime,
        verified.n,
        verified.total,
        start,
        verified.throughCycle * monthsPerCycle,
        reportedCycles,
        reportedCycles > verified.observed,
        holdAnchor,
        holdMonths,
      ],
    );
    return read(c, r.id);
  }
  async function refresh(h: Headers, id: string) {
    if (!provider) return fail(503, "SUBSCRIPTIONS_UNAVAILABLE");
    const before = await owner(h, (c, user) => read(c, id, user));
    if (!before.providerId) return { contract: dto(before) };
    const s = await provider.inspect(before);
    const after = await owner(h, async (c, user) => {
      const r = await read(c, id, user);
      if (r.providerId !== before.providerId) return fail(409, "SANDBOX_SUBSCRIPTION_CONFLICT");
      return snapshot(c, r, s);
    });
    return { contract: dto(after) };
  }
  return {
    async settlements(h: Headers, page: number, reviewOnly = false) {
      if (environment !== "live") return fail(404, "NOT_FOUND");
      if (!Number.isInteger(page) || page < 1 || page > 9999) return fail(400, "INVALID_REQUEST");
      if (!h.get("X-AhiBizz-Account-ID")) return fail(401, "ACCOUNT_IDENTITY_CHANGED");
      const session = await access.session(h);
      return accountTransaction(pool, async (c) => {
        await access.authority(c, session, true, "read");
        const { rows } = await c.query(
          `SELECT p.id,c.business_title AS "businessTitle",p.amount_eur_minor AS "amountEurMinor",
          p.paid_at AS "paidAt",p.status,p.needs_review AS "needsReview",r.id IS NOT NULL AS recorded
          FROM live_package_payment p JOIN live_package_contract c ON c.id=p.contract_id
          LEFT JOIN billing_receipt r ON r.source='paypal' AND r.external_reference=p.id
          WHERE NOT $2::boolean OR p.needs_review
          ORDER BY p.paid_at DESC,p.id DESC LIMIT 21 OFFSET $1`,
          [(page - 1) * 20, reviewOnly],
        );
        return { page, more: rows.length > 20, items: rows.slice(0, 20) };
      });
    },
    async list(h: Headers) {
      return owner(
        h,
        async (c, id) => ({
          actor: { id },
          ...(environment === "live" ? { walletBalance: await walletBalance(c, id) } : {}),
          contracts: (
            await c.query<SandboxRecord>(
              `SELECT ${columns} FROM ${contracts} WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100`,
              [id],
            )
          ).rows.map(dto),
        }),
        "read",
      );
    },
    async create(h: Headers, raw: unknown, wallet = false) {
      if (wallet && environment !== "live") return fail(404, "NOT_FOUND");
      if (!wallet && environment === "live" && readPlatformCreditsOnly())
        return fail(409, "PLATFORM_CREDITS_ONLY");
      if (!wallet && !provider) return fail(503, "SUBSCRIPTIONS_UNAVAILABLE");
      const v = validateStart(raw, wallet),
        quote = packageQuote(v.packageId, v.period),
        plan = plans[`${v.packageId}:${v.period}`];
      if (!quote || (!wallet && !plan)) return fail(503, "SANDBOX_SUBSCRIPTIONS_UNAVAILABLE");
      const r = await owner(h, async (c, uid) => {
        const b = await ownBusiness(c, v.businessId, uid);
        const byKey = (
          await c.query<SandboxRecord>(
            `SELECT ${columns} FROM ${contracts} WHERE user_id=$1 AND request_id=$2 FOR UPDATE`,
            [uid, v.requestId],
          )
        ).rows[0];
        if (byKey) {
          if (
            (byKey.paymentMethod === "credits") !== wallet ||
            (wallet && Number(byKey.cycleCreditMinor) !== v.expectedCreditMinor) ||
            byKey.businessId !== v.businessId ||
            byKey.packageId !== v.packageId ||
            byKey.period !== v.period ||
            (environment === "live" && byKey.benefitsVersion !== v.benefitsVersion)
          )
            return fail(409, "IDEMPOTENCY_CONFLICT");
          return normalized(byKey);
        }
        const open = (
          await c.query<SandboxRecord & { pendingSettlement: boolean }>(
            `SELECT ${columns},(settlement_hold_until>now()) AS "pendingSettlement" FROM ${contracts} WHERE business_id=$1 AND (status NOT IN ('CANCELLED','EXPIRED') OR ends_at>now() OR settlement_hold_until>now()) ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
            [v.businessId],
          )
        ).rows[0];
        if (open) {
          if (
            !wallet &&
            open.paymentMethod !== "credits" &&
            open.userId === uid &&
            open.packageId === v.packageId &&
            open.period === v.period &&
            (environment !== "live" || open.benefitsVersion === v.benefitsVersion) &&
            ["CREATING", "APPROVAL_PENDING"].includes(open.status)
          )
            return normalized(open);
          if (open.pendingSettlement && ["CANCELLED", "EXPIRED"].includes(open.status))
            return fail(409, "SUBSCRIPTION_SETTLEMENT_PENDING");
          return fail(409, "SUBSCRIPTION_ALREADY_EXISTS");
        }
        const schedule = environment === "live" ? await getPackageBenefits(c) : null;
        const benefits = schedule?.benefits[v.packageId];
        if (schedule?.version !== v.benefitsVersion) return fail(409, "PACKAGE_BENEFITS_CHANGED");
        if (benefits && !benefits.enabled) return fail(409, "PACKAGE_NOT_AVAILABLE");
        if (benefits && benefits.nearbyDays > 0 && !b.located)
          return fail(409, "PACKAGE_LOCATION_REQUIRED");
        if (
          benefits &&
          benefits.nearbyDays === 0 &&
          benefits.featuredDays === 0 &&
          b.alreadyCovered
        )
          return fail(409, "BUSINESS_ALREADY_COVERED");
        const rate = wallet ? await readWalletRate(c) : null;
        const cycleCreditMinor = rate ? creditsForBamMinor(quote.amountBamMinor, rate) : null;
        if (wallet && (!cycleCreditMinor || cycleCreditMinor !== v.expectedCreditMinor))
          return fail(409, "WALLET_PAYMENT_CHANGED");
        const inserted = (
          await c.query<SandboxRecord>(
            `INSERT INTO ${contracts}(id,user_id,business_id,business_title,request_id,package_id,period,amount_bam_minor,amount_eur_minor,total_cycles,plan_id,status${schedule ? ",benefits_version,nearby_days,featured_days,payment_method,cycle_credit_minor" : ""}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'CREATING'${schedule ? ",$12,$13,$14,$15,$16" : ""}) RETURNING ${columns}`,
            [
              randomUUID(),
              uid,
              v.businessId,
              b.title,
              v.requestId,
              v.packageId,
              v.period,
              quote.amountBamMinor,
              quote.amountEurMinor,
              quote.totalCycles,
              wallet ? null : plan,
              ...(schedule && benefits
                ? [
                    schedule.version,
                    benefits.nearbyDays,
                    benefits.featuredDays,
                    wallet ? "credits" : "paypal",
                    cycleCreditMinor,
                  ]
                : []),
            ],
          )
        ).rows[0];
        if (!inserted) return fail(503, "SANDBOX_SUBSCRIPTIONS_UNAVAILABLE");
        if (wallet) {
          await chargeWalletPeriod(c, inserted, 1);
          return read(c, inserted.id, uid);
        }
        return normalized(inserted);
      });
      if (wallet || r.status !== "CREATING") return approval(r);
      if (!provider) return fail(503, "SUBSCRIPTIONS_UNAVAILABLE");
      // PayPal stores the subscription create request key for 72 hours.
      // Allow time for the final network call before its deduplication window ends.
      if (Date.now() - Date.parse(r.createdAt) >= (72 * 60 - 1) * 60000)
        return fail(409, "SUBSCRIPTION_REQUIRES_REVIEW");
      const created = await provider.create(r);
      if (
        !/^I-[A-Z0-9]{5,32}$/.test(created.id) ||
        !remoteStatuses.some((s) => s === created.status)
      )
        return fail(502, "SANDBOX_PROVIDER_MISMATCH");
      const approvalUrl =
        created.status === "APPROVAL_PENDING"
          ? subscriptionApproval(created.approvalUrl, environment)
          : null;
      const terminalSnapshot =
        created.status === "EXPIRED" || created.status === "CANCELLED"
          ? await provider.inspect({ ...r, providerId: created.id })
          : null;
      const result = await owner(h, async (c, uid) => {
        await ownBusiness(c, r.businessId, uid);
        const row = await read(c, r.id, uid);
        if (row.providerId && row.providerId !== created.id)
          return fail(409, "SANDBOX_SUBSCRIPTION_CONFLICT");
        if (!row.providerId)
          await c.query(
            `UPDATE ${contracts} SET provider_id=$2, status=$3, approval_url=$4 WHERE id=$1`,
            [r.id, created.id, created.status, approvalUrl],
          );
        const bound = await read(c, r.id, uid);
        return terminalSnapshot ? snapshot(c, bound, terminalSnapshot) : bound;
      });
      return approval(result);
    },
    async payCreditCycle(h: Headers, id: string, input: unknown) {
      if (environment !== "live") return fail(404, "NOT_FOUND");
      if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        Object.keys(input).length !== 2 ||
        !("cycle" in input) ||
        !("expectedCreditMinor" in input) ||
        typeof input.cycle !== "number" ||
        !Number.isInteger(input.cycle) ||
        input.cycle < 1 ||
        input.cycle > 12
      )
        return fail(400, "INVALID_SUBSCRIPTION_INPUT");
      const cycle = input.cycle;
      return owner(h, async (c, uid) => {
        const target = (
          await c.query<{ business_id: string }>(
            "SELECT business_id FROM live_package_contract WHERE id=$1 AND user_id=$2",
            [uuid(id), uid],
          )
        ).rows[0];
        if (!target) return fail(404, "SUBSCRIPTION_NOT_FOUND");
        await ownBusiness(c, target.business_id, uid);
        const contract = await read(c, id, uid);
        if (
          contract.paymentMethod !== "credits" ||
          Number(contract.cycleCreditMinor) !== input.expectedCreditMinor
        )
          return fail(409, "WALLET_PAYMENT_CHANGED");
        if (cycle <= contract.paidCycles) return { contract: dto(contract) };
        if (
          contract.status !== "ACTIVE" ||
          contract.period !== "monthly" ||
          cycle !== contract.paidCycles + 1
        )
          return fail(409, "PACKAGE_CYCLE_NOT_DUE");
        await chargeWalletPeriod(c, contract, cycle);
        return { contract: dto(await read(c, id, uid)) };
      });
    },
    refresh,
    async cancel(h: Headers, id: string, unpaidOnly = false) {
      if (!provider) return fail(503, "SUBSCRIPTIONS_UNAVAILABLE");
      const r = await owner(h, (c, u) => read(c, id, u));
      if (!r.providerId) return fail(409, "SUBSCRIPTION_REQUIRES_REVIEW");
      if (r.status === "CANCELLED" || r.status === "EXPIRED") return refresh(h, id);
      if (
        unpaidOnly &&
        (environment !== "live" ||
          !readPlatformCreditsOnly() ||
          r.paymentMethod !== "paypal" ||
          r.status !== "APPROVAL_PENDING" ||
          r.paidCycles > 0 ||
          (r.reportedCycles ?? 0) > 0)
      )
        return fail(409, "SUBSCRIPTION_PENDING_CHANGED");
      await provider.cancel(r, unpaidOnly);
      const current = await refresh(h, id);
      if (unpaidOnly && !["CANCELLED", "EXPIRED"].includes(current.contract.status))
        return fail(409, "SUBSCRIPTION_PENDING_CHANGED");
      return current;
    },
    async webhook(h: Headers, event: unknown, raw: string) {
      if (!provider) return fail(503, "SUBSCRIPTIONS_UNAVAILABLE");
      if (!(await provider.verifyWebhook(h, event, raw))) return fail(403, "INVALID_WEBHOOK");
      const e = event as { event_type?: unknown; resource?: Record<string, unknown> };
      if (typeof e?.event_type !== "string" || !e.resource) return { ignored: true };
      let id = e.event_type.startsWith("BILLING.SUBSCRIPTION.")
        ? e.resource.id
        : e.event_type.startsWith("PAYMENT.SALE.")
          ? e.resource.billing_agreement_id
          : null;
      if (!id && ["PAYMENT.SALE.REFUNDED", "PAYMENT.SALE.REVERSED"].includes(e.event_type)) {
        const saleId = e.resource.sale_id ?? e.resource.id;
        if (typeof saleId === "string" && /^[a-z0-9-]{5,64}$/i.test(saleId)) {
          id = (
            await pool.query<{ provider_id: string }>(
              `SELECT c.provider_id FROM ${payments} p JOIN ${contracts} c ON c.id=p.contract_id WHERE p.id=$1`,
              [saleId],
            )
          ).rows[0]?.provider_id;
        }
      }
      if (typeof id !== "string" || !/^I-[A-Z0-9]{5,32}$/.test(id)) return { ignored: true };
      const row = (
        await pool.query<SandboxRecord>(
          `SELECT ${columns} FROM ${contracts} WHERE provider_id=$1`,
          [id],
        )
      ).rows[0];
      if (!row) return { ignored: true };
      const s = await provider.inspect(normalized(row));
      await accountTransaction(pool, async (c) => snapshot(c, await read(c, row.id), s));
      return { processed: true };
    },
  };
}

export const createSandboxSubscriptions = createPackageSubscriptions;
