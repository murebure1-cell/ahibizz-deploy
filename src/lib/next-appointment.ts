export type NextAppointment = {
  id: string;
  kind: "service" | "rental" | "stay";
  status: "requested" | "confirmed";
  name: string;
  businessTitle: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
};

export function isNextAppointment(value: unknown): value is NextAppointment {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<NextAppointment>;
  if (
    typeof row.id !== "string" ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(row.id) ||
    !["service", "rental", "stay"].includes(row.kind ?? "") ||
    !["requested", "confirmed"].includes(row.status ?? "") ||
    typeof row.businessTitle !== "string" ||
    typeof row.name !== "string" ||
    typeof row.timezone !== "string" ||
    !row.timezone ||
    typeof row.startsAt !== "string" ||
    typeof row.endsAt !== "string"
  )
    return false;
  const dates = [row.startsAt, row.endsAt];
  const pattern = row.kind === "stay" ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;
  if (
    !dates.every((date) => pattern.test(date) && Number.isFinite(Date.parse(date))) ||
    Date.parse(row.endsAt) <= Date.parse(row.startsAt)
  )
    return false;
  try {
    new Intl.DateTimeFormat("bs", { timeZone: row.timezone });
    return true;
  } catch {
    return false;
  }
}

function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let part = "",
    bytes = 0;
  for (const character of line) {
    const width = encoder.encode(character).length;
    if (bytes + width > 75) {
      lines.push(part);
      part = " ";
      bytes = 1;
    }
    part += character;
    bytes += width;
  }
  lines.push(part);
  return lines.join("\r\n");
}

export function appointmentCalendar(row: NextAppointment, now = new Date()): string {
  if (!isNextAppointment(row) || row.status !== "confirmed")
    throw new Error("Invalid calendar event");
  const stamp = (date: Date) =>
    date
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
  const format = (value: string) =>
    row.kind === "stay" ? value.replace(/-/g, "") : stamp(new Date(value));
  const type = row.kind === "stay" ? ";VALUE=DATE:" : ":";
  const summary = `${row.name} · ${row.businessTitle}`
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/[;,]/g, "\\$&")
    .replace(/\p{Cc}/gu, "");
  return `${[
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AhiBizz//Termini//BS",
    "BEGIN:VEVENT",
    `UID:${row.kind}-${row.id}@ahibizz.com`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART${type}${format(row.startsAt)}`,
    `DTEND${type}${format(row.endsAt)}`,
    `SUMMARY:${summary}`,
    "STATUS:CONFIRMED",
    "CLASS:PRIVATE",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .map(foldLine)
    .join("\r\n")}\r\n`;
}
