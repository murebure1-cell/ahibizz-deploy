import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { BusinessCard } from "../../../components/preview/BusinessCard";
import { previewBusinesses } from "../../../components/preview/data";
import styles from "./search.module.css";

export const metadata: Metadata = { title: "Pretraga — pregled" };

type SearchParams = {
  q?: string | string[];
  place?: string | string[];
  category?: string | string[];
};

const text = (value: string | string[] | undefined, limit: number) =>
  typeof value === "string" ? value.trim().slice(0, limit) : "";

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("bs")
    .replace(/đ/g, "d")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const categories = [...new Set(previewBusinesses.map((business) => business.category))];

export default async function PreviewSearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const query = text(params.q, 120);
  const place = text(params.place, 80);
  const categoryInput = normalize(text(params.category, 80));
  const category = categories.find((value) => normalize(value) === categoryInput) ?? "";
  const terms = normalize(query).split(" ").filter(Boolean);
  const normalizedPlace = normalize(place);
  const businesses = previewBusinesses.filter((business) => {
    const searchable = normalize(
      [business.name, business.line, business.category, business.location].join(" "),
    );
    return (
      terms.every((term) => searchable.includes(term)) &&
      normalize(business.location).includes(normalizedPlace) &&
      (!category || business.category === category)
    );
  });
  const filters = [query && `„${query}“`, place, category].filter(Boolean);

  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <div className="preview-container">
        <Link className={styles.back} href="/pregled">
          <span aria-hidden="true">←</span> Početna pregleda
        </Link>
        <header className={styles.intro}>
          <p className={styles.eyebrow}>Istraži svoj krug</p>
          <h1>Šta tražiš?</h1>
          <p>Pretraži primjere po nazivu, usluzi, kategoriji ili mjestu.</p>
        </header>

        <Form
          action="/pregled/pretraga"
          key={JSON.stringify([query, place, category])}
          className={styles.form}
        >
          <label className={styles.field}>
            <span>Naziv ili usluga</span>
            <input
              type="search"
              name="q"
              defaultValue={query}
              maxLength={120}
              placeholder="Npr. masaža ili kafa"
            />
          </label>
          <label className={styles.field}>
            <span>Mjesto</span>
            <input
              type="text"
              name="place"
              defaultValue={place}
              maxLength={80}
              placeholder="Npr. Tuzla"
            />
          </label>
          <label className={styles.field}>
            <span>Kategorija</span>
            <select name="category" defaultValue={category}>
              <option value="">Sve kategorije</option>
              {categories.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={`preview-button ${styles.submit}`}>
            Pretraži
          </button>
        </Form>

        <section className={styles.results} aria-labelledby="search-results-title">
          <div className={`preview-section-heading ${styles.heading}`}>
            <div>
              <h2 id="search-results-title">Rezultati pretrage</h2>
              <p className={styles.summary}>
                {filters.length > 0 ? filters.join(" · ") : "Sve kategorije i mjesta"}
              </p>
            </div>
            <div className={styles.resultActions}>
              <span className={styles.count} role="status" aria-live="polite" aria-atomic="true">
                Broj rezultata: {businesses.length}
              </span>
              {filters.length > 0 && (
                <Link className={styles.reset} href="/pregled/pretraga">
                  Poništi filtere
                </Link>
              )}
            </div>
          </div>
          <p className={styles.notice}>Ovo su izmišljeni primjeri za pregled izgleda.</p>
          {businesses.length > 0 ? (
            <div className="preview-business-grid">
              {businesses.map((business) => (
                <BusinessCard key={business.id} business={business} />
              ))}
            </div>
          ) : (
            <div className={styles.empty}>
              <h3>Nema primjera za ovaj upit.</h3>
              <p>Pokušaj s drugim nazivom ili mjestom, ili ukloni filtere.</p>
              <Link href="/pregled/pretraga" className="preview-button">
                Prikaži sve primjere
              </Link>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
