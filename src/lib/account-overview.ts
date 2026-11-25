import { isNextAppointment, type NextAppointment } from "./next-appointment";
import { isPackageId, type PackageId, packageBusinessLimit } from "./packages";

export type OverviewBusiness = {
  id: string;
  title: string;
  status: "draft" | "pending" | "published";
};
/** The overview lists at most this many businesses; the rest are one tap away. */
export const overviewBusinessLimit = 5;

export type AccountOverviewFacts = {
  accountId: string;
  joinedAt: string;
  businesses: number;
  businessList: OverviewBusiness[];
  /** Null for the administrator account, which holds no package and has no business limit. */
  package: PackageId | null;
  businessLimit: number | null;
  unreadThreads: number;
  promotedBusinesses: number;
  nextAppointment?: NextAppointment | null;
};

function overviewBusiness(value: unknown): value is OverviewBusiness {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    Object.keys(row).length === 3 &&
    typeof row.id === "string" &&
    /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(row.id) &&
    typeof row.title === "string" &&
    row.title.length > 0 &&
    row.title.length <= 120 &&
    (row.status === "draft" || row.status === "pending" || row.status === "published")
  );
}

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
    !Array.isArray(overview.businessList) ||
    overview.businessList.length > overviewBusinessLimit ||
    !overview.businessList.every(overviewBusiness) ||
    overview.businessList.length > Number(overview.businesses) ||
    (overview.package === null
      ? overview.businessLimit !== null
      : !isPackageId(overview.package) ||
        overview.businessLimit !== packageBusinessLimit(overview.package)) ||
    [overview.businesses, overview.unreadThreads, overview.promotedBusinesses].some(
      (value) => typeof value !== "number" || !Number.isSafeInteger(value) || value < 0,
    )
  )
    throw new Error("Invalid account overview");
  return overview as AccountOverviewFacts;
}
