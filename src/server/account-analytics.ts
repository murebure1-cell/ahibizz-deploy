import type { Pool, PoolClient } from "pg";
import {
  type AccountAnalytics,
  type AnalyticsPeriod,
  type AnalyticsSource,
  type AnalyticsTouch,
  analyticsPeriods,
} from "../lib/account-analytics";
import { isPackageId, type PackageId } from "../lib/packages";
import { AccountAccessError, accountTransaction, createAccountAccess } from "./auth/accounts";
import type { AuthService } from "./auth/service";

type Query = Pick<PoolClient, "query">;
const today = "(clock_timestamp() AT TIME ZONE 'Europe/Sarajevo')::date";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AnalyticsInput = { business: string | null; days: AnalyticsPeriod; csv: boolean };

/** "?djelatnost=…&dana=7|30|90&izvoz=csv", each at most once. */
export function readAnalyticsInput(params: URLSearchParams): AnalyticsInput {
  const keys = [...params.keys()];
  if (
    keys.some((key) => !["djelatnost", "dana", "izvoz"].includes(key)) ||
    new Set(keys).size !== keys.length
  )
    throw new AccountAccessError(400, "INVALID_ANALYTICS_QUERY");
  const business = params.get("djelatnost");
  const days = Number(params.get("dana") ?? 30);
  const csv = params.get("izvoz");
  if (
    (business !== null && !uuid.test(business)) ||
    !analyticsPeriods.includes(days as AnalyticsPeriod) ||
    (csv !== null && csv !== "csv")
  )
    throw new AccountAccessError(400, "INVALID_ANALYTICS_QUERY");
  return {
    business: business?.toLowerCase() ?? null,
    days: days as AnalyticsPeriod,
    csv: csv === "csv",
  };
}

/** The same rule as "Moj profil": founder shows Business, the administrator sees everything. */
async function accountPackage(client: Query, user: string): Promise<PackageId | null> {
  const row = (
    await client.query<{ role: string; founder: boolean; held: string }>(
      `SELECT u.role,u.founder,COALESCE((SELECT package FROM account_package p WHERE p.user_id=u.id),'basic') AS held
       FROM auth_user u WHERE u.id=$1`,
      [user],
    )
  ).rows[0];
  if (!row) throw new AccountAccessError(404, "ACCOUNT_NOT_FOUND");
  if (row.founder) return "business";
  if (row.role !== "member") return null;
  return isPackageId(row.held) ? row.held : "basic";
}

const sum = (rows: { value: number | string | null }[]) => Number(rows[0]?.value ?? 0);

export async function readAnalytics(
  client: Query,
  user: string,
  input: AnalyticsInput,
): Promise<AccountAnalytics> {
  const pack = await accountPackage(client, user);
  const businesses = (
    await client.query<{ id: string; title: string }>(
      `SELECT id,title FROM directory_business WHERE owner_user_id=$1 AND deleted_at IS NULL
       AND status<>'archived' ORDER BY (status='published') DESC, updated_at DESC, id LIMIT 50`,
      [user],
    )
  ).rows;
  if (input.business && !businesses.some((item) => item.id === input.business))
    throw new AccountAccessError(404, "BUSINESS_NOT_FOUND");
  const ids = input.business ? [input.business] : businesses.map((item) => item.id);
  const days = input.days;
  const window = (column: string, offset: number) =>
    `${column} > ${today} - ${days * (offset + 1)} AND ${column} <= ${today} - ${days * offset}`;
  const profile = async (offset: number) =>
    sum(
      (
        await client.query<{ value: number }>(
          `SELECT COALESCE(sum(views),0)::integer AS value FROM profile_view_day WHERE user_id=$1 AND ${window("day", offset)}`,
          [user],
        )
      ).rows,
    );
  const views = async (offset: number) =>
    sum(
      (
        await client.query<{ value: number }>(
          `SELECT COALESCE(sum(views),0)::integer AS value FROM business_view_day WHERE business_id=ANY($1::uuid[]) AND ${window("day", offset)}`,
          [ids],
        )
      ).rows,
    );
  const touchTotal = async (offset: number) =>
    sum(
      (
        await client.query<{ value: number }>(
          `SELECT COALESCE(sum(touches),0)::integer AS value FROM business_touch_day WHERE business_id=ANY($1::uuid[]) AND ${window("day", offset)}`,
          [ids],
        )
      ).rows,
    );
  const full = pack === null || pack === "business";
  const detailed = full || pack === "startup";
  const result: AccountAnalytics = {
    package: pack,
    businesses,
    business: input.business,
    days,
    profileViews: await profile(0),
    businessViews: await views(0),
    previous: null,
    daily: null,
    touches: null,
    sources: null,
    peak: null,
  };
  if (detailed) {
    // Fourteen days, as drawn: last week, then this one.
    result.daily = (
      await client.query<{ day: string; views: number }>(
        `SELECT to_char(d.day,'YYYY-MM-DD') AS day, COALESCE(sum(v.views),0)::integer AS views
         FROM generate_series(${today} - 13, ${today}, interval '1 day') AS d(day)
         LEFT JOIN business_view_day v ON v.day=d.day::date AND v.business_id=ANY($1::uuid[])
         GROUP BY d.day ORDER BY d.day`,
        [ids],
      )
    ).rows;
    const touches: Record<AnalyticsTouch, number> = { call: 0, message: 0, map: 0 };
    for (const row of (
      await client.query<{ kind: AnalyticsTouch; value: number }>(
        `SELECT kind, sum(touches)::integer AS value FROM business_touch_day
         WHERE business_id=ANY($1::uuid[]) AND ${window("day", 0)} GROUP BY kind`,
        [ids],
      )
    ).rows)
      touches[row.kind] = row.value;
    result.touches = touches;
    const sources: Record<AnalyticsSource, number> = { search: 0, category: 0, map: 0, other: 0 };
    for (const row of (
      await client.query<{ source: AnalyticsSource; value: number }>(
        `SELECT source, sum(views)::integer AS value FROM business_source_day
         WHERE business_id=ANY($1::uuid[]) AND ${window("day", 0)} GROUP BY source`,
        [ids],
      )
    ).rows)
      sources[row.source] = row.value;
    result.sources = sources;
  }
  if (full) {
    result.previous = {
      profileViews: await profile(1),
      businessViews: await views(1),
      touches: await touchTotal(1),
    };
    const peak = (
      await client.query<{ weekday: number; hour: number }>(
        `SELECT extract(isodow FROM day)::integer AS weekday, hour, sum(views)::integer AS total
         FROM business_view_hour WHERE business_id=ANY($1::uuid[]) AND ${window("day", 0)}
         GROUP BY 1,2 ORDER BY total DESC, 1, 2 LIMIT 1`,
        [ids],
      )
    ).rows[0];
    result.peak = peak ? { weekday: peak.weekday, hour: peak.hour } : null;
  }
  return result;
}

/** One line per day of the period for the chosen business(es): day, views, calls, messages, map. */
export async function readAnalyticsCsv(client: Query, user: string, input: AnalyticsInput) {
  const facts = await readAnalytics(client, user, input);
  if (!(facts.package === null || facts.package === "business"))
    throw new AccountAccessError(403, "PACKAGE_REQUIRED");
  const ids = input.business ? [input.business] : facts.businesses.map((item) => item.id);
  const rows = (
    await client.query<{ day: string; views: number; call: number; message: number; map: number }>(
      `SELECT to_char(d.day,'YYYY-MM-DD') AS day,
         COALESCE((SELECT sum(views) FROM business_view_day v WHERE v.day=d.day::date AND v.business_id=ANY($1::uuid[])),0)::integer AS views,
         COALESCE((SELECT sum(touches) FROM business_touch_day t WHERE t.day=d.day::date AND t.kind='call' AND t.business_id=ANY($1::uuid[])),0)::integer AS call,
         COALESCE((SELECT sum(touches) FROM business_touch_day t WHERE t.day=d.day::date AND t.kind='message' AND t.business_id=ANY($1::uuid[])),0)::integer AS message,
         COALESCE((SELECT sum(touches) FROM business_touch_day t WHERE t.day=d.day::date AND t.kind='map' AND t.business_id=ANY($1::uuid[])),0)::integer AS map
       FROM generate_series(${today} - ${input.days - 1}, ${today}, interval '1 day') AS d(day) ORDER BY d.day`,
      [ids],
    )
  ).rows;
  return [
    "dan,pregledi,pozivi,poruke,mapa",
    ...rows.map((row) => `${row.day},${row.views},${row.call},${row.message},${row.map}`),
  ].join("\n");
}

export function createAccountAnalyticsService(auth: AuthService, pool: Pool) {
  const access = createAccountAccess(auth);
  return {
    async read(headers: Headers, input: AnalyticsInput) {
      const current = await access.session(headers);
      return accountTransaction(pool, async (client) => {
        const actor = await access.authority(client, current, false, "read");
        return input.csv
          ? readAnalyticsCsv(client, actor.id, input)
          : readAnalytics(client, actor.id, input);
      });
    },
  };
}
