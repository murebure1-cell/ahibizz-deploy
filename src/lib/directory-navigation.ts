export type DirectorySearchParams = Partial<
  Record<"q" | "mjesto" | "categoryId" | "subcategoryId" | "istaknute" | "page", string | string[]>
>;

/** Carry only directory filters between results and public profiles. */
export function directorySearchSuffix(params: DirectorySearchParams): string {
  const values = new URLSearchParams();
  for (const [key, limit] of [
    ["q", 120],
    ["mjesto", 100],
    ["categoryId", 128],
    ["subcategoryId", 128],
  ] as const) {
    const raw = params[key];
    const value = typeof raw === "string" ? raw.trim().slice(0, limit) : "";
    if (value) values.set(key, value);
  }
  if (params.istaknute === "kategorija" || params.istaknute === "1")
    values.set("istaknute", params.istaknute);
  if (typeof params.page === "string" && /^\d{1,3}$/.test(params.page)) {
    const page = Number(params.page);
    if (page > 1 && page <= 500) values.set("page", String(page));
  }
  return values.size ? `?${values}` : "";
}
