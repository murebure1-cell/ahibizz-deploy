import type { PoolClient } from "pg";
import type { NextAppointment } from "../lib/next-appointment";

/** A stay on its arrival date is upcoming until that local day ends. */
export async function readNextAppointment(
  client: PoolClient,
  customerId: string,
  at?: Date,
): Promise<NextAppointment | null> {
  const result = await client.query<NextAppointment>(
    `WITH clock AS (SELECT COALESCE($2::timestamptz, now()) AS at), upcoming AS (
      (SELECT e.id,'service' AS kind,e.status,e.service_name AS name,e.business_title AS "businessTitle",
        to_char(e.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "startsAt",
        to_char(e.ends_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "endsAt",e.timezone,e.starts_at AS moment
       FROM booking_entry e, clock WHERE e.customer_user_id=$1 AND e.kind='customer' AND e.status IN ('requested','confirmed')
         AND e.starts_at>=clock.at ORDER BY e.starts_at,e.id LIMIT 1)
      UNION ALL
      (SELECT r.id,'rental',r.status,r.vehicle_name,r.business_title,
        to_char(r.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        to_char(r.ends_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),r.timezone,r.starts_at
       FROM rental_booking r, clock WHERE r.customer_id=$1 AND r.kind='customer' AND r.status IN ('requested','confirmed')
         AND r.starts_at>=clock.at ORDER BY r.starts_at,r.id LIMIT 1)
      UNION ALL
      (SELECT s.id,'stay',s.status,s.unit_name,s.business_title,to_char(s.check_in,'YYYY-MM-DD'),to_char(s.check_out,'YYYY-MM-DD'),
        s.timezone,s.check_in::timestamp AT TIME ZONE s.timezone AS moment
       FROM stay_booking s, clock WHERE s.customer_id=$1 AND s.kind='customer' AND s.status IN ('requested','confirmed')
         AND s.check_in>=(clock.at AT TIME ZONE s.timezone)::date ORDER BY moment,s.id LIMIT 1)
    ) SELECT id,kind,status,name,"businessTitle","startsAt","endsAt",timezone FROM upcoming ORDER BY moment,id LIMIT 1`,
    [customerId, at ?? null],
  );
  return result.rows[0] ?? null;
}
