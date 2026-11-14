"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { DirectoryCategory } from "../../server/directory/types";
import { Icon } from "../Icon";
import styles from "./admin.module.css";
import {
  AdminRequestError,
  category,
  categoryList,
  categorySlug,
  errorMessage,
  responseData,
} from "./responses";

export function CategoryManager() {
  const [items, setItems] = useState<DirectoryCategory[] | null>(null);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const live = useRef(false);
  const revision = useRef(0);
  const request = useRef<AbortController | null>(null);
  const writing = useRef(false);
  const reading = useRef(false);
  const roots = (items ?? [])
    .filter((item) => item.parentId === null)
    .sort((a, b) => a.name.localeCompare(b.name, "bs"));

  const load = useCallback(async () => {
    if (writing.current) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const current = ++revision.current;
    reading.current = true;
    setLoading(true);
    setError("");
    setItems(null);
    try {
      const response = await fetch("/api/directory/categories", {
        signal: controller.signal,
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
      });
      const data = await responseData(response);
      if (!live.current || controller.signal.aborted || current !== revision.current) return;
      setItems(categoryList(data));
      setUncertain(false);
    } catch (failure) {
      if (live.current && !controller.signal.aborted && current === revision.current)
        setError(errorMessage(failure));
    } finally {
      if (live.current && current === revision.current) {
        reading.current = false;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    live.current = true;
    void load();
    return () => {
      live.current = false;
      revision.current++;
      request.current?.abort();
    };
  }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (writing.current || reading.current || uncertain || !items) return;
    const value = name.trim();
    const parent = parentId ? roots.find((item) => item.id === parentId) : null;
    if (!value || value.length > 80 || (parentId && !parent)) {
      setError("Provjeri naziv i glavnu kategoriju.");
      return;
    }
    const body = {
      name: value,
      slug: categorySlug(value, parent?.slug),
      ...(parent ? { parentId: parent.id } : {}),
    };
    writing.current = true;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const current = ++revision.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/directory/categories", {
        method: "POST",
        signal: controller.signal,
        credentials: "same-origin",
        redirect: "error",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await responseData(response);
      if (!live.current || controller.signal.aborted || current !== revision.current) return;
      const saved = data.category;
      if (
        response.status !== 201 ||
        !category(saved) ||
        saved.name !== body.name ||
        saved.slug !== body.slug ||
        saved.parentId !== (parent?.id ?? null) ||
        items.some((item) => item.id === saved.id || item.slug === saved.slug)
      )
        throw new AdminRequestError(502);
      setItems((previous) => [...(previous ?? []), saved]);
      setName("");
      setNotice(parent ? "Podkategorija je dodana." : "Glavna kategorija je dodana.");
    } catch (failure) {
      if (live.current && !controller.signal.aborted && current === revision.current) {
        setError(errorMessage(failure));
        if (
          !(failure instanceof AdminRequestError) ||
          failure.status === 502 ||
          failure.status >= 500
        )
          setUncertain(true);
      }
    } finally {
      writing.current = false;
      if (live.current && current === revision.current) setBusy(false);
    }
  }

  return (
    <div className={styles.categoryLayout}>
      <section className={styles.card} aria-labelledby="admin-category-form-heading">
        <h2 id="admin-category-form-heading">Dodaj kategoriju</h2>
        <p className={styles.help}>Glavna kategorija i jedan nivo podkategorija.</p>
        <form className={styles.categoryForm} onSubmit={save}>
          <fieldset disabled={busy || loading || !items || uncertain}>
            <label htmlFor="admin-category-name">
              Naziv
              <input
                id="admin-category-name"
                name="name"
                required
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Npr. Ljepota i zdravlje"
              />
            </label>
            <label htmlFor="admin-category-parent">
              Pripada kategoriji
              <select
                id="admin-category-parent"
                value={parentId}
                onChange={(event) => setParentId(event.target.value)}
              >
                <option value="">Nova glavna kategorija</option>
                {roots.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <button className={styles.primary} type="submit" disabled={!name.trim()}>
              {busy ? "Spremanje…" : "Dodaj kategoriju"}
              <Icon name="check" />
            </button>
          </fieldset>
        </form>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className={styles.notice} role="status">
            {notice}
          </p>
        )}
        {uncertain && (
          <p className={styles.help}>Osvježi listu i provjeri rezultat prije ponovnog unosa.</p>
        )}
      </section>
      <section className={styles.card} aria-labelledby="admin-category-list-heading">
        <div className={styles.cardHeading}>
          <h2 id="admin-category-list-heading">Kategorije</h2>
          <button
            className={styles.secondary}
            type="button"
            disabled={busy || loading}
            onClick={() => void load()}
          >
            Osvježi
          </button>
        </div>
        {loading && (
          <p className={styles.loading} role="status">
            Dohvaćanje kategorija…
          </p>
        )}
        {items?.length === 0 && (
          <div className={styles.empty}>
            <Icon name="sliders" />
            <h3>Još nema kategorija.</h3>
            <p>Počni dodavanjem glavne kategorije.</p>
          </div>
        )}
        <div className={styles.categories}>
          {roots.map((root) => (
            <article key={root.id}>
              <h3>{root.name}</h3>
              <ul>
                {items
                  ?.filter((item) => item.parentId === root.id)
                  .sort((a, b) => a.name.localeCompare(b.name, "bs"))
                  .map((child) => (
                    <li key={child.id}>{child.name}</li>
                  ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
