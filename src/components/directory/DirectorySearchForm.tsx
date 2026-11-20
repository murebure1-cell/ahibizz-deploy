"use client";

import Form from "next/form";
import { useId, useState } from "react";
import { Icon } from "../Icon";
import type { CategoryOption } from "./BusinessEditor";
import styles from "./public-search.module.css";

export function DirectorySearchForm({
  query,
  city,
  categoryId,
  subcategoryId,
  categories,
  featuredOnly = false,
}: {
  query: string;
  city: string;
  categoryId: string;
  subcategoryId: string;
  categories: CategoryOption[];
  featuredOnly?: boolean | "category";
}) {
  const prefix = useId();
  const [category, setCategory] = useState(categoryId);
  const [subcategory, setSubcategory] = useState(subcategoryId);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const appliedFilters = [city, categoryId, subcategoryId].filter(Boolean).length;
  const children = categories.filter((item) => item.parentId === category);
  return (
    <Form action="/pretraga" className={styles.form} data-design="search-form">
      {featuredOnly && (
        <input
          type="hidden"
          name="istaknute"
          value={featuredOnly === "category" ? "kategorija" : "1"}
        />
      )}
      <label htmlFor={`${prefix}-query`}>
        Naziv ili usluga
        <input
          id={`${prefix}-query`}
          name="q"
          type="search"
          defaultValue={query}
          maxLength={120}
          placeholder="Šta tražiš?"
        />
      </label>
      <button
        type="button"
        className={styles.filterToggle}
        aria-controls={`${prefix}-filters`}
        aria-expanded={filtersOpen}
        onClick={() => setFiltersOpen((value) => !value)}
      >
        <Icon name="sliders" /> Filteri{appliedFilters > 0 && ` (${appliedFilters})`}
      </button>
      <div className={styles.filters} id={`${prefix}-filters`} data-open={filtersOpen}>
        <label htmlFor={`${prefix}-city`}>
          Grad ili mjesto
          <input
            id={`${prefix}-city`}
            name="mjesto"
            defaultValue={city}
            maxLength={100}
            placeholder="Npr. Tuzla"
          />
        </label>
        <label htmlFor={`${prefix}-category`}>
          Kategorija
          <select
            id={`${prefix}-category`}
            name="categoryId"
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              setSubcategory("");
            }}
          >
            <option value="">Sve kategorije</option>
            {categories
              .filter((item) => item.parentId === null)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </label>
        <label htmlFor={`${prefix}-subcategory`}>
          Podkategorija
          <select
            id={`${prefix}-subcategory`}
            name="subcategoryId"
            value={subcategory}
            disabled={!children.length}
            onChange={(event) => setSubcategory(event.target.value)}
          >
            <option value="">Sve podkategorije</option>
            {children.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button type="submit">
        <Icon name="search" />
        Pretraži
      </button>
    </Form>
  );
}
