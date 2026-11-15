import { type PersonalProfile, workStatusLabels } from "./people";

export class ProfileRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super("Profile request could not be completed.");
  }
}
export async function peopleRequest(
  path: string,
  options: RequestInit = {},
): Promise<{ profile: PersonalProfile }> {
  const response = await fetch(`/api/people/${path}`, {
    ...options,
    credentials: "same-origin",
    cache: "no-store",
    mode: "same-origin",
    redirect: "error",
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result || typeof result !== "object")
    throw new ProfileRequestError(response.status, result?.code ?? "PROFILE_UNAVAILABLE");
  return result;
}
/** Bind a mounted private profile to the account it was opened for. */
export function peopleAccountRequest(
  request: typeof peopleRequest,
  expectedAccountId: string | undefined,
  path: string,
  options: RequestInit = {},
): ReturnType<typeof peopleRequest> {
  if (typeof expectedAccountId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(expectedAccountId))
    return Promise.reject(new ProfileRequestError(401, "ACCOUNT_IDENTITY_CHANGED"));
  const headers = new Headers(options.headers);
  headers.set("X-AhiBizz-Account-ID", expectedAccountId);
  return request(path, { ...options, headers });
}
export function profileError(error: unknown) {
  const code = error instanceof ProfileRequestError ? error.code : "";
  if (code === "AUTHENTICATION_REQUIRED") return "Prijavi se ponovo.";
  if (code === "ACCOUNT_IDENTITY_CHANGED") return "Prijavi se ponovo svojim nalogom.";
  if (code === "VERSION_CONFLICT")
    return "Profil je izmijenjen na drugom mjestu. Otvori sačuvani profil.";
  if (code === "COVER_NOT_ALLOWED") return "Vlastita naslovnica nije uključena u tvoj paket.";
  if (["MEDIA_INVALID", "INVALID_CONTENT_TYPE"].includes(code))
    return "Izaberi ispravnu JPG, PNG ili WebP fotografiju.";
  if (["MEDIA_TOO_LARGE", "REQUEST_TOO_LARGE"].includes(code))
    return "Fotografija je prevelika. Najviše 4 MB.";
  if (code === "INVALID_PROFILE_INPUT") return "Provjeri unesene podatke.";
  return "Promjena nije potvrđena. Provjeri sačuvani profil.";
}
export function readPersonalProfile(value: unknown): PersonalProfile {
  if (!value || typeof value !== "object") throw new Error("invalid_profile_response");
  const row = value as PersonalProfile;
  const optional = (value: unknown, max: number) =>
    value === null || (typeof value === "string" && value.length > 0 && value.length <= max);
  const date =
    typeof row.birthDate === "string" ? new Date(`${row.birthDate}T00:00:00.000Z`) : null;
  const validDate =
    row.birthDate === null ||
    (typeof row.birthDate === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(row.birthDate) &&
      row.birthDate >= "0001-01-01" &&
      date !== null &&
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === row.birthDate);
  if (
    typeof row.id !== "string" ||
    !row.id ||
    row.id.length > 128 ||
    typeof row.name !== "string" ||
    !row.name.trim() ||
    row.name.length > 100 ||
    !Number.isInteger(row.version) ||
    row.version < 0 ||
    row.version > 2147483647 ||
    typeof row.canCustomizeCover !== "boolean" ||
    !Array.isArray(row.skills) ||
    row.skills.length > 15 ||
    row.skills.some((skill) => typeof skill !== "string" || !skill.trim() || skill.length > 40) ||
    typeof row.workStatus !== "string" ||
    !Object.hasOwn(workStatusLabels, row.workStatus) ||
    !optional(row.city, 100) ||
    !optional(row.bio, 1200) ||
    !(
      row.countryCode === null ||
      (typeof row.countryCode === "string" && /^[A-Z]{2}$/.test(row.countryCode))
    ) ||
    !validDate
  )
    throw new Error("invalid_profile_response");
  for (const version of [row.photoVersion, row.coverVersion])
    if (version !== null && (!Number.isInteger(version) || version < 1 || version > row.version))
      throw new Error("invalid_profile_response");
  if (!row.canCustomizeCover && row.coverVersion !== null)
    throw new Error("invalid_profile_response");
  return row;
}
