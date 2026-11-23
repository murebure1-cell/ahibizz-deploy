import { blockedPeoplePath } from "./account-blocks";
import { activityInboxPath, deviceNotificationSettingsPath } from "./activity";
import { adminReturnPath } from "./admin-navigation";
import { bookingReturnPath } from "./booking-return";
import {
  businessInquiryPath,
  businessUuid,
  type CalendarTarget,
  ownerCalendarPath,
  readBusinessInquiry,
  readCalendarTarget,
} from "./business-today";
import { type MessageTarget, messageLink, readMessageTarget } from "./messaging";
import { canonicalSavedSearch } from "./saved-search";

const accountSections = {
  pregled: "overview",
  profil: "profile",
  djelatnosti: "businesses",
  termini: "appointments",
  prijatelji: "connections",
  poruke: "messages",
  postavke: "settings",
  sacuvani: "saved",
} as const;

export type AccountSection = (typeof accountSections)[keyof typeof accountSections];

const sectionQueries: Record<AccountSection, keyof typeof accountSections> = {
  overview: "pregled",
  profile: "profil",
  businesses: "djelatnosti",
  appointments: "termini",
  connections: "prijatelji",
  messages: "poruke",
  settings: "postavke",
  saved: "sacuvani",
};

/** A pane change drops old message targets and unrelated query parameters. */
export function accountSectionPath(section: AccountSection): string {
  const query = Object.hasOwn(sectionQueries, section) ? sectionQueries[section] : "profil";
  return `/nalog?odjeljak=${query}`;
}

/** Unknown or duplicated section query values open the default account view. */
export function accountSection(value: unknown): AccountSection {
  return typeof value === "string" && Object.hasOwn(accountSections, value)
    ? accountSections[value as keyof typeof accountSections]
    : "profile";
}

/** Read only known panes and closed message targets from the current browser address. */
export function readAccountNavigation(params: URLSearchParams): {
  section: AccountSection;
  messageTarget?: MessageTarget;
  invalidMessageTarget: boolean;
  businessThread?: string;
  calendarTarget?: CalendarTarget;
} {
  const values = params.getAll("odjeljak");
  const section =
    params.size === 0 ? "overview" : accountSection(values.length === 1 ? values[0] : undefined);
  const calendarTarget = readCalendarTarget(params);
  if (calendarTarget) return { section, calendarTarget, invalidMessageTarget: false };
  const businessThread = readBusinessInquiry(params);
  if (businessThread) return { section, businessThread, invalidMessageTarget: false };
  if (section !== "messages") return { section, invalidMessageTarget: false };
  try {
    const messageTarget = readMessageTarget(params) ?? undefined;
    if (messageTarget && accountReturnPath(messageLink(messageTarget)) === "/nalog")
      throw new Error("invalid_message_target");
    return { section, messageTarget, invalidMessageTarget: false };
  } catch {
    return { section, invalidMessageTarget: true };
  }
}

export const accountNotificationsPath = activityInboxPath;

/** Only known in-app destinations survive login; never a caller-supplied origin or nested URL. */
export function accountReturnPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 420 ||
    [...value].some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) > 126)
  )
    return "/nalog";
  if (
    value === accountNotificationsPath ||
    value === deviceNotificationSettingsPath ||
    /^\/nalog\/obavijesti\?stavka=[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value) ||
    value === "/sacuvane-pretrage" ||
    value === "/nalog/isticanja" ||
    /^\/nalog\/isticanja\?djelatnost=[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value) ||
    value === "/nalog?odjeljak=djelatnosti&novo=1" ||
    value === "/nalog?odjeljak=termini&prikaz=historija" ||
    /^\/nalog\/reels(?:\?djelatnost=[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})?$/i.test(value) ||
    /^\/reels\/[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      value,
    ) ||
    value === blockedPeoplePath ||
    value === "/pomoc" ||
    value === "/blog?sacuvano=1" ||
    (/^\/blog\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 86)
  )
    return value;
  if (value.startsWith("/pretraga?") && canonicalSavedSearch(value.slice("/pretraga".length)))
    return value;
  const reelReportPrefix = "/prijavi-sadrzaj?vrsta=reel&oznaka=";
  if (value.startsWith(reelReportPrefix) && businessUuid(value.slice(reelReportPrefix.length)))
    return value;
  if (value.startsWith("/nalog?")) {
    const params = new URLSearchParams(value.slice(7));
    const calendar = readCalendarTarget(params),
      thread = readBusinessInquiry(params);
    if (
      (calendar && value === ownerCalendarPath(calendar)) ||
      (thread && value === businessInquiryPath(thread))
    )
      return value;
  }
  const administration = adminReturnPath(value);
  if (administration) return administration;
  const previous = bookingReturnPath(value);
  if (previous !== "/nalog") return previous;
  if (
    /^\/djelatnosti\/[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}#(?:recenzije|sacuvaj)$/i.test(
      value,
    )
  )
    return value;
  const section = /^\/nalog\?odjeljak=([a-z]+)$/.exec(value)?.[1];
  if (section && Object.hasOwn(accountSections, section)) return value;
  const person = /^\/nalog\?odjeljak=poruke&osoba=[A-Za-z0-9_-]{1,128}$/.exec(value);
  const business =
    /^\/nalog\?odjeljak=poruke&djelatnost=[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.exec(
      value,
    );
  return person?.[0] === value || business?.[0] === value ? value : "/nalog";
}
