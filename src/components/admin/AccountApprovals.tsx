"use client";

import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import {
  type AdminAccountApproval,
  type AdminAccountPage,
  type AdminAccountQuery,
  adminAccountPath,
  adminAccountQuery,
  readAdminAccountDecision,
  readAdminAccountPage,
} from "../../lib/admin-accounts";
import type { SafeAccountProfile } from "../../server/auth/accounts";
import { Icon } from "../Icon";
import styles from "./admin.module.css";
import { AdminRequestError, errorMessage, responseData } from "./responses";

export type AdminAccountRequest = (path: string, init?: RequestInit) => Promise<Response>;
// Keep the native browser fetch receiver separate from the React ref used below.
const browserRequest: AdminAccountRequest = (path, init) => fetch(path, init);
type ReadState = { key: string; data: AdminAccountPage | null; loading: boolean; error: string };
const filters: { approval: AdminAccountApproval; label: string; empty: string }[] = [
  { approval: "pending", label: "Na čekanju", empty: "Nema prijava na čekanju." },
  { approval: "approved", label: "Odobreni", empty: "Nema odobrenih naloga." },
  { approval: "suspended", label: "Suspendirani", empty: "Nema suspendiranih naloga." },
];
const initialView = adminAccountQuery("pending", 1);

export function AccountApprovals({ request = browserRequest }: { request?: AdminAccountRequest }) {
  const [view, setView] = useState(initialView);
  const [search, setSearch] = useState("");
  const [inputError, setInputError] = useState("");
  const [read, setRead] = useState<ReadState>({
    key: adminAccountPath(initialView),
    data: null,
    loading: true,
    error: "",
  });
  const [pending, setPending] = useState<{ id: string; approval: "approved" | "suspended" } | null>(
    null,
  );
  const [notice, setNotice] = useState("");
  const [needsReview, setNeedsReview] = useState(false);
  const searchId = useId();
  const live = useRef(false),
    revision = useRef(0),
    readController = useRef<AbortController | null>(null),
    writeController = useRef<AbortController | null>(null),
    writing = useRef(false),
    reading = useRef(false),
    reviewRequired = useRef(false),
    api = useRef(request),
    cache = useRef(new Map<string, AdminAccountPage>());
  const key = adminAccountPath(view);
  const currentKey = useRef(key);
  currentKey.current = key;
  api.current = request;
  const data = read.key === key ? read.data : (cache.current.get(key) ?? null);
  const loading = read.key === key ? read.loading : !data;
  const error = read.key === key ? read.error : "";
  const filter = filters.find((item) => item.approval === view.approval) ?? filters[0];

  const load = useCallback(async (next: AdminAccountQuery, force = false) => {
    if (writing.current) return;
    readController.current?.abort();
    const current = ++revision.current;
    const nextKey = adminAccountPath(next);
    const cached = cache.current.get(nextKey) ?? null;
    if (cached && !force && !reviewRequired.current) {
      reading.current = false;
      setRead({ key: nextKey, data: cached, loading: false, error: "" });
      return;
    }
    const controller = new AbortController();
    readController.current = controller;
    reading.current = true;
    setRead({ key: nextKey, data: cached, loading: true, error: "" });
    try {
      const response = await api.current(nextKey, {
        signal: controller.signal,
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
      });
      const body = await responseData(response);
      let result: AdminAccountPage;
      try {
        result = readAdminAccountPage(body, next);
      } catch {
        throw new AdminRequestError(502);
      }
      if (
        !live.current ||
        controller.signal.aborted ||
        current !== revision.current ||
        currentKey.current !== nextKey
      )
        return;
      if (cache.current.size >= 12) {
        const oldest = cache.current.keys().next().value;
        if (oldest) cache.current.delete(oldest);
      }
      cache.current.set(nextKey, result);
      reviewRequired.current = false;
      setNeedsReview(false);
      setRead({ key: nextKey, data: result, loading: false, error: "" });
    } catch (failure) {
      if (
        live.current &&
        !controller.signal.aborted &&
        current === revision.current &&
        currentKey.current === nextKey
      ) {
        const accessLost =
          failure instanceof AdminRequestError &&
          (failure.status === 401 || failure.status === 403);
        if (accessLost) cache.current.clear();
        setRead({
          key: nextKey,
          data: accessLost ? null : cached,
          loading: false,
          error: errorMessage(failure),
        });
      }
    } finally {
      if (live.current && current === revision.current) reading.current = false;
    }
  }, []);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      revision.current++;
      readController.current?.abort();
      writeController.current?.abort();
      cache.current.clear();
    };
  }, []);
  useEffect(() => {
    void load(view);
  }, [load, view]);

  function changeView(next: AdminAccountQuery) {
    if (writing.current) return;
    revision.current++;
    readController.current?.abort();
    reading.current = false;
    currentKey.current = adminAccountPath(next);
    setNotice("");
    setInputError("");
    setSearch(next.q);
    setView(next);
  }
  function searchAccounts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (writing.current) return;
    try {
      const next = adminAccountQuery(view.approval, 1, search);
      if (adminAccountPath(next) === key) {
        setSearch(next.q);
        setInputError("");
        setNotice("");
        void load(next, true);
      } else changeView(next);
    } catch {
      setInputError("Provjeri unesenu pretragu.");
    }
  }

  async function decide(target: SafeAccountProfile, approval: "approved" | "suspended") {
    if (
      writing.current ||
      reading.current ||
      reviewRequired.current ||
      error ||
      !data?.accounts.some((item) => item.id === target.id && item.approval === target.approval) ||
      target.role !== "member" ||
      target.approval === approval ||
      (approval === "approved" && !target.emailVerified)
    )
      return;
    writing.current = true;
    readController.current?.abort();
    const controller = new AbortController();
    writeController.current = controller;
    const current = ++revision.current;
    setPending({ id: target.id, approval });
    setNotice("");
    setInputError("");
    let refresh = false;
    try {
      const response = await api.current(`/api/admin/accounts/${encodeURIComponent(target.id)}`, {
        method: "PATCH",
        signal: controller.signal,
        credentials: "same-origin",
        redirect: "error",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approval, expected: target.approval }),
      });
      const body = await responseData(response);
      try {
        readAdminAccountDecision(body, target.id, approval);
      } catch {
        throw new AdminRequestError(502);
      }
      if (!live.current || controller.signal.aborted || current !== revision.current) return;
      cache.current.clear();
      setNotice(
        approval === "approved"
          ? target.approval === "suspended"
            ? "Nalog je ponovo aktivan."
            : "Nalog je odobren."
          : target.approval === "pending"
            ? "Prijava je odbijena."
            : "Nalog je suspendiran.",
      );
      refresh = true;
    } catch (failure) {
      if (live.current && !controller.signal.aborted && current === revision.current) {
        cache.current.clear();
        reviewRequired.current = true;
        setNeedsReview(true);
        setRead({
          key,
          data: null,
          loading: false,
          error:
            failure instanceof AdminRequestError && [401, 403].includes(failure.status)
              ? errorMessage(failure)
              : failure instanceof AdminRequestError && failure.status === 409
                ? "Status naloga je izmijenjen. Osvježi listu."
                : "Odluka nije potvrđena. Osvježi naloge i provjeri stanje.",
        });
      }
    } finally {
      writing.current = false;
      if (live.current && current === revision.current) {
        setPending(null);
        if (refresh) void load(view, true);
      }
    }
  }

  const disabled = pending !== null || loading || needsReview || !!error;
  return (
    <section className={styles.card} aria-labelledby="admin-approval-heading">
      <div className={styles.cardHeading}>
        <div>
          <h2 id="admin-approval-heading">Nalozi</h2>
          <p>Prijave i pristup korisnika.</p>
        </div>
        <button
          className={styles.secondary}
          type="button"
          onClick={() => {
            setNotice("");
            void load(view, true);
          }}
          disabled={loading || pending !== null}
        >
          Osvježi
        </button>
      </div>
      <fieldset className={styles.accountFilters}>
        <legend>Status naloga</legend>
        {filters.map((item) => (
          <button
            key={item.approval}
            type="button"
            aria-pressed={view.approval === item.approval}
            disabled={pending !== null}
            onClick={() => changeView(adminAccountQuery(item.approval, 1, view.q))}
          >
            {item.label}
          </button>
        ))}
      </fieldset>
      <form className={styles.accountSearch} onSubmit={searchAccounts}>
        <label htmlFor={searchId}>Pretraži naloge</label>
        <div>
          <input
            id={searchId}
            type="search"
            value={search}
            maxLength={80}
            placeholder="Ime ili email"
            disabled={pending !== null}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button className={styles.secondary} type="submit" disabled={pending !== null}>
            Pretraži
          </button>
          {(search || view.q) && (
            <button
              className={styles.secondary}
              type="button"
              aria-label="Poništi pretragu"
              disabled={pending !== null}
              onClick={() => changeView(adminAccountQuery(view.approval, 1))}
            >
              <Icon name="close" />
            </button>
          )}
        </div>
      </form>
      {(inputError || error) && (
        <p className={styles.error} role="alert">
          {inputError || error}
        </p>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {loading && (
        <p className={styles.loading} role="status">
          Dohvaćanje naloga…
        </p>
      )}
      {data?.accounts.length === 0 && !loading && (
        <div className={styles.empty}>
          <Icon name="check" />
          <h3>{view.q ? "Nema rezultata pretrage." : filter?.empty}</h3>
        </div>
      )}
      <div className={styles.queue} aria-busy={loading}>
        {data?.accounts.map((account) => (
          <article key={account.id}>
            <div className={styles.person}>
              <strong>{account.name}</strong>
              <span>{account.email}</span>
              <small>{account.emailVerified ? "Email je potvrđen" : "Email nije potvrđen"}</small>
            </div>
            {account.role === "owner" ? (
              <span className={styles.accountReadOnly}>Administrator · samo pregled</span>
            ) : (
              <div className={styles.actions}>
                {account.approval !== "approved" && (
                  <button
                    className={styles.primary}
                    type="button"
                    disabled={disabled || !account.emailVerified}
                    onClick={() => void decide(account, "approved")}
                  >
                    {pending?.id === account.id && pending.approval === "approved"
                      ? "Spremanje…"
                      : account.approval === "suspended"
                        ? "Aktiviraj"
                        : "Odobri"}
                  </button>
                )}
                {account.approval !== "suspended" && (
                  <button
                    className={styles.secondary}
                    type="button"
                    disabled={disabled}
                    onClick={() => void decide(account, "suspended")}
                  >
                    {pending?.id === account.id && pending.approval === "suspended"
                      ? "Spremanje…"
                      : account.approval === "pending"
                        ? "Odbij"
                        : "Suspendiraj"}
                  </button>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
      {data && (view.page > 1 || data.hasMore) && (
        <nav className={styles.accountPagination} aria-label="Stranice naloga">
          <button
            className={styles.secondary}
            type="button"
            disabled={pending !== null || loading || view.page === 1}
            onClick={() => changeView(adminAccountQuery(view.approval, view.page - 1, view.q))}
          >
            Prethodna
          </button>
          <span>Stranica {view.page}</span>
          <button
            className={styles.secondary}
            type="button"
            disabled={pending !== null || loading || !data.hasMore || view.page === 1000}
            onClick={() => changeView(adminAccountQuery(view.approval, view.page + 1, view.q))}
          >
            Sljedeća
          </button>
        </nav>
      )}
    </section>
  );
}
