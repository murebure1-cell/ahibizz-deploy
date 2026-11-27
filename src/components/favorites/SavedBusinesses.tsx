"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  createFavoritesApi,
  type FavoritePage,
  type FavoritesApi,
  FavoritesClientError,
} from "../../lib/favorites";
import { safeBusinessImage } from "../../lib/public-business";
import { publicBusinessView } from "../../server/directory/public-view";
import type { DirectoryCategory } from "../../server/directory/types";
import { AhiMark } from "../AhiMark";
import { BusinessOpenStatus } from "../directory/BusinessDetails";
import { DirectoryResultCard } from "../directory/DirectoryResultCard";
import { useT } from "../i18n/LocaleProvider";
import { FavoriteButton } from "./FavoriteButton";
import { useFavorites } from "./FavoritesProvider";
import styles from "./favorites.module.css";

export function SavedBusinesses({
  active = true,
  expectedAccountId,
  api: provided,
  categories: providedCategories,
  rows = false,
  onCount,
}: {
  /** "Sačuvano" as drawn: one card with a row per business and a heart to remove it. */
  rows?: boolean;
  /** How many are saved, once the whole list fits on one page. */
  onCount?: (count: number | null) => void;
  active?: boolean;
  expectedAccountId: string;
  api?: FavoritesApi;
  categories?: DirectoryCategory[];
}) {
  const t = useT();
  const context = useFavorites(),
    api = useMemo(() => provided ?? context?.api ?? createFavoritesApi(), [provided, context?.api]),
    [data, setData] = useState<FavoritePage | null>(null),
    [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0),
    [categories, setCategories] = useState<DirectoryCategory[]>(providedCategories ?? []);
  const epoch = useRef(0),
    current = useRef({ active, expectedAccountId }),
    categoryCache = useRef(providedCategories),
    mutation = context?.mutation ?? 0;
  current.current = { active, expectedAccountId };
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh retries an explicit private read; mutation invalidates the saved list after a confirmed command.
  useLayoutEffect(() => {
    let mounted = true;
    let controller: AbortController | null = null;
    function clear(synchronous = true) {
      const run = ++epoch.current;
      controller?.abort();
      controller = null;
      const reset = () => {
        setData(null);
        setError("");
        setBusy(false);
      };
      if (synchronous) flushSync(reset);
      else reset();
      return run;
    }
    function load(synchronous = true) {
      const run = clear(synchronous);
      if (!active || document.visibilityState === "hidden") return;
      const request = new AbortController();
      controller = request;
      setBusy(true);
      void api
        .list(page, expectedAccountId, request.signal)
        .then((value) => {
          if (
            !mounted ||
            request.signal.aborted ||
            epoch.current !== run ||
            !current.current.active ||
            current.current.expectedAccountId !== expectedAccountId
          )
            return;
          if (value.accountId !== expectedAccountId || value.page !== page)
            throw new FavoritesClientError("ACCOUNT_IDENTITY_CHANGED", 401);
          setData(value);
        })
        .catch((failure) => {
          if (!mounted || request.signal.aborted || epoch.current !== run) return;
          setError(
            failure instanceof FavoritesClientError && [401, 403].includes(failure.status)
              ? t("Prijavi se ponovo za prikaz sačuvanih profila.")
              : t("Sačuvani profili trenutno nisu dostupni."),
          );
        })
        .finally(() => {
          if (mounted && epoch.current === run && !request.signal.aborted) setBusy(false);
        });
      if (!categoryCache.current)
        void fetch("/api/directory/categories", { cache: "no-store", signal: request.signal })
          .then((response) => (response.ok ? response.json() : null))
          .then((value) => {
            if (
              !mounted ||
              request.signal.aborted ||
              epoch.current !== run ||
              !Array.isArray(value?.categories)
            )
              return;
            const rows = value.categories as DirectoryCategory[];
            if (
              rows.some(
                (row) =>
                  !row ||
                  typeof row.id !== "string" ||
                  typeof row.name !== "string" ||
                  typeof row.slug !== "string" ||
                  !(row.parentId === null || typeof row.parentId === "string"),
              )
            )
              return;
            categoryCache.current = rows;
            setCategories(rows);
          })
          .catch(() => {});
    }
    const conceal = () => {
        clear();
      },
      resume = () => load(),
      visibility = () => (document.visibilityState === "hidden" ? conceal() : resume());
    window.addEventListener("blur", conceal);
    window.addEventListener("pagehide", conceal);
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", visibility);
    load(false);
    return () => {
      mounted = false;
      epoch.current++;
      controller?.abort();
      window.removeEventListener("blur", conceal);
      window.removeEventListener("pagehide", conceal);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [active, expectedAccountId, api, page, refresh, mutation]);
  useEffect(() => {
    onCount?.(data && page === 1 && !data.hasMore ? data.items.length : null);
  }, [data, page, onCount]);
  if (!active) return null;
  if (rows)
    return (
      <section className={styles.rowsWorkspace} aria-busy={busy} aria-label={t("Djelatnosti")}>
        {error && <p role="alert">{error}</p>}
        {data?.items.length === 0 ? (
          <div className={styles.rowsEmpty}>
            <p>{t("Još nema sačuvanih profila.")}</p>
            <Link href="/pretraga">{t("Istraži djelatnosti")}</Link>
          </div>
        ) : (
          data && (
            <ul className={styles.rows}>
              {data.items.map((item) => {
                const business = publicBusinessView(item, categories);
                const image = safeBusinessImage(business.logo) ?? safeBusinessImage(business.image);
                const facts = [business.subcategoryName || business.categoryName, business.city]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <li key={business.id}>
                    <Link href={`/djelatnosti/${business.id}`} className={styles.rowLink}>
                      <span className={styles.thumb} aria-hidden="true">
                        {image ? (
                          <Image src={image.src} alt="" width={88} height={88} unoptimized />
                        ) : (
                          <AhiMark size={22} />
                        )}
                      </span>
                      <span className={styles.rowText}>
                        <strong dir="auto">{business.title}</strong>
                        <small>
                          {facts}
                          <BusinessOpenStatus details={business.details} inline />
                        </small>
                      </span>
                    </Link>
                    <span className={styles.rowHeart}>
                      <FavoriteButton businessId={business.id} title={business.title} compact />
                    </span>
                  </li>
                );
              })}
            </ul>
          )
        )}
        {(page > 1 || data?.hasMore) && (
          <nav className={styles.pagination} aria-label={t("Stranice sačuvanih profila")}>
            <button
              className={styles.button}
              type="button"
              disabled={busy || page === 1}
              onClick={() => setPage((v) => v - 1)}
            >
              {t("Prethodna")}
            </button>
            <span>{page}</span>
            <button
              className={styles.button}
              type="button"
              disabled={busy || !data?.hasMore || page >= 1000}
              onClick={() => setPage((v) => v + 1)}
            >
              {t("Sljedeća")}
            </button>
          </nav>
        )}
      </section>
    );
  return (
    <section className={styles.workspace} aria-busy={busy}>
      <header className={styles.heading}>
        <h1>{t("Sačuvani profili")}</h1>
        <button
          type="button"
          className={styles.button}
          disabled={busy}
          onClick={() => setRefresh((v) => v + 1)}
        >
          {t("Osvježi")}
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      {data?.items.length === 0 && (
        <div className={styles.empty}>
          <p>{t("Još nema sačuvanih profila.")}</p>
          <Link href="/pretraga">{t("Istraži djelatnosti")}</Link>
        </div>
      )}
      <div className={styles.grid}>
        {data?.items.map((business) => (
          <DirectoryResultCard
            key={business.id}
            business={publicBusinessView(business, categories)}
          />
        ))}
      </div>
      {(page > 1 || data?.hasMore) && (
        <nav className={styles.pagination} aria-label={t("Stranice sačuvanih profila")}>
          <button
            className={styles.button}
            type="button"
            disabled={busy || page === 1}
            onClick={() => setPage((v) => v - 1)}
          >
            {t("Prethodna")}
          </button>
          <span>{page}</span>
          <button
            className={styles.button}
            type="button"
            disabled={busy || !data?.hasMore || page >= 1000}
            onClick={() => setPage((v) => v + 1)}
          >
            {t("Sljedeća")}
          </button>
        </nav>
      )}
    </section>
  );
}
