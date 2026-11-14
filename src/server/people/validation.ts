import { isProfileCountryCode } from "../../lib/people";
export class PeopleAccessError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super("Personal profile action could not be completed.");
  }
}
export function fail(status: number, code: string): never {
  throw new PeopleAccessError(status, code);
}
export const workStatuses = [
  "not_specified",
  "employed",
  "self_employed",
  "business_owner",
  "student",
  "seeking_work",
  "open_to_collaboration",
] as const;
export type WorkStatus = (typeof workStatuses)[number];
export function object(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !keys.includes(key))
  )
    fail(400, "INVALID_PROFILE_INPUT");
  return input as Record<string, unknown>;
}
export function version(input: unknown): number {
  if (!Number.isInteger(input) || (input as number) < 0 || (input as number) > 2147483646)
    fail(400, "INVALID_PROFILE_INPUT");
  return input as number;
}
function text(input: unknown, maximum: number, nullable = false, multiline = false): string | null {
  if (nullable && input === null) return null;
  if (
    typeof input !== "string" ||
    !input.trim() ||
    input.trim().length > maximum ||
    [...input].some((character) => {
      const code = character.charCodeAt(0);
      return (
        (code < 32 && !(multiline && (code === 10 || code === 13))) ||
        code === 127 ||
        (code >= 0x202a && code <= 0x202e) ||
        (code >= 0x2066 && code <= 0x2069)
      );
    })
  )
    fail(400, "INVALID_PROFILE_INPUT");
  return input.trim();
}
function birthDate(input: unknown, now: Date): string | null {
  if (input === null) return null;
  if (
    typeof input !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input) ||
    input < "0001-01-01" ||
    input > now.toISOString().slice(0, 10)
  )
    fail(400, "INVALID_PROFILE_INPUT");
  const date = new Date(`${input}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input)
    fail(400, "INVALID_PROFILE_INPUT");
  return input;
}
export function profileInput(input: unknown, now: Date) {
  const value = object(input, [
    "expectedVersion",
    "name",
    "birthDate",
    "city",
    "countryCode",
    "bio",
    "skills",
    "workStatus",
  ]);
  if (
    !Array.isArray(value.skills) ||
    value.skills.length > 15 ||
    !workStatuses.includes(value.workStatus as WorkStatus)
  )
    fail(400, "INVALID_PROFILE_INPUT");
  const skills = value.skills.map((value) => text(value, 40) as string);
  if (new Set(skills.map((value) => value.normalize("NFKC").toLowerCase())).size !== skills.length)
    fail(400, "INVALID_PROFILE_INPUT");
  const countryCode = value.countryCode === null ? null : text(value.countryCode, 2);
  if (countryCode !== null && !isProfileCountryCode(countryCode))
    fail(400, "INVALID_PROFILE_INPUT");
  return {
    expectedVersion: version(value.expectedVersion),
    name: text(value.name, 100) as string,
    birthDate: birthDate(value.birthDate, now),
    city: text(value.city, 100, true),
    countryCode,
    bio: text(value.bio, 1200, true, true),
    skills,
    workStatus: value.workStatus as WorkStatus,
  };
}
export function mediaKind(input: unknown): "photo" | "cover" {
  if (input !== "photo" && input !== "cover") fail(400, "INVALID_PROFILE_INPUT");
  return input;
}
