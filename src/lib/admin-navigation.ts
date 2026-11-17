const adminSections = {
  nalozi: "accounts",
  kategorije: "categories",
  djelatnosti: "businesses",
  naplata: "billing",
} as const;

export type AdminSection = (typeof adminSections)[keyof typeof adminSections];

const sectionQueries: Record<AdminSection, keyof typeof adminSections> = {
  accounts: "nalozi",
  categories: "kategorije",
  businesses: "djelatnosti",
  billing: "naplata",
};

/** Unknown or duplicated server query values select the default administrative pane. */
export function adminSection(value: unknown): AdminSection {
  return typeof value === "string" && Object.hasOwn(adminSections, value)
    ? adminSections[value as keyof typeof adminSections]
    : "accounts";
}

/** Pane changes discard unrelated query values and stale anchors, as account navigation does. */
export function adminSectionPath(section: AdminSection): string {
  const query = Object.hasOwn(sectionQueries, section) ? sectionQueries[section] : "nalozi";
  return `/administracija?odjeljak=${query}`;
}

export function readAdminNavigation(params: URLSearchParams): AdminSection {
  const values = params.getAll("odjeljak");
  return adminSection(values.length === 1 ? values[0] : undefined);
}

/** This closed return destination never grants access; the server still requires an owner. */
export const businessImportPath = "/administracija/uvoz-prijava";
export function adminReturnPath(value: unknown): string | null {
  if (value === "/administracija" || value === businessImportPath) return value;
  if (typeof value !== "string") return null;
  const match = /^\/administracija\?odjeljak=([a-z]+)$/.exec(value);
  return match?.[0] === value && match[1] && Object.hasOwn(adminSections, match[1]) ? value : null;
}
