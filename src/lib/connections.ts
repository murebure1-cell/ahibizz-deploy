import {
  isProfileCountryCode,
  type ProfileBadges,
  type ProfileImageKind,
  readProfileBadges,
  type WorkStatus,
  workStatusLabels,
} from "./people";

export type PublicPerson = ProfileBadges & {
  id: string;
  name: string;
  city: string | null;
  countryCode: string | null;
  bio: string | null;
  skills: string[];
  workStatus: WorkStatus;
  photoVersion: number | null;
  coverVersion: number | null;
};
/** The counts on a public profile, as drawn: published businesses, friends, year of joining. */
/** Friends is null when the person chose not to show how many friends they have. */
export type PublicPersonStats = { businesses: number; friends: number | null; joinedYear: number };
export function readPublicPersonStats(value: unknown): PublicPersonStats | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const count = (item: unknown) => Number.isSafeInteger(item) && (item as number) >= 0;
  if (
    !count(row.businesses) ||
    !(row.friends === null || count(row.friends)) ||
    !Number.isSafeInteger(row.joinedYear) ||
    (row.joinedYear as number) < 2000 ||
    (row.joinedYear as number) > 3000
  )
    return null;
  return {
    businesses: row.businesses as number,
    friends: row.friends as number | null,
    joinedYear: row.joinedYear as number,
  };
}
export type ProfileVisibility = { isPublic: boolean; profileVersion: number };
export type ConnectionStatus = "pending" | "accepted" | "declined" | "cancelled" | "removed";
export type ConnectionRelationship = {
  id: string | null;
  status: ConnectionStatus | "none";
  direction: "incoming" | "outgoing" | null;
  version: number;
  personId: string;
};
export type Relationship = ConnectionRelationship;
export type ConnectionItem = ConnectionRelationship & { person: PublicPerson | null };
export type ConnectionPage = { items: ConnectionItem[]; page: number; hasMore: boolean };
export type PublicPeoplePage = { items: PublicPerson[]; page: number; hasMore: boolean };
export type ConnectionView = "incoming" | "outgoing" | "contacts";
export type ConnectionAction = "accept" | "decline" | "cancel" | "remove";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid_connections_response");
  return value as Record<string, unknown>;
}
function identity(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}
function version(value: unknown, minimum = 0): value is number {
  return Number.isInteger(value) && (value as number) >= minimum && (value as number) <= 2147483647;
}
export function readPublicPerson(value: unknown): PublicPerson {
  const row = record(value);
  const optional = (v: unknown, max: number) =>
    v === null || (typeof v === "string" && v.trim().length > 0 && v.length <= max);
  if (
    !identity(row.id) ||
    typeof row.name !== "string" ||
    !row.name.trim() ||
    row.name.length > 100 ||
    !optional(row.city, 100) ||
    !optional(row.bio, 1200) ||
    !(row.countryCode === null || isProfileCountryCode(row.countryCode)) ||
    !Array.isArray(row.skills) ||
    row.skills.length > 15 ||
    row.skills.some((s) => typeof s !== "string" || !s.trim() || s.length > 40) ||
    typeof row.workStatus !== "string" ||
    !Object.hasOwn(workStatusLabels, row.workStatus) ||
    !(row.photoVersion === null || version(row.photoVersion, 1)) ||
    !(row.coverVersion === null || version(row.coverVersion, 1))
  )
    throw new Error("invalid_connections_response");
  // Project a whitelist even when a transport accidentally supplies private fields.
  return {
    id: row.id,
    name: row.name,
    ...readProfileBadges(row, "invalid_connections_response"),
    city: row.city as string | null,
    countryCode: row.countryCode as string | null,
    bio: row.bio as string | null,
    skills: [...row.skills] as string[],
    workStatus: row.workStatus as WorkStatus,
    photoVersion: row.photoVersion as number | null,
    coverVersion: row.coverVersion as number | null,
  };
}
export function readRelationship(value: unknown): ConnectionRelationship {
  const row = record(value);
  if (
    !identity(row.personId) ||
    !version(row.version) ||
    typeof row.status !== "string" ||
    !["none", "pending", "accepted", "declined", "cancelled", "removed"].includes(
      String(row.status),
    ) ||
    !(row.direction === null || row.direction === "incoming" || row.direction === "outgoing") ||
    !(row.id === null || identity(row.id)) ||
    (row.status === "none"
      ? row.id !== null || row.version !== 0 || row.direction !== null
      : row.id === null || row.version === 0 || row.direction === null)
  )
    throw new Error("invalid_connections_response");
  return {
    id: row.id as string | null,
    status: row.status as ConnectionRelationship["status"],
    direction: row.direction as ConnectionRelationship["direction"],
    version: row.version,
    personId: row.personId,
  };
}
export function readConnectionItem(value: unknown): ConnectionItem {
  const row = record(value),
    relationship = readRelationship(row),
    person = row.person === null ? null : readPublicPerson(row.person);
  if (relationship.status === "none" || (person && person.id !== relationship.personId))
    throw new Error("invalid_connections_response");
  return { ...relationship, person };
}
export function readProfileVisibility(value: unknown): ProfileVisibility {
  const row = record(value);
  if (typeof row.isPublic !== "boolean" || !version(row.profileVersion))
    throw new Error("invalid_connections_response");
  return { isPublic: row.isPublic, profileVersion: row.profileVersion };
}
export function publicPersonImageUrl(person: PublicPerson, kind: ProfileImageKind): string | null {
  const mediaVersion = kind === "photo" ? person.photoVersion : person.coverVersion;
  return mediaVersion === null
    ? null
    : `/api/connections/people/${encodeURIComponent(person.id)}/media/${kind}?v=${mediaVersion}`;
}
