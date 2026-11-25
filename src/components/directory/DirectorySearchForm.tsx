"use client";

import Form from "next/form";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { directorySearchSuffix } from "../../lib/directory-navigation";
import { Icon } from "../Icon";
import { useT } from "../i18n/LocaleProvider";
import type { CategoryOption } from "./BusinessEditor";
import styles from "./public-search.module.css";

export function DirectorySearchForm({
  query,
  city,
  categoryId,
  subcategoryId,
  categories,
  featuredOnly = false,
  openNow = false,
  checkedAt,
}: {
  query: string;
  city: string;
  categoryId: string;
  subcategoryId: string;
  categories: CategoryOption[];
  featuredOnly?: boolean | "category" | "all";
  openNow?: boolean;
  checkedAt?: string;
}) {
  const t = useT();
  const prefix = useId();
  const [category, setCategory] = useState(categoryId);
  const [subcategory, setSubcategory] = useState(subcategoryId);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const cityField = useRef<HTMLInputElement>(null);
  const appliedFilters = [city, categoryId, subcategoryId, openNow].filter(Boolean).length;
  const router = useRouter();
  const refreshedMinute = useRef(0);
  useEffect(() => {
    if (!openNow || !checkedAt) return;
    let timeout: number;
    const update = () => {
      window.clearTimeout(timeout);
      if (document.visibilityState === "hidden") return;
      const time = Date.now();
      const minute = Math.floor(time / 60_000);
      if (
        minute > Math.floor(Date.parse(checkedAt) / 60_000) &&
        refreshedMinute.current !== minute
      ) {
        refreshedMinute.current = minute;
        router.refresh();
      }
      timeout = window.setTimeout(update, 60_000 - (time % 60_000) + 100);
    };
    update();
    document.addEventListener("visibilitychange", update);
    window.addEventListener("pageshow", update);
    return () => {
      window.clearTimeout(timeout);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("pageshow", update);
    };
  }, [openNow, checkedAt, router]);
  const children = categories.filter((item) => item.parentId === category);
  const featured =
    featuredOnly === "all" ? "sve" : featuredOnly === "category" ? "kategorija" : "1";
  // The chip switches the filter on its own, keeping every other filter as it is.
  const openNowHref = `/pretraga${directorySearchSuffix({
    q: query,
    mjesto: city,
    categoryId,
    subcategoryId,
    ...(featuredOnly ? { istaknute: featured } : {}),
    ...(openNow ? {} : { otvoreno: "1" }),
  })}`;
  return (
    <Form action="/pretraga" className={styles.form} data-design="search-form">
      {featuredOnly && <input type="hidden" name="istaknute" value={featured} />}
      {openNow && <input type="hidden" name="otvoreno" value="1" />}
      <div className={styles.bar}>
        <div className={styles.field}>
          <button type="submit" aria-label={t("Pretraži")}>
            <Icon name="search" />
          </button>
          <label htmlFor={`${prefix}-query`} className={styles.srOnly}>
            {t("Naziv ili usluga")}
          </label>
          <input
            id={`${prefix}-query`}
            name="q"
            type="search"
            defaultValue={query}
            maxLength={120}
            placeholder={t("Šta tražiš?")}
          />
        </div>
        <button
          type="button"
          className={styles.filterToggle}
          aria-controls={`${prefix}-filters`}
          aria-expanded={filtersOpen}
          aria-label={`${t("Filteri")}${appliedFilters > 0 ? ` (${appliedFilters})` : ""}`}
          onClick={() => setFiltersOpen((value) => !value)}
        >
          <Icon name="sliders" />
          {appliedFilters > 0 && <span aria-hidden="true">{appliedFilters}</span>}
        </button>
      </div>
      <div className={styles.chips}>
        <button
          type="button"
          className={styles.chip}
          data-active={Boolean(city) || undefined}
          onClick={() => {
            setFiltersOpen(true);
            // The field is in the panel that has just been opened.
            requestAnimationFrame(() => cityField.current?.focus());
          }}
        >
          <Icon name="pin" />
          <span dir="auto">{city || t("Grad")}</span>
        </button>
        <Link
          className={styles.chip}
          href={openNowHref}
          prefetch={false}
          aria-current={openNow ? "true" : undefined}
          data-on={openNow || undefined}
        >
          {t("Otvoreno sada")}
        </Link>
      </div>
      <div className={styles.filters} id={`${prefix}-filters`} data-open={filtersOpen}>
        <label htmlFor={`${prefix}-city`}>
          {t("Grad ili mjesto")}
          <input
            ref={cityField}
            id={`${prefix}-city`}
            name="mjesto"
            defaultValue={city}
            maxLength={100}
            placeholder={t("Npr. Tuzla")}
          />
        </label>
        <label htmlFor={`${prefix}-category`}>
          {t("Kategorija")}
          <select
            id={`${prefix}-category`}
            name="categoryId"
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              setSubcategory("");
            }}
          >
            <option value="">{t("Sve kategorije")}</option>
            {categories
              .filter((item) => item.parentId === null)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {t(item.name)}
                </option>
              ))}
          </select>
        </label>
        {children.length > 0 && (
          <label htmlFor={`${prefix}-subcategory`}>
            {t("Podkategorija")}
            <select
              id={`${prefix}-subcategory`}
              name="subcategoryId"
              value={subcategory}
              onChange={(event) => setSubcategory(event.target.value)}
            >
              <option value="">{t("Sve podkategorije")}</option>
              {children.map((item) => (
                <option key={item.id} value={item.id}>
                  {t(item.name)}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="submit" className={styles.apply}>
          {t("Pretraži")}
        </button>
      </div>
    </Form>
  );
}
