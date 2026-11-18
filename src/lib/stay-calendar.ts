import { addDays } from "./booking-time";

// The availability API takes an exclusive upper date in a four-digit ISO year.
export const lastStayDate = "9999-12-31";
export const lastArrivalDate = "9999-12-30";
export function stayCalendarMonth(month: string) {
  const first = `${month}-01`;
  const date = new Date(`${first}T12:00:00Z`);
  const weekdayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCMonth(date.getUTCMonth() + 1);
  const next = month === "9999-12" ? null : date.toISOString().slice(0, 7);
  date.setUTCMonth(date.getUTCMonth() - 2);
  const previous = month === "0001-01" ? null : date.toISOString().slice(0, 7);
  const end = next ? `${next}-01` : lastStayDate;
  const days = next ? Number(addDays(end, -1).slice(8)) : 31;
  return { first, end, next, previous, days, weekdayOffset };
}
