import { businessInquiryPath, businessUuid, ownerCalendarPath } from "./business-today";
import { msg } from "./i18n/translate";
import { messageLink } from "./messaging";

export const activityInboxPath = "/nalog/obavijesti";
export const deviceNotificationSettingsPath = "/nalog?odjeljak=postavke&prikaz=obavijesti";
export type ActivityKind = "message" | "service" | "rental" | "stay" | "reel";
export type ActivityAction =
  | "message"
  | "request"
  | "approve"
  | "decline"
  | "cancel"
  | "complete"
  | "published"
  | "rejected";
export type ActivityRow = {
  id: string;
  version: number;
  kind: ActivityKind;
  action: ActivityAction;
  subjectId: string;
  businessId: string | null;
  businessTitle: string | null;
  subjectName: string | null;
  personId: string | null;
  startsAt: string | null;
  timezone: string | null;
  ownerSide: boolean;
  happenedAt: string;
  unread: boolean;
};

const labels = {
  service: {
    request: msg("Novi zahtjev za termin"),
    approve: msg("Termin je potvrđen"),
    decline: msg("Termin je odbijen"),
    cancel: msg("Termin je otkazan"),
    complete: msg("Termin je završen"),
  },
  rental: {
    request: msg("Novi zahtjev za najam"),
    approve: msg("Najam je potvrđen"),
    decline: msg("Zahtjev za najam je odbijen"),
    cancel: msg("Najam je otkazan"),
    complete: msg("Najam je završen"),
  },
  stay: {
    request: msg("Novi zahtjev za smještaj"),
    approve: msg("Smještaj je potvrđen"),
    decline: msg("Zahtjev za smještaj je odbijen"),
    cancel: msg("Smještaj je otkazan"),
    complete: msg("Boravak je završen"),
  },
} as const;

export function activityLabel({ kind, action }: Pick<ActivityRow, "kind" | "action">) {
  if (kind === "message") return msg("Nova poruka");
  if (kind === "reel")
    return action === "published" ? msg("Reel je objavljen") : msg("Reel je vraćen");
  return labels[kind][action as keyof (typeof labels)[typeof kind]] ?? msg("Promjena termina");
}

function calendarDay(startsAt: string | null, timezone: string | null) {
  if (!startsAt || !timezone) return undefined;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(startsAt));
    const value = (type: string) => parts.find((part) => part.type === type)?.value;
    return `${value("year")}-${value("month")}-${value("day")}`;
  } catch {
    return undefined;
  }
}

export function activityTarget(row: ActivityRow) {
  if (!businessUuid(row.subjectId)) return activityInboxPath;
  if (row.kind === "message") {
    if (row.personId && /^[A-Za-z0-9_-]{1,128}$/.test(row.personId))
      return messageLink({ kind: "person", targetId: row.personId });
    return businessInquiryPath(row.subjectId);
  }
  if (!businessUuid(row.businessId)) return activityInboxPath;
  if (row.kind === "reel") {
    return row.action === "published"
      ? `/reels/${row.subjectId}`
      : `/nalog/reels?djelatnost=${row.businessId}#reel-${row.subjectId}`;
  }
  if (row.ownerSide) {
    return ownerCalendarPath({
      businessId: row.businessId,
      kind: row.kind,
      ...(row.kind === "service" ? { day: calendarDay(row.startsAt, row.timezone) } : {}),
    });
  }
  const history = ["decline", "cancel", "complete"].includes(row.action);
  return `/nalog?odjeljak=termini${history ? "&prikaz=historija" : ""}`;
}
