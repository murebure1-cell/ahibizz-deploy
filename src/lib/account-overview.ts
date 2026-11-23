import { isNextAppointment, type NextAppointment } from "./next-appointment";

export type AccountOverviewFacts = {
  accountId: string;
  joinedAt: string;
  businesses: number;
  unreadThreads: number;
  promotedBusinesses: number;
  nextAppointment?: NextAppointment | null;
};

export function readOverview(value: unknown, expectedId: string): AccountOverviewFacts {
  if (!value || typeof value !== "object" || !("overview" in value))
    throw new Error("Invalid account overview");
  const overview = value.overview as Partial<AccountOverviewFacts> | null;
  if (
    !overview ||
    overview.accountId !== expectedId ||
    (overview.nextAppointment != null && !isNextAppointment(overview.nextAppointment)) ||
    typeof overview.joinedAt !== "string" ||
    !Number.isFinite(Date.parse(overview.joinedAt)) ||
    [overview.businesses, overview.unreadThreads, overview.promotedBusinesses].some(
      (value) => typeof value !== "number" || !Number.isSafeInteger(value) || value < 0,
    )
  )
    throw new Error("Invalid account overview");
  return overview as AccountOverviewFacts;
}
