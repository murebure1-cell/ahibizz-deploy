import type { MetadataRoute } from "next";
import { getDatabase } from "../server/db";
import { siteOrigin } from "../server/site-origin";

export const dynamic = "force-dynamic";

const pages = [
  "/",
  "/pretraga",
  "/mapa",
  "/reels",
  "/blog",
  "/pomoc",
  "/o-nama",
  "/pravila-zajednice",
  "/privatnost",
];

/**
 * The public pages, every published business and every published article. A database that
 * cannot be read leaves the fixed pages, so the file always answers.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteOrigin();
  if (!origin) return [];
  const entries: MetadataRoute.Sitemap = pages.map((path) => ({
    url: `${origin}${path === "/" ? "" : path}`,
    changeFrequency: "daily",
    priority: path === "/" ? 1 : 0.6,
  }));
  const database = getDatabase();
  try {
    if (!database.configured()) return entries;
    const businesses = await database.query(
      `SELECT b.id, b.updated_at FROM directory_business b JOIN auth_user u ON u.id=b.owner_user_id
       WHERE b.deleted_at IS NULL AND b.status='published' AND u.approval='approved'
         AND u."emailVerified" = true
       ORDER BY b.updated_at DESC LIMIT 5000`,
    );
    for (const row of businesses.rows)
      entries.push({
        url: `${origin}/djelatnosti/${encodeURIComponent(String(row.id))}`,
        lastModified: row.updated_at instanceof Date ? row.updated_at : undefined,
        changeFrequency: "weekly",
        priority: 0.8,
      });
    const articles = await database.query(
      `SELECT slug, published_at FROM blog_article
       WHERE published_at IS NOT NULL AND published_at <= now()
       ORDER BY published_at DESC LIMIT 1000`,
    );
    for (const row of articles.rows)
      entries.push({
        url: `${origin}/blog/${encodeURIComponent(String(row.slug))}`,
        lastModified: row.published_at instanceof Date ? row.published_at : undefined,
        changeFrequency: "monthly",
        priority: 0.5,
      });
  } catch {
    // The fixed pages are still a valid sitemap.
  }
  return entries;
}
