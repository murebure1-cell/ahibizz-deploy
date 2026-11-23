import { accountDate } from "./display-date";

export const articleCategories = {
  vodici: "Vodiči",
  poslovanje: "Poslovanje",
  sigurnost: "Sigurnost",
  novosti: "Novosti",
} as const;

export type ArticleCategory = keyof typeof articleCategories;

export function articleCategory(value: unknown): ArticleCategory | null {
  return typeof value === "string" && Object.hasOwn(articleCategories, value)
    ? (value as ArticleCategory)
    : null;
}

export function articleSlug(value: unknown): value is string {
  return (
    typeof value === "string" && value.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  );
}

export function searchInput(value: unknown) {
  if (typeof value !== "string") return "";
  return value.normalize("NFC").replace(/\s+/g, " ").trim().slice(0, 100);
}

export function contentSearchKey(value: string) {
  return value.normalize("NFD").toLowerCase().replace(/\p{M}/gu, "").replaceAll("đ", "d");
}

export function readMinutes(body: string) {
  return Math.max(1, Math.ceil(body.trim().split(/\s+/).length / 200));
}

export type ArticleSummary = {
  slug: string;
  category: ArticleCategory;
  title: string;
  excerpt: string;
  minutes: number;
  featured: boolean;
  publishedAt: Date | null;
};

export type BlogArticle = ArticleSummary & { body: string; revision: number };

export function formatArticleDate(value: Date) {
  return accountDate(value);
}

export function blogPath(
  filters: { q?: string; category?: ArticleCategory | null; saved?: boolean; page?: number } = {},
) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.category) params.set("tema", filters.category);
  if (filters.saved) params.set("sacuvano", "1");
  if (filters.page && filters.page > 1) params.set("strana", String(filters.page));
  return params.size ? `/blog?${params}` : "/blog";
}
