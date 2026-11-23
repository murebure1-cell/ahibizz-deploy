const defaultTimeZone = "Europe/Sarajevo";

/** Stable Bosnian presentation, independent of the browser locale and timezone. */
export function accountDate(value: string | Date, timeZone = defaultTimeZone) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB-u-nu-latn", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone,
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.day}. ${parts.month}. ${parts.year}.`;
}

export function bosnianDateTime(value: string | Date, timeZone = defaultTimeZone) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  const time = new Intl.DateTimeFormat("en-GB-u-nu-latn", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(date);
  return `${accountDate(date, timeZone)} ${time}`;
}
