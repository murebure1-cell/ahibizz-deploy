import type { Pool, PoolClient } from "pg";
import { type ExportPart, exportParts } from "../lib/account-export";
import { AccountAccessError, accountTransaction, createAccountAccess } from "./auth/accounts";
import type { AuthService } from "./auth/service";

type Query = Pick<PoolClient, "query">;
const limit = 20000;

const readers: Record<ExportPart, (client: Query, user: string) => Promise<unknown>> = {
  async profile(client, user) {
    return (
      await client.query(
        `SELECT u.name,u.email,u."createdAt" AS "accountCreatedAt",
          p.city,p.country_code AS "countryCode",p.bio,p.skills,p.work_status AS "workStatus",
          p.birth_date::text AS "birthDate",p.is_public AS "publicProfile",
          ap.locale,ap.appearance,ap.show_city AS "showCity",ap.show_friend_count AS "showFriendCount",
          ap.push_messages AS "pushMessages",ap.push_bookings AS "pushBookings",ap.push_reels AS "pushReels"
         FROM auth_user u LEFT JOIN personal_profile p ON p.user_id=u.id
         LEFT JOIN auth_account_preferences ap ON ap.user_id=u.id WHERE u.id=$1`,
        [user],
      )
    ).rows[0];
  },
  async businesses(client, user) {
    return (
      await client.query(
        `SELECT id,title,description,contact_email AS "contactEmail",contact_phone AS "contactPhone",
          website_url AS "website",address_line AS "address",city,country_code AS "countryCode",status,
          created_at AS "createdAt",published_at AS "publishedAt"
         FROM directory_business WHERE owner_user_id=$1 ORDER BY created_at LIMIT ${limit}`,
        [user],
      )
    ).rows;
  },
  async messages(client, user) {
    return (
      await client.query(
        `SELECT m.thread_id AS "conversation",m.sender_user_id=$1 AS "sentByMe",m.body,m.created_at AS "at"
         FROM message_message m JOIN message_thread_member member ON member.thread_id=m.thread_id AND member.user_id=$1
         ORDER BY m.thread_id,m.sequence LIMIT ${limit}`,
        [user],
      )
    ).rows;
  },
  async bookings(client, user) {
    const [services, rentals, stays] = await Promise.all([
      client.query(
        `SELECT business_title AS "business",service_name AS "service",starts_at AS "startsAt",ends_at AS "endsAt",
          status,price_minor AS "priceMinor",currency,created_at AS "createdAt"
         FROM booking_entry WHERE customer_user_id=$1 ORDER BY starts_at LIMIT ${limit}`,
        [user],
      ),
      client.query(
        `SELECT business_title AS "business",vehicle_name AS "vehicle",starts_at AS "startsAt",ends_at AS "endsAt",
          status,total_minor AS "totalMinor"
         FROM rental_booking WHERE customer_id=$1 AND kind='customer' ORDER BY starts_at LIMIT ${limit}`,
        [user],
      ),
      client.query(
        `SELECT business_title AS "business",unit_name AS "unit",check_in::text AS "checkIn",check_out::text AS "checkOut",
          status,total_minor AS "totalMinor"
         FROM stay_booking WHERE customer_id=$1 AND kind='customer' ORDER BY check_in LIMIT ${limit}`,
        [user],
      ),
    ]);
    return { services: services.rows, rentals: rentals.rows, stays: stays.rows };
  },
  async reviews(client, user) {
    return (
      await client.query(
        `SELECT b.title AS "business",r.rating,r.body,r.withdrawn,r.created_at AS "createdAt",r.updated_at AS "updatedAt"
         FROM business_review r JOIN directory_business b ON b.id=r.business_id
         WHERE r.author_user_id=$1 ORDER BY r.created_at LIMIT ${limit}`,
        [user],
      )
    ).rows;
  },
  async reels(client, user) {
    return (
      await client.query(
        `SELECT title,caption,status,created_at AS "createdAt",published_at AS "publishedAt"
         FROM business_reel WHERE submitted_by=$1 ORDER BY created_at LIMIT ${limit}`,
        [user],
      )
    ).rows;
  },
};

/** "dijelovi=profil,poruke" into known parts, each once, at least one. */
export function readExportParts(value: string | null): ExportPart[] {
  const names = value?.split(",") ?? [];
  const parts = names.map((name) => exportParts.find((part) => part.query === name)?.id);
  if (names.length === 0 || parts.some((part) => !part) || new Set(parts).size !== parts.length)
    throw new AccountAccessError(400, "INVALID_EXPORT_PARTS");
  return parts as ExportPart[];
}

export function createAccountExportService(auth: AuthService, pool: Pool) {
  const access = createAccountAccess(auth);
  return {
    async export(headers: Headers, parts: ExportPart[]) {
      const current = await access.session(headers);
      return accountTransaction(pool, async (client) => {
        const actor = await access.authority(client, current, false, "read");
        const result: Record<string, unknown> = {
          about: "AhiBizz — podaci tvog naloga",
          exportedAt: new Date().toISOString(),
        };
        for (const part of parts) result[part] = await readers[part](client, actor.id);
        return result;
      });
    },
  };
}
