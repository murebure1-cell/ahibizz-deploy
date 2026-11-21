import { directorySearchSuffix } from "./directory-navigation";
export type SavedSearch = { filters: string; label: string };
const filterKeys = new Set(["q", "mjesto", "categoryId", "subcategoryId", "istaknute", "otvoreno"]);
export function canonicalSavedSearch(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 3200 || !value.startsWith("?")) return null;
  const pairs = new URLSearchParams(value.slice(1));
  const seen = new Set<string>();
  for (const [key, term] of pairs) {
    if (!filterKeys.has(key) || seen.has(key) || /[\p{Cc}\uFFFD]/u.test(term)) return null;
    seen.add(key);
  }
  const suffix = directorySearchSuffix(Object.fromEntries(pairs));
  return suffix && suffix === value ? suffix : null;
}
