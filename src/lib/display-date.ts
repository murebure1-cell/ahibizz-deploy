const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "numeric",
  year: "numeric",
  timeZone: "Europe/Sarajevo",
});
const months = [
  "januara",
  "februara",
  "marta",
  "aprila",
  "maja",
  "juna",
  "jula",
  "augusta",
  "septembra",
  "oktobra",
  "novembra",
  "decembra",
];
export function accountDate(iso: string) {
  const parts = Object.fromEntries(
    dateFormatter.formatToParts(new Date(iso)).map((part) => [part.type, part.value]),
  );
  return `${Number(parts.day)}. ${months[Number(parts.month) - 1]} ${parts.year}.`;
}

export function messageDay(iso: string) {
  const date = new Date(iso);
  return `${date.getDate()}. ${months[date.getMonth()]}`;
}
