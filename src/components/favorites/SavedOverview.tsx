"use client";
import { useEffect, useState } from "react";
import { type ArticleCategory, articleCategories } from "../../lib/content-hub";
import type { SavedSearch } from "../../lib/saved-search";
import { useT } from "../i18n/LocaleProvider";
import { Row, RowGroup } from "../ui/Rows";
import styles from "./favorites.module.css";
import { SavedBusinesses } from "./SavedBusinesses";

type SavedArticle = { slug: string; title: string; category: ArticleCategory; minutes: number };
type Loaded<T> = { items: T[]; more: boolean } | "error" | null;

async function readJson(path: string, accountId: string, signal: AbortSignal) {
  const response = await fetch(path, {
    cache: "no-store",
    signal,
    headers: { "X-AhiBizz-Account-ID": accountId },
  });
  if (!response.ok) throw new Error(`saved_${response.status}`);
  return response.json();
}

/**
 * "Sačuvano" as drawn: chips with counts, the saved businesses with a heart each, then the saved
 * searches and the saved articles as rows.
 */
export function SavedOverview({
  active,
  expectedAccountId,
}: {
  active: boolean;
  expectedAccountId: string;
}) {
  const t = useT();
  const [businesses, setBusinesses] = useState<number | null>(null),
    [searches, setSearches] = useState<Loaded<SavedSearch>>(null),
    [articles, setArticles] = useState<Loaded<SavedArticle>>(null);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    readJson("/api/account/saved-searches", expectedAccountId, controller.signal)
      .then((value) => {
        if (value?.accountId !== expectedAccountId || !Array.isArray(value.searches))
          throw new Error("saved_searches");
        setSearches({
          items: (value.searches as SavedSearch[]).filter(
            (item) => typeof item?.filters === "string" && typeof item?.label === "string",
          ),
          more: false,
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setSearches("error");
      });
    readJson("/api/account/saved-articles", expectedAccountId, controller.signal)
      .then((value) => {
        if (!Array.isArray(value?.articles)) throw new Error("saved_articles");
        setArticles({
          items: (value.articles as SavedArticle[]).filter(
            (item) =>
              typeof item?.slug === "string" &&
              typeof item?.title === "string" &&
              Object.hasOwn(articleCategories, item.category),
          ),
          more: value.more === true,
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setArticles("error");
      });
    return () => controller.abort();
  }, [active, expectedAccountId]);

  if (!active) return null;
  const count = (value: Loaded<unknown>) =>
    value && value !== "error" ? `${value.items.length}${value.more ? "+" : ""}` : null;
  const chips = [
    { href: "#sacuvane-djelatnosti", label: t("Djelatnosti"), count: businesses?.toString() },
    { href: "#sacuvane-pretrage", label: t("Pretrage"), count: count(searches) },
    { href: "#sacuvani-clanci", label: t("Članci"), count: count(articles) },
  ];
  return (
    <div className={styles.overview}>
      <nav className={styles.chips} aria-label={t("Sačuvano")}>
        {chips.map((chip, index) => (
          <a key={chip.href} href={chip.href} data-first={index === 0 || undefined}>
            {chip.label}
            {chip.count ? ` · ${chip.count}` : ""}
          </a>
        ))}
      </nav>
      <div id="sacuvane-djelatnosti">
        <SavedBusinesses
          rows
          active={active}
          expectedAccountId={expectedAccountId}
          onCount={setBusinesses}
        />
      </div>
      <div id="sacuvane-pretrage">
        <RowGroup title={t("Sačuvane pretrage")}>
          {searches === "error" ? (
            <Row icon="search" title={t("Pretrage trenutno nisu dostupne.")} />
          ) : searches && searches.items.length === 0 ? (
            <Row
              icon="search"
              title={t("Sačuvane pretrage će se pojaviti ovdje.")}
              href="/pretraga"
            />
          ) : (
            searches?.items.map((item) => (
              <Row
                key={item.filters}
                icon="search"
                title={<span dir="auto">{item.label}</span>}
                href={`/pretraga${item.filters}`}
              />
            ))
          )}
          {searches && searches !== "error" && searches.items.length > 0 && (
            <Row icon="sliders" title={t("Uredi sačuvane pretrage")} href="/sacuvane-pretrage" />
          )}
        </RowGroup>
      </div>
      <div id="sacuvani-clanci">
        <RowGroup title={t("Članci")}>
          {articles === "error" ? (
            <Row icon="doc" title={t("Članci trenutno nisu dostupni.")} />
          ) : articles && articles.items.length === 0 ? (
            <Row icon="doc" title={t("Još nema sačuvanih članaka.")} href="/blog" />
          ) : (
            articles?.items.map((article) => (
              <Row
                key={article.slug}
                icon="doc"
                title={<span dir="auto">{article.title}</span>}
                sub={`${t(articleCategories[article.category])} · ${t("{minutes} min čitanja", {
                  minutes: article.minutes,
                })}`}
                href={`/blog/${encodeURIComponent(article.slug)}`}
              />
            ))
          )}
          {articles && articles !== "error" && articles.more && (
            <Row icon="book" title={t("Svi sačuvani članci")} href="/blog?sacuvano=1" />
          )}
        </RowGroup>
      </div>
    </div>
  );
}
