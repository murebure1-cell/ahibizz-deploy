import { headers } from "next/headers";
import Link from "next/link";
import { DirectoryResultCard } from "../../../components/directory/DirectoryResultCard";
import { DirectorySearchForm } from "../../../components/directory/DirectorySearchForm";
import styles from "../../../components/directory/public-search.module.css";
import { EmptyDirectory } from "../../../components/EmptyDirectory";
import { SaveSearchButton } from "../../../components/favorites/SavedSearches";
import {
  type DirectorySearchParams,
  directorySearchSuffix,
} from "../../../lib/directory-navigation";
import { bosnianForm, msg } from "../../../lib/i18n/translate";
import { canonicalSavedSearch } from "../../../lib/saved-search";
import { getSearchBlockViewer } from "../../../server/account-blocks";
import {
  DirectoryAccessError,
  type DirectoryCategory,
  getPublicDirectoryService,
  type PublicDirectoryBusiness,
} from "../../../server/directory";
import { publicBusinessView } from "../../../server/directory/public-view";
import { getTranslator, titled } from "../../../server/i18n";

export const dynamic = "force-dynamic";
export const generateMetadata = titled("Istraži djelatnosti");
const text = (value: string | string[] | undefined, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<DirectorySearchParams>;
}) {
  const params = await searchParams;
  const t = await getTranslator();
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
  function categoryName(id: string) {
    const name = categories.find((item) => item.id === id)?.name;
    return name ? t(name) : undefined;
  }
  const sourceQuery = directorySearchSuffix(params);
  const savedQuery = canonicalSavedSearch(directorySearchSuffix({ ...params, page: undefined }));
  const activeFilters = [
    { key: "q", label: query },
    { key: "mjesto", label: city },
    { key: "categoryId", label: categoryName(categoryId) },
    { key: "subcategoryId", label: categoryName(subcategoryId) },
    { key: "otvoreno", label: openNow ? t("Otvoreno sada") : "" },
    {
      key: "istaknute",
      label:
        featuredOnly === "category"
          ? t("Istaknuto u kategoriji")
          : featuredOnly
            ? t("Istaknuto")
            : "",
    },
  ] as const;
  const filtered = Boolean(query || city || categoryId || subcategoryId || featuredOnly || openNow);
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <h1 className={styles.srOnly}>{t("Pretraga djelatnosti")}</h1>
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
      <div>
        <section aria-label={t("Rezultati pretrage")}>
          <div className={styles.resultsHeading}>
            <h2 aria-live="polite">
              {total === undefined
                ? filtered
                  ? t("Rezultati pretrage")
                  : t("Sve djelatnosti")
                : t(
                    bosnianForm(
                      total,
                      msg("{count} djelatnost"),
                      msg("{count} djelatnosti"),
                      msg("{count} djelatnosti"),
                    ),
                    { count: total },
                  )}
            </h2>
            <nav className={styles.viewSwitch} aria-label={t("Prikaz rezultata")}>
              <span aria-current="page">{t("Lista")}</span>
              <Link href="/mapa" prefetch={false}>
                {t("Mapa")}
              </Link>
            </nav>
          </div>
          {filtered && (!invalidFilters || (available && savedQuery)) && (
            <div className={styles.resultsActions}>
              {!invalidFilters && <Link href="/pretraga">{t("Očisti pretragu")}</Link>}
              {available && savedQuery && (
                <SaveSearchButton
                  key={savedQuery}
                  filters={savedQuery}
                  label={
                    activeFilters
                      .map((item) => item.label)
                      .filter(Boolean)
                      .join(" · ")
                      .slice(0, 100) || t(msg("Pretraga djelatnosti"))
                  }
                />
              )}
            </div>
          )}
          {filtered && available && (
            <ul className={styles.activeFilters} aria-label={t("Primijenjeni filteri")}>
              {activeFilters.map(({ key, label }) => {
                if (!label) return null;
                const remaining = { ...params, page: undefined, [key]: undefined };
                if (key === "categoryId") remaining.subcategoryId = undefined;
                return (
                  <li key={key}>
                    <Link
                      href={`/pretraga${directorySearchSuffix(remaining)}`}
                      aria-label={t("Ukloni filter: {label}", { label })}
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
              <h2>{t("Provjeri filtere pretrage.")}</h2>
              <Link className="text-link" href="/pretraga">
                {t("Poništi filtere")}
              </Link>
            </div>
          ) : !available ? (
            <div role="status" className={styles.unavailable}>
              <h2>{t("Imenik trenutno nije dostupan.")}</h2>
              <p>{t("Pokušaj ponovo kasnije.")}</p>
            </div>
          ) : items.length ? (
            <div className={styles.grid}>
              {items.map((item) => (
                <DirectoryResultCard
                  key={item.id}
                  business={publicBusinessView(item, categories)}
                  searchSuffix={sourceQuery}
                  checkedAt={checkedAt}
                />
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
          {available && (page > 1 || hasMore) && (
            <nav className={styles.pagination} aria-label={t("Stranice rezultata")}>
              {page > 1 && <Link href={pageHref(page - 1)}>{t("Prethodna")}</Link>}
              <span>{t("Stranica {page}", { page })}</span>
              {hasMore && <Link href={pageHref(page + 1)}>{t("Sljedeća")}</Link>}
            </nav>
          )}
        </section>
      </div>
    </main>
  );
}
