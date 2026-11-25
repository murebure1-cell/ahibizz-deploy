const adminSections = {
  danas: "today",
  odobrenja: "approvalQueue",
  pregled: "businessQueue",
  nalozi: "accounts",
  djelatnosti: "businesses",
  recenzije: "reviews",
} as const;

export type AdminSection = (typeof adminSections)[keyof typeof adminSections];

const sectionQueries: Record<AdminSection, keyof typeof adminSections> = {
  today: "danas",
  approvalQueue: "odobrenja",
  businessQueue: "pregled",
  accounts: "nalozi",
  businesses: "djelatnosti",
  reviews: "recenzije",
};

/** Unknown or duplicated server query values select the default administrative pane. */
export function adminSection(value: unknown): AdminSection {
  return typeof value === "string" && Object.hasOwn(adminSections, value)
    ? adminSections[value as keyof typeof adminSections]
    : "today";
}

/** Pane changes discard unrelated query values and stale anchors, as account navigation does. */
export function adminSectionPath(section: AdminSection): string {
  const query = Object.hasOwn(sectionQueries, section) ? sectionQueries[section] : "danas";
  return `/administracija?odjeljak=${query}`;
}

export function readAdminNavigation(params: URLSearchParams): AdminSection {
  const values = params.getAll("odjeljak");
  return adminSection(values.length === 1 ? values[0] : undefined);
}

/**
 * Content the visitor sees is edited in its own place, apart from work with people and businesses.
 * These pages are owner-only like administration; the address never grants access.
 */
export const contentPaths = {
  home: "/sadrzaj",
  articles: "/sadrzaj/clanci",
  design: "/sadrzaj/izgled",
  designFrame: "/sadrzaj/izgled/pregled",
  categories: "/sadrzaj/kategorije",
} as const;

/** This closed return destination never grants access; the server still requires an owner. */
export const businessImportPath = "/administracija/uvoz-prijava";
export const businessLocationBatchPath = "/administracija/lokacije";
export const adminMailPath = "/administracija/emailovi";
export function adminReturnPath(value: unknown): string | null {
  if (
    value === "/administracija" ||
    value === "/administracija/zahtjevi" ||
    value === contentPaths.home ||
    value === contentPaths.articles ||
    value === contentPaths.design ||
    value === contentPaths.categories ||
    value === "/administracija/reels" ||
    value === businessImportPath ||
    value === businessLocationBatchPath ||
    value === adminMailPath
  )
    return value;
  if (typeof value !== "string") return null;
  const match = /^\/administracija\?odjeljak=([a-z]+)$/.exec(value);
  return match?.[0] === value && match[1] && Object.hasOwn(adminSections, match[1]) ? value : null;
}
