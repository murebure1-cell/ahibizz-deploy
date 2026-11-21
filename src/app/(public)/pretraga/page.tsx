import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Fragment } from "react";
import { DirectoryResultCard } from "../../../components/directory/DirectoryResultCard";
import { DirectorySearchForm } from "../../../components/directory/DirectorySearchForm";
import styles from "../../../components/directory/public-search.module.css";
import { EmptyDirectory } from "../../../components/EmptyDirectory";
import { SaveSearchButton } from "../../../components/favorites/SavedSearches";
import { CampaignAd } from "../../../components/marketing/CampaignAd";
import adStyles from "../../../components/marketing/campaign-ad.module.css";
import {
  type DirectorySearchParams,
  directorySearchSuffix,
} from "../../../lib/directory-navigation";
import { canonicalSavedSearch } from "../../../lib/saved-search";
import { getSearchBlockViewer } from "../../../server/account-blocks";
import {
  DirectoryAccessError,
  type DirectoryCategory,
  getPublicDirectoryService,
  type PublicDirectoryBusiness,
} from "../../../server/directory";
import { publicBusinessView } from "../../../server/directory/public-view";
import { publicPageAds } from "../../../server/marketing/ad-delivery";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Istraži djelatnosti" };
const text = (value: string | string[] | undefined, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<DirectorySearchParams>;
}) {
  const params = await searchParams;
  const query = text(params.q, 120),
    city = text(params.mjesto, 100),
    categoryId = text(params.categoryId, 128),
    subcategoryId = text(params.subcategoryId, 128);
  const rawPage = text(params.page, 10),
    page = rawPage && /^\d{1,3}$/.test(rawPage) ? Number(rawPage) : 1;
  const featuredOnly =
    params.istaknute === "sve"
      ? "all"
      : params.istaknute === "kategorija"
        ? "category"
        : params.istaknute === "1";
  const openNow = params.otvoreno === "1";
  const blockViewer = await getSearchBlockViewer(await headers());
  const campaigns = publicPageAds({
    page: !query && (categoryId || subcategoryId) ? "category" : "search",
    city,
    categoryIds: [categoryId, subcategoryId].filter(Boolean),
    keyword: query,
    blockViewer,
  });
  let checkedAt: string | undefined, total: number | undefined;
  let items: PublicDirectoryBusiness[] = [],
    categories: DirectoryCategory[] = [],
    hasMore = false,
    available = false;
  let invalidFilters =
    Object.values(params).some(Array.isArray) ||
    (params.otvoreno !== undefined && !openNow) ||
    Boolean(rawPage && (!/^\d{1,3}$/.test(rawPage) || page < 1 || page > 500));
  try {
    const service = getPublicDirectoryService();
    if (service && !invalidFilters) {
      const [result, classification] = await Promise.all([
        service.listPublic(
          {
            q: query,
            city,
            openNow,
            ...(categoryId ? { categoryId } : {}),
            ...(subcategoryId ? { subcategoryId } : {}),
            page,
          },
          featuredOnly,
          blockViewer,
        ),
        service.categories(),
      ]);
      items = result.items;
      checkedAt = result.checkedAt;
      total = result.total;
      hasMore = result.hasMore;
      categories = classification.categories;
      available = true;
    }
  } catch (error) {
    if (error instanceof DirectoryAccessError && error.status === 400) invalidFilters = true;
  }
  function pageHref(next: number) {
    return `/pretraga${directorySearchSuffix({ ...params, page: String(next) })}`;
  }
  const sourceQuery = directorySearchSuffix(params);
  const savedQuery = canonicalSavedSearch(directorySearchSuffix({ ...params, page: undefined }));
  const activeFilters = [
    { key: "q", label: query },
    { key: "mjesto", label: city },
    { key: "categoryId", label: categories.find((item) => item.id === categoryId)?.name },
    { key: "subcategoryId", label: categories.find((item) => item.id === subcategoryId)?.name },
    { key: "otvoreno", label: openNow ? "Otvoreno sada" : "" },
    {
      key: "istaknute",
      label:
        featuredOnly === "category" ? "Istaknuto u kategoriji" : featuredOnly ? "Istaknuto" : "",
    },
  ] as const;
  const filtered = Boolean(query || city || categoryId || subcategoryId || featuredOnly || openNow);
  const candidates = (await campaigns).main;
  const inlineAd = !invalidFilters && <CampaignAd candidates={candidates} region="inline" />;
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <header className={styles.intro}>
        <h1>Pretraga djelatnosti</h1>
      </header>
      <DirectorySearchForm
        featuredOnly={featuredOnly}
        openNow={openNow}
        checkedAt={checkedAt}
        key={JSON.stringify([query, city, categoryId, subcategoryId, openNow])}
        query={query}
        city={city}
        categoryId={categoryId}
        subcategoryId={subcategoryId}
        categories={categories}
      />
      <div className={adStyles.withResults}>
        {!invalidFilters && <CampaignAd candidates={candidates} region="elsewhere" />}
        <section aria-label="Rezultati pretrage">
          <div className={styles.resultsHeading}>
            <h2>
              {filtered ? "Rezultati pretrage" : "Sve djelatnosti"}
              {total !== undefined && (
                <span className={styles.count} aria-live="polite">
                  {" "}
                  ({total})
                </span>
              )}
            </h2>
            {filtered && !invalidFilters && <Link href="/pretraga">Očisti pretragu</Link>}
            {filtered && available && savedQuery && (
              <SaveSearchButton
                key={savedQuery}
                filters={savedQuery}
                label={
                  activeFilters
                    .map((item) => item.label)
                    .filter(Boolean)
                    .join(" · ")
                    .slice(0, 100) || "Pretraga djelatnosti"
                }
              />
            )}
          </div>
          {filtered && available && (
            <ul className={styles.activeFilters} aria-label="Primijenjeni filteri">
              {activeFilters.map(({ key, label }) => {
                if (!label) return null;
                const remaining = { ...params, page: undefined, [key]: undefined };
                if (key === "categoryId") remaining.subcategoryId = undefined;
                return (
                  <li key={key}>
                    <Link
                      href={`/pretraga${directorySearchSuffix(remaining)}`}
                      aria-label={`Ukloni filter: ${label}`}
                    >
                      <span>{label}</span>
                      <span aria-hidden="true">×</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
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
              {items.map((item, index) => (
                <Fragment key={item.id}>
                  <DirectoryResultCard
                    business={publicBusinessView(item, categories)}
                    searchSuffix={sourceQuery}
                    checkedAt={checkedAt}
                  />
                  {index === Math.min(items.length, 2) - 1 && inlineAd}
                </Fragment>
              ))}
            </div>
          ) : (
            <EmptyDirectory
              filtered={filtered}
              withoutOpenFilter={
                openNow && total === 0
                  ? `/pretraga${directorySearchSuffix({ ...params, otvoreno: undefined, page: undefined })}`
                  : undefined
              }
            />
          )}
          {available && items.length === 0 && inlineAd}
          {available && (page > 1 || hasMore) && (
            <nav className={styles.pagination} aria-label="Stranice rezultata">
              {page > 1 && <Link href={pageHref(page - 1)}>Prethodna</Link>}
              <span>Stranica {page}</span>
              {hasMore && <Link href={pageHref(page + 1)}>Sljedeća</Link>}
            </nav>
          )}
        </section>
      </div>
    </main>
  );
}
