import type { Metadata } from "next";
import Link from "next/link";
import { DirectoryResultCard } from "../../../components/directory/DirectoryResultCard";
import { DirectorySearchForm } from "../../../components/directory/DirectorySearchForm";
import styles from "../../../components/directory/public-search.module.css";
import { EmptyDirectory } from "../../../components/EmptyDirectory";
import {
  DirectoryAccessError,
  type DirectoryCategory,
  getPublicDirectoryService,
  type PublicDirectoryBusiness,
} from "../../../server/directory";
import { publicBusinessView } from "../../../server/directory/public-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Istraži djelatnosti" };
type Params = {
  q?: string | string[];
  mjesto?: string | string[];
  categoryId?: string | string[];
  subcategoryId?: string | string[];
  page?: string | string[];
  istaknute?: string | string[];
};
const text = (value: string | string[] | undefined, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
export default async function SearchPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const query = text(params.q, 120),
    city = text(params.mjesto, 100),
    categoryId = text(params.categoryId, 128),
    subcategoryId = text(params.subcategoryId, 128);
  const rawPage = text(params.page, 10),
    page = rawPage && /^\d{1,3}$/.test(rawPage) ? Number(rawPage) : 1;
  const featuredOnly = params.istaknute === "kategorija" ? "category" : params.istaknute === "1";
  let items: PublicDirectoryBusiness[] = [],
    categories: DirectoryCategory[] = [],
    hasMore = false,
    available = false;
  let invalidFilters =
    Object.values(params).some(Array.isArray) ||
    Boolean(rawPage && (!/^\d{1,3}$/.test(rawPage) || page < 1 || page > 500));
  try {
    const service = getPublicDirectoryService();
    if (service && !invalidFilters) {
      const [result, classification] = await Promise.all([
        service.listPublic(
          {
            q: query,
            city,
            ...(categoryId ? { categoryId } : {}),
            ...(subcategoryId ? { subcategoryId } : {}),
            page,
          },
          featuredOnly,
        ),
        service.categories(),
      ]);
      items = result.items;
      hasMore = result.hasMore;
      categories = classification.categories;
      available = true;
    }
  } catch (error) {
    if (error instanceof DirectoryAccessError && error.status === 400) invalidFilters = true;
  }
  function pageHref(next: number) {
    const values = new URLSearchParams();
    if (featuredOnly) values.set("istaknute", featuredOnly === "category" ? "kategorija" : "1");
    if (query) values.set("q", query);
    if (city) values.set("mjesto", city);
    if (categoryId) values.set("categoryId", categoryId);
    if (subcategoryId) values.set("subcategoryId", subcategoryId);
    if (next > 1) values.set("page", String(next));
    return `/pretraga${values.size ? `?${values}` : ""}`;
  }
  const filtered = Boolean(query || city || categoryId || subcategoryId || featuredOnly);
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <header className={styles.intro}>
        <p>Lokalni imenik</p>
        <h1>Šta tražiš?</h1>
      </header>
      <DirectorySearchForm
        featuredOnly={featuredOnly}
        key={JSON.stringify([query, city, categoryId, subcategoryId])}
        query={query}
        city={city}
        categoryId={categoryId}
        subcategoryId={subcategoryId}
        categories={categories}
      />
      <section aria-label="Rezultati pretrage">
        <div className={styles.resultsHeading}>
          <span>
            {filtered
              ? [
                  featuredOnly === "category"
                    ? "Istaknuto u kategoriji"
                    : featuredOnly
                      ? "Istaknute djelatnosti"
                      : null,
                  query,
                  city,
                  categories.find((item) => item.id === categoryId)?.name,
                  categories.find((item) => item.id === subcategoryId)?.name,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "Sve djelatnosti"}
          </span>
          {filtered && <Link href="/pretraga">Očisti pretragu</Link>}
        </div>
        {invalidFilters ? (
          <div role="alert" className={styles.unavailable}>
            <h2>Provjeri filtere pretrage.</h2>
            <Link className="text-link" href="/pretraga">
              Poništi filtere
            </Link>
          </div>
        ) : !available ? (
          <div role="status" className={styles.unavailable}>
            <h2>Imenik trenutno nije dostupan.</h2>
            <p>Pokušaj ponovo kasnije.</p>
          </div>
        ) : items.length ? (
          <div className={styles.grid}>
            {items.map((item) => (
              <DirectoryResultCard key={item.id} business={publicBusinessView(item, categories)} />
            ))}
          </div>
        ) : (
          <EmptyDirectory filtered={filtered} />
        )}
        {available && (page > 1 || hasMore) && (
          <nav className={styles.pagination} aria-label="Stranice rezultata">
            {page > 1 && <Link href={pageHref(page - 1)}>Prethodna</Link>}
            <span>Stranica {page}</span>
            {hasMore && <Link href={pageHref(page + 1)}>Sljedeća</Link>}
          </nav>
        )}
      </section>
    </main>
  );
}
