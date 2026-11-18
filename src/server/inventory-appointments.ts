import type { PoolClient, QueryResultRow } from "pg";
import type { BookingListView } from "../lib/booking";

export type InventorySelection = { page: number; view?: BookingListView };

export function inventorySelection(
  query: URLSearchParams,
  invalid: () => never,
): InventorySelection {
  const raw = query.get("page") ?? "1";
  const view = query.get("view");
  if (
    [...query.keys()].some((key) => key !== "page" && key !== "view") ||
    query.getAll("page").length > 1 ||
    query.getAll("view").length > 1 ||
    !/^[1-9]\d{0,6}$/.test(raw) ||
    (view !== null && view !== "upcoming" && view !== "history")
  )
    return invalid();
  return { page: Number(raw), view: view ?? undefined };
}

export async function inventoryAppointments<Row extends QueryResultRow, Entry>(
  client: PoolClient,
  customer: string,
  kind: "rental" | "stay",
  selection: InventorySelection,
  asOf: Date,
  columns: string,
  toEntry: (row: Row) => Entry,
) {
  const { page, view } = selection;
  const rental = kind === "rental";
  const table = rental ? "rental_booking" : "stay_booking";
  const start = rental ? "starts_at" : "check_in";
  const activeEnd = rental
    ? "ends_at > $3::timestamptz"
    : "check_out > ($3::timestamptz AT TIME ZONE timezone)::date";
  const active = `(status IN ('requested','confirmed') AND ${activeEnd})`;
  const filter =
    view === "upcoming" ? `AND ${active}` : view === "history" ? `AND NOT ${active}` : "";
  const sort = view === "upcoming" ? "ASC" : "DESC";
  const offset = (page - 1) * 20;
  const result = await client.query<Row>(
    `SELECT ${columns} FROM ${table} WHERE customer_id=$1 ${filter}
     ORDER BY ${start} ${sort}, id ${sort} LIMIT 21 OFFSET $2`,
    view ? [customer, offset, asOf] : [customer, offset],
  );
  return {
    entries: result.rows.slice(0, 20).map(toEntry),
    page,
    view,
    hasMore: result.rows.length > 20,
  };
}
