import { bookingReturnPath } from "./booking-return";

const accountSections = {
  profil: "profile",
  djelatnosti: "businesses",
  termini: "appointments",
  prijatelji: "connections",
  poruke: "messages",
} as const;

export type AccountSection = (typeof accountSections)[keyof typeof accountSections];

/** Unknown or duplicated section query values open the default account view. */
export function accountSection(value: unknown): AccountSection {
  return typeof value === "string" && Object.hasOwn(accountSections, value)
    ? accountSections[value as keyof typeof accountSections]
    : "profile";
}

/** Only known in-app destinations survive login; never a caller-supplied origin or nested URL. */
export function accountReturnPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 420 ||
    [...value].some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) > 126)
  )
    return "/nalog";
  const previous = bookingReturnPath(value);
  if (previous !== "/nalog") return previous;
  const section = /^\/nalog\?odjeljak=([a-z]+)$/.exec(value)?.[1];
  if (section && Object.hasOwn(accountSections, section)) return value;
  const person = /^\/nalog\?odjeljak=poruke&osoba=[A-Za-z0-9_-]{1,128}$/.exec(value);
  const business =
    /^\/nalog\?odjeljak=poruke&djelatnost=[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.exec(
      value,
    );
  return person?.[0] === value || business?.[0] === value ? value : "/nalog";
}
