import type { PoolClient } from "pg";
import type {
  BusinessAgenda,
  BusinessChoice,
  BusinessTodayData,
  CalendarKind,
} from "../lib/business-today";

type Business = BusinessChoice & {
  serviceZone: string;
  inventoryZone: string;
  service: boolean;
  rental: boolean;
  stay: boolean;
};

export async function readBusinessToday(
  client: PoolClient,
  accountId: string,
  requestedId: string | null,
  instant = new Date(),
): Promise<BusinessTodayData | null> {
  const choices = await client.query<BusinessChoice>(
    `SELECT id,title FROM directory_business WHERE owner_user_id=$1 AND status<>'archived'
     ORDER BY (status='published') DESC, lower(title), id`,
    [accountId],
  );
  const result: BusinessTodayData = {
    accountId,
    businesses: choices.rows,
    selectedId: null,
    agendas: [],
    inquiries: { count: 0, threadId: null },
  };
  const selected = requestedId ?? choices.rows[0]?.id;
  if (!selected) return result;
  // The ownership lock covers all subsequent private schedule and inbox reads.
  const selectedRows = await client.query<Business>(
    `SELECT b.id,b.title,coalesce(bs.timezone,'Europe/Sarajevo') AS "serviceZone",
     coalesce(d.timezone,bs.timezone,'Europe/Sarajevo') AS "inventoryZone",
     coalesce(bs.enabled,false) AS service,
     (c.vehicle_rental OR coalesce(sc.vehicle_rental,false) OR EXISTS
       (SELECT 1 FROM rental_vehicle WHERE business_id=b.id)) AS rental,
     (c.accommodation OR coalesce(sc.accommodation,false) OR EXISTS
       (SELECT 1 FROM stay_unit WHERE business_id=b.id)) AS stay
     FROM directory_business b JOIN directory_category c ON c.id=b.category_id
     LEFT JOIN directory_category sc ON sc.id=b.subcategory_id
     LEFT JOIN directory_business_details d ON d.business_id=b.id
     LEFT JOIN booking_settings bs ON bs.business_id=b.id
     WHERE b.id=$1 AND b.owner_user_id=$2 AND b.status<>'archived' FOR SHARE OF b`,
    [selected, accountId],
  );
  const business = selectedRows.rows[0];
  if (!business) return null;
  result.selectedId = business.id;
  const clock = instant.toISOString();
  // Each calendar has a civil day in its own time zone; the next midnight can be 23 or 25 hours away.
  const schedule = await client.query<BusinessAgenda>(
    `WITH days AS (
      SELECT ($2::timestamptz AT TIME ZONE $3)::date AS service_day,
             ($2::timestamptz AT TIME ZONE $4)::date AS inventory_day
    ), entries AS (
      SELECT 'service' AS kind,e.id,e.service_name AS name,e.status,e.starts_at AS sort,
        to_char(e.starts_at AT TIME ZONE $3,'HH24:MI') AS time,
        e.starts_at < ((service_day+1)::timestamp AT TIME ZONE $3) AND
        e.ends_at > (service_day::timestamp AT TIME ZONE $3) AS today,
        e.status='requested' AND e.starts_at>$2::timestamptz AS pending,
        to_char(e.starts_at AT TIME ZONE $3,'YYYY-MM-DD') AS day
      FROM booking_entry e CROSS JOIN days WHERE e.business_id=$1 AND e.kind<>'block'
        AND e.status IN ('confirmed','requested','completed')
        AND e.ends_at > (service_day::timestamp AT TIME ZONE $3)
        AND (e.status='requested' OR e.starts_at < ((service_day+1)::timestamp AT TIME ZONE $3))
      UNION ALL
      SELECT 'rental',r.id,r.vehicle_name,r.status,r.starts_at,
        to_char(r.starts_at AT TIME ZONE $4,'DD.MM. HH24:MI')||' – '||to_char(r.ends_at AT TIME ZONE $4,'DD.MM. HH24:MI'),
        r.starts_at < ((inventory_day+1)::timestamp AT TIME ZONE $4) AND r.ends_at > (inventory_day::timestamp AT TIME ZONE $4),
        r.status='requested' AND r.starts_at>$2::timestamptz,NULL
      FROM rental_booking r CROSS JOIN days WHERE r.business_id=$1 AND r.kind='customer'
        AND r.status IN ('confirmed','requested') AND r.ends_at > (inventory_day::timestamp AT TIME ZONE $4)
        AND (r.status='requested' OR r.starts_at < ((inventory_day+1)::timestamp AT TIME ZONE $4))
      UNION ALL
      SELECT 'stay',s.id,s.unit_name,s.status,s.check_in::timestamp AT TIME ZONE $4,
        CASE WHEN s.check_out=inventory_day THEN 'Odlazak' WHEN s.check_in=inventory_day THEN 'Dolazak' ELSE 'Boravak' END,
        s.check_in<=inventory_day AND s.check_out>=inventory_day,
        s.status='requested' AND s.check_in>=($2::timestamptz AT TIME ZONE s.timezone)::date,NULL
      FROM stay_booking s CROSS JOIN days WHERE s.business_id=$1 AND s.kind='customer'
        AND s.status IN ('confirmed','requested') AND s.check_out>=inventory_day
        AND (s.status='requested' OR s.check_in<=inventory_day)
    ), ranked AS (
      SELECT *,row_number() OVER (PARTITION BY kind,today ORDER BY sort,id) AS position FROM entries
    )
    SELECT kind,count(*) FILTER (WHERE today)::int AS total,count(*) FILTER (WHERE pending)::int AS pending,
      min(day) FILTER (WHERE pending) AS "pendingDay",
      coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'time',time,'status',status)
        ORDER BY sort,id) FILTER (WHERE today AND position<=4),'[]'::jsonb) AS entries
    FROM ranked GROUP BY kind`,
    [selected, clock, business.serviceZone, business.inventoryZone],
  );
  const kinds: CalendarKind[] = ["service", "rental", "stay"];
  result.agendas = kinds.flatMap((kind) => {
    const row = schedule.rows.find((item) => item.kind === kind);
    const visible =
      business[kind] ||
      Boolean(row?.total || row?.pending) ||
      (kind === "service" && !business.rental && !business.stay);
    return visible ? [row ?? { kind, total: 0, pending: 0, pendingDay: null, entries: [] }] : [];
  });
  const inquiries = await client.query<{ count: number; threadId: string }>(
    `SELECT count(*) OVER ()::int AS count,t.id AS "threadId" FROM message_thread t
     JOIN message_thread_member own ON own.thread_id=t.id AND own.user_id=$2
     WHERE t.kind='business' AND t.business_id=$1 AND t.right_user_id=$2 AND t.latest_sequence>own.read_sequence
       AND EXISTS (SELECT 1 FROM message_message m WHERE m.thread_id=t.id AND m.sequence>own.read_sequence AND m.sender_user_id<>$2)
     ORDER BY t.updated_at DESC,t.id LIMIT 1`,
    [selected, accountId],
  );
  result.inquiries = inquiries.rows[0] ?? result.inquiries;
  return result;
}
