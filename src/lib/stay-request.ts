import { lastArrivalDate } from "./stay-calendar";
import type { StayInterval } from "./stays";

/** What a visitor has picked so far, and which end the next tap on a day sets. */
export type StayChoice = { arrival: string; departure: string; choosingEnd: boolean };

export const noStayChoice: StayChoice = { arrival: "", departure: "", choosingEnd: false };

/** Whether the night that begins on `day` is taken. Calendar days are written as YYYY-MM-DD. */
export function stayNightTaken(entries: readonly StayInterval[], day: string): boolean {
  return entries.some((entry) => entry.checkIn <= day && entry.checkOut > day);
}

/** Whether every night from arrival to the night before departure is free, as far as is known. */
export function stayRangeFree(
  entries: readonly StayInterval[],
  arrival: string,
  departure: string,
): boolean {
  return !entries.some((entry) => entry.checkIn < departure && entry.checkOut > arrival);
}

/** Whether `day` can close a stay that began on the chosen arrival. */
function closes(entries: readonly StayInterval[], choice: StayChoice, day: string): boolean {
  return Boolean(
    choice.choosingEnd &&
      choice.arrival &&
      day > choice.arrival &&
      stayRangeFree(entries, choice.arrival, day),
  );
}

/**
 * A tap on a day. While a departure is awaited, a day that closes a free stretch becomes the
 * departure; any other free day starts a new stay there. A day before today, or a taken night
 * that cannot close the stay, changes nothing.
 */
export function stayChoose(
  choice: StayChoice,
  day: string,
  entries: readonly StayInterval[],
  today: string,
): StayChoice {
  if (day < today) return choice;
  if (closes(entries, choice, day)) return { ...choice, departure: day, choosingEnd: false };
  if (stayNightTaken(entries, day) || day > lastArrivalDate) return choice;
  return { arrival: day, departure: "", choosingEnd: true };
}

/**
 * How a day of the calendar stands. A taken night is struck out and cannot be chosen, except
 * as the morning a stay ends: the guest leaves before the next one arrives.
 */
export function stayDay(
  choice: StayChoice,
  day: string,
  entries: readonly StayInterval[],
  today: string,
) {
  const taken = stayNightTaken(entries, day);
  const role =
    day === choice.arrival
      ? "arrival"
      : day === choice.departure
        ? "departure"
        : choice.arrival && choice.departure && day > choice.arrival && day < choice.departure
          ? "between"
          : null;
  return { taken, role, disabled: day < today || (taken && !closes(entries, choice, day)) };
}
