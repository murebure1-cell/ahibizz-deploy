export type AccountOverviewFacts = {
  accountId: string;
  joinedAt: string;
  businesses: number;
  unreadThreads: number;
  promotedBusinesses: number;
  credits: number;
};

export type PlacementKind = "category" | "featured" | "nearby" | "banner";
export type ActivePlacement = { id: string; title: string; endsAt: string; kind: PlacementKind };
export type AccountPlacements = {
  accountId: string;
  items: ActivePlacement[];
};

export function readPlacements(value: unknown, expectedId: string): AccountPlacements {
  const data = (value as { placements?: AccountPlacements } | null)?.placements;
  if (
    !data ||
    data.accountId !== expectedId ||
    !Array.isArray(data.items) ||
    !data.items.every(
      (row) =>
        row &&
        typeof row.id === "string" &&
        /^[a-f0-9-]{36}$/i.test(row.id) &&
        ["category", "featured", "nearby", "banner"].includes(row.kind) &&
        typeof row.title === "string" &&
        Number.isFinite(Date.parse(row.endsAt)),
    )
  )
    throw new Error("Invalid account placements");
  return data;
}

export function readOverview(value: unknown, expectedId: string): AccountOverviewFacts {
  if (!value || typeof value !== "object" || !("overview" in value))
    throw new Error("Invalid account overview");
  const overview = value.overview as Partial<AccountOverviewFacts> | null;
  if (
    !overview ||
    overview.accountId !== expectedId ||
    typeof overview.joinedAt !== "string" ||
    !Number.isFinite(Date.parse(overview.joinedAt)) ||
    [
      overview.businesses,
      overview.unreadThreads,
      overview.promotedBusinesses,
      overview.credits,
    ].some((value) => typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
  )
    throw new Error("Invalid account overview");
  return overview as AccountOverviewFacts;
}
