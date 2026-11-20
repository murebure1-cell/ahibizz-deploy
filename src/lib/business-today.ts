export type CalendarKind = "service" | "rental" | "stay";
export type CalendarTarget = { businessId: string; kind: CalendarKind; day?: string };
export type BusinessChoice = { id: string; title: string };
export type BusinessAgenda = {
  kind: CalendarKind;
  total: number;
  pending: number;
  pendingDay: string | null;
  entries: { id: string; name: string; time: string; status: string }[];
};
export type BusinessTodayData = {
  accountId: string;
  businesses: BusinessChoice[];
  selectedId: string | null;
  agendas: BusinessAgenda[];
  inquiries: { count: number; threadId: string | null };
};
export function businessUuid(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
}
export function ownerCalendarPath(target: CalendarTarget) {
  return `/nalog?odjeljak=djelatnosti&kalendar=${target.kind}&djelatnost=${target.businessId}${target.day ? `&dan=${target.day}` : ""}`;
}
export function businessInquiryPath(threadId: string) {
  return `/nalog?odjeljak=poruke&razgovor=${threadId}`;
}
export function readCalendarTarget(params: URLSearchParams): CalendarTarget | undefined {
  const day = params.get("dan");
  if (params.size !== (day === null ? 3 : 4) || params.get("odjeljak") !== "djelatnosti") return;
  if (
    day !== null &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      !Number.isFinite(Date.parse(`${day}T00:00:00Z`)) ||
      new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day)
  )
    return;
  const businessId = params.get("djelatnost"),
    kind = params.get("kalendar");
  if (!businessUuid(businessId) || (kind !== "service" && kind !== "rental" && kind !== "stay"))
    return;
  if (day && kind !== "service") return;
  return { businessId, kind, ...(day ? { day } : {}) };
}
export function readBusinessInquiry(params: URLSearchParams): string | undefined {
  if (params.size !== 2 || params.get("odjeljak") !== "poruke") return;
  const id = params.get("razgovor");
  return businessUuid(id) ? id : undefined;
}
