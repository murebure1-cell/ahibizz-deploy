"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DirectoryCategory } from "../../server/directory/types";
import { Icon } from "../Icon";
import styles from "./admin.module.css";
import {
  type AdminRequest,
  AdminRequestError,
  accountProfile,
  adminAccessDenied,
  adminActorRequest,
  browserAdminRequest,
  category,
  categoryList,
  categorySlug,
  errorMessage,
  responseData,
} from "./responses";

type Props = { expectedAccountId?: string; request?: AdminRequest };
export function CategoryManager(props: Props) {
  return <CategoryWorkspace key={props.expectedAccountId ?? "unavailable"} {...props} />;
}
function CategoryWorkspace({ expectedAccountId, request: transport = browserAdminRequest }: Props) {
  const api = useMemo(
    () => adminActorRequest(expectedAccountId, transport),
    [expectedAccountId, transport],
  );
  const currentApi = useRef(api);
  currentApi.current = api;
  const [items, setItems] = useState<DirectoryCategory[] | null>(null);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const live = useRef(false);
  const authority = useRef(0);
  const revision = useRef(0);
  const request = useRef<AbortController | null>(null);
  const writing = useRef(false);
  const reading = useRef(false);
  const roots = (items ?? [])
    .filter((item) => item.parentId === null)
    .sort((a, b) => a.name.localeCompare(b.name, "bs"));

  const clearPrivate = useCallback((failure?: unknown) => {
    const dispatched = writing.current;
    authority.current++;
    revision.current++;
    request.current?.abort();
    writing.current = false;
    reading.current = false;
    setItems(null);
    setName("");
    setParentId("");
    setNotice("");
    setBusy(false);
    setLoading(false);
    setUncertain((previous) => (failure ? previous || dispatched : false));
    setError(failure ? errorMessage(failure) : "");
  }, []);

  const load = useCallback(async () => {
    if (writing.current) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const current = ++revision.current;
    const generation = authority.current,
      scoped = api;
    reading.current = true;
    setLoading(true);
    setError("");
    setItems(null);
    try {
      const account = await responseData(
        await scoped("/api/account", { signal: controller.signal }),
      );
      if (!accountProfile(account.account) || account.account.id !== expectedAccountId)
        throw new AdminRequestError(401, "ACCOUNT_IDENTITY_CHANGED");
      if (account.account.role !== "owner") throw new AdminRequestError(403, "OWNER_REQUIRED");
      if (
        !live.current ||
        generation !== authority.current ||
        currentApi.current !== scoped ||
        controller.signal.aborted ||
        current !== revision.current
      )
        return;
      const response = await scoped("/api/directory/categories", {
        signal: controller.signal,
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
      });
      const data = await responseData(response);
      if (
        !live.current ||
        generation !== authority.current ||
        currentApi.current !== scoped ||
        controller.signal.aborted ||
        current !== revision.current
      )
        return;
      setItems(categoryList(data));
      setUncertain(false);
    } catch (failure) {
      if (!live.current || generation !== authority.current || currentApi.current !== scoped)
        return;
      if (adminAccessDenied(failure)) {
        clearPrivate(failure);
        return;
      }
      if (live.current && !controller.signal.aborted && current === revision.current)
        setError(errorMessage(failure));
    } finally {
      if (
        live.current &&
        generation === authority.current &&
        currentApi.current === scoped &&
        current === revision.current
      ) {
        reading.current = false;
        setLoading(false);
      }
    }
  }, [api, expectedAccountId, clearPrivate]);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      authority.current++;
      revision.current++;
      request.current?.abort();
    };
  }, []);
  const previousApi = useRef(api);
  useEffect(() => {
    if (previousApi.current === api) return;
    previousApi.current = api;
    clearPrivate();
  }, [api, clearPrivate]);
  useEffect(() => {
    void load();
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
    const generation = authority.current,
      scoped = api;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await scoped("/api/directory/categories", {
        method: "POST",
        signal: controller.signal,
        credentials: "same-origin",
        redirect: "error",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await responseData(response);
      if (
        !live.current ||
        generation !== authority.current ||
        currentApi.current !== scoped ||
        controller.signal.aborted ||
        current !== revision.current
      )
        return;
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
      if (!live.current || generation !== authority.current || currentApi.current !== scoped)
        return;
      if (adminAccessDenied(failure)) {
        clearPrivate(failure);
        return;
      }
      if (live.current && !controller.signal.aborted && current === revision.current) {
        setError(errorMessage(failure));
        if (
          !(failure instanceof AdminRequestError) ||
          failure.status === 408 ||
          failure.status === 502 ||
          failure.status >= 500
        )
          setUncertain(true);
      }
    } finally {
      if (
        live.current &&
        generation === authority.current &&
        currentApi.current === scoped &&
        current === revision.current
      ) {
        writing.current = false;
        setBusy(false);
      }
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
