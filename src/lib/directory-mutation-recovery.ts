import type { BusinessFields, DirectoryBusiness } from "../server/directory/types";
import { DirectoryRequestError } from "./directory-create-submission";

const fieldKeys = [
  "title",
  "categoryId",
  "subcategoryId",
  "description",
  "contactEmail",
  "contactPhone",
  "websiteUrl",
  "addressLine",
  "city",
  "countryCode",
  "latitude",
  "longitude",
] as const;

export type DirectoryMutation = {
  before: DirectoryBusiness;
  action:
    | "edit"
    | "publish"
    | "archive"
    | "recover"
    | "return-to-draft"
    | "approve-changes"
    | "reject-changes";
  desiredStatus: DirectoryBusiness["status"];
  fields?: BusinessFields;
  publish?: boolean;
  useProposedFields?: boolean;
  bookingEnabled?: boolean;
  wasNew?: boolean;
  reason?: string;
};

export function uncertainDirectoryMutation(failure: unknown): boolean {
  return !(
    failure instanceof DirectoryRequestError &&
    failure.status >= 400 &&
    failure.status < 500 &&
    failure.status !== 408
  );
}

export function directoryMutationState(
  intent: DirectoryMutation,
  fresh: DirectoryBusiness,
): "pending" | "matched" | "changed" {
  if (
    fresh.id !== intent.before.id ||
    !Number.isInteger(fresh.version) ||
    fresh.version < intent.before.version ||
    !["draft", "pending", "published", "archived"].includes(fresh.status)
  )
    throw new Error("invalid_directory_reconciliation");
  const checkFields = (row: DirectoryBusiness) =>
    intent.useProposedFields ? effectiveBusiness(row) : row;
  if (
    intent.action === "edit" &&
    fresh.status === intent.desiredStatus &&
    fresh.version === intent.before.version &&
    intent.fields &&
    directoryMutationFieldsMatch(intent.fields, checkFields(fresh)) &&
    directoryMutationFieldsMatch(intent.fields, checkFields(intent.before))
  )
    return "matched";
  // A read can overtake a request whose transaction is still waiting to commit.
  if (fresh.version === intent.before.version) return "pending";
  if (fresh.status !== intent.desiredStatus) return "changed";
  if (
    intent.action === "return-to-draft" &&
    (fresh.moderationReturn?.reason !== intent.reason ||
      fresh.moderationReturn?.version !== fresh.version)
  )
    return "changed";
  if (intent.action === "approve-changes" || intent.action === "reject-changes")
    return fresh.version === intent.before.version + 1 &&
      fresh.revisionDecision === intent.action &&
      (intent.action !== "reject-changes" || fresh.revisionRejection === intent.reason)
      ? "matched"
      : "changed";
  return intent.fields && !directoryMutationFieldsMatch(intent.fields, checkFields(fresh))
    ? "changed"
    : "matched";
}

export function effectiveBusiness(business: DirectoryBusiness): DirectoryBusiness {
  return { ...business, ...business.editorialRevision?.fields };
}
export function directoryMutationFieldsMatch(
  fields: BusinessFields,
  fresh: DirectoryBusiness,
): boolean {
  for (const key of fieldKeys) {
    let wanted = fields[key];
    if (typeof wanted === "string") {
      wanted = wanted.trim();
      if (wanted === "" && key !== "title") wanted = null;
    }
    if (typeof wanted === "string") {
      if (key === "contactEmail") wanted = wanted.toLowerCase();
      if (key === "countryCode") wanted = wanted.toUpperCase();
      if (key === "websiteUrl") wanted = new URL(wanted).href;
    }
    if (fresh[key] !== wanted) return false;
  }
  return true;
}

/** Update confirmed cached rows before a fallible background list refresh. */
export function patchDirectoryBusinessCache(
  items: DirectoryBusiness[] | null,
  fresh: DirectoryBusiness,
  archived: boolean,
  includeMissing = false,
): DirectoryBusiness[] | null {
  if (!items) return items;
  const previous = items.find((row) => row.id === fresh.id);
  if (previous && previous.version > fresh.version) return items;
  const belongs = (fresh.status === "archived") === archived;
  if (!belongs) return previous ? items.filter((row) => row.id !== fresh.id) : items;
  if (previous) return items.map((row) => (row.id === fresh.id ? fresh : row));
  return includeMissing ? [fresh, ...items].slice(0, 20) : items;
}
