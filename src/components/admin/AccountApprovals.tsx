"use client";

import { type FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
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
import { profileInitials } from "../people/PersonalProfileCard";
import { AccountPackage } from "./AccountPackage";
import look from "./account-approvals.module.css";
import styles from "./admin.module.css";
import { ProfileVerification } from "./ProfileVerification";
import {
  type AdminRequest,
  AdminRequestError,
  adminAccessDenied,
  adminActorRequest,
  browserAdminRequest,
  errorMessage,
  responseData,
} from "./responses";

export type AdminAccountRequest = AdminRequest;
type ReadState = { key: string; data: AdminAccountPage | null; loading: boolean; error: string };
const filters: { approval: AdminAccountApproval; label: string; empty: string }[] = [
  { approval: "pending", label: "Na čekanju", empty: "Nema prijava na čekanju." },
  { approval: "approved", label: "Odobreni", empty: "Nema odobrenih naloga." },
  { approval: "suspended", label: "Suspendirani", empty: "Nema suspendiranih naloga." },
];
const initialView = adminAccountQuery("pending", 1);

type Props = {
  request?: AdminAccountRequest;
  expectedAccountId?: string;
  embedded?: boolean;
  readyOnly?: boolean;
  active?: boolean;
};
export function AccountApprovals(props: Props) {
  return <ApprovalWorkspace key={props.expectedAccountId ?? "unavailable"} {...props} />;
}
function ApprovalWorkspace({
  request = browserAdminRequest,
  expectedAccountId,
  embedded = false,
  readyOnly = false,
  active = true,
}: Props) {
  const scopedRequest = useMemo(
    () => adminActorRequest(expectedAccountId, request),
    [expectedAccountId, request],
  );
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
    authority = useRef(0),
    revision = useRef(0),
    readController = useRef<AbortController | null>(null),
    writeController = useRef<AbortController | null>(null),
    writing = useRef(false),
    reading = useRef(false),
    reviewRequired = useRef(false),
    api = useRef(scopedRequest),
    cache = useRef(new Map<string, AdminAccountPage>());
  const key = adminAccountPath(view);
  const currentKey = useRef(key);
  currentKey.current = key;
  api.current = scopedRequest;
  const data = read.key === key ? read.data : (cache.current.get(key) ?? null);
  const loading = read.key === key ? read.loading : !data;
  const error = read.key === key ? read.error : "";
  const filter = filters.find((item) => item.approval === view.approval) ?? filters[0];

  const clearPrivate = useCallback((failure?: unknown) => {
    authority.current++;
    revision.current++;
    readController.current?.abort();
    writeController.current?.abort();
    writeController.current = null;
    cache.current.clear();
    reading.current = false;
    writing.current = false;
    reviewRequired.current = Boolean(failure);
    setNeedsReview(Boolean(failure));
    setPending(null);
    setNotice("");
    setInputError("");
    setSearch("");
    setRead({
      key: currentKey.current,
      data: null,
      loading: false,
      error: failure ? errorMessage(failure) : "",
    });
  }, []);

  const load = useCallback(
    async (next: AdminAccountQuery, force = false) => {
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
      const generation = authority.current,
        transport = scopedRequest;
      readController.current = controller;
      reading.current = true;
      setRead({ key: nextKey, data: cached, loading: true, error: "" });
      try {
        const path = readyOnly ? nextKey.replace("/accounts?", "/accounts/ready?") : nextKey;
        const response = await transport(path, {
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
          generation !== authority.current ||
          api.current !== transport ||
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
        if (!live.current || generation !== authority.current || api.current !== transport) return;
        if (adminAccessDenied(failure)) {
          clearPrivate(failure);
          return;
        }
        if (
          live.current &&
          !controller.signal.aborted &&
          current === revision.current &&
          currentKey.current === nextKey
        ) {
          setRead({
            key: nextKey,
            data: cached,
            loading: false,
            error: errorMessage(failure),
          });
        }
      } finally {
        if (
          live.current &&
          generation === authority.current &&
          api.current === transport &&
          current === revision.current
        )
          reading.current = false;
      }
    },
    [scopedRequest, clearPrivate, readyOnly],
  );

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      authority.current++;
      revision.current++;
      readController.current?.abort();
      writeController.current?.abort();
      cache.current.clear();
    };
  }, []);
  const previousApi = useRef(scopedRequest);
  useEffect(() => {
    if (previousApi.current === scopedRequest) return;
    previousApi.current = scopedRequest;
    clearPrivate();
  }, [scopedRequest, clearPrivate]);
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
    const generation = authority.current,
      transport = scopedRequest;
    writeController.current = controller;
    const current = ++revision.current;
    setPending({ id: target.id, approval });
    setNotice("");
    setInputError("");
    let refresh = false;
    try {
      const response = await transport(`/api/admin/accounts/${encodeURIComponent(target.id)}`, {
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
      if (
        !live.current ||
        generation !== authority.current ||
        api.current !== transport ||
        controller.signal.aborted ||
        current !== revision.current
      )
        return;
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
      if (!live.current || generation !== authority.current || api.current !== transport) return;
      if (adminAccessDenied(failure)) {
        clearPrivate(failure);
        return;
      }
      if (live.current && !controller.signal.aborted && current === revision.current) {
        cache.current.clear();
        reviewRequired.current = true;
        setNeedsReview(true);
        setRead({
          key,
          data: null,
          loading: false,
          error:
            failure instanceof AdminRequestError && failure.status === 409
              ? "Status naloga je izmijenjen. Osvježi listu."
              : "Odluka nije potvrđena. Osvježi naloge i provjeri stanje.",
        });
      }
    } finally {
      if (writeController.current === controller) {
        writeController.current = null;
        writing.current = false;
        if (
          live.current &&
          generation === authority.current &&
          api.current === transport &&
          current === revision.current
        ) {
          setPending(null);
          if (refresh) void load(view, true);
        }
      }
    }
  }

  const disabled = pending !== null || loading || needsReview || !!error;
  return (
    <section
      className={styles.card}
      aria-label={embedded ? "Nalozi" : undefined}
      aria-labelledby={embedded ? undefined : "admin-approval-heading"}
    >
      <div className={embedded ? styles.cardToolbar : styles.cardHeading}>
        {!embedded && (
          <div>
            <h2 id="admin-approval-heading">Nalozi</h2>
            <p>Prijave i pristup korisnika.</p>
          </div>
        )}
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
      {!readyOnly && (
        <fieldset className={`${styles.accountFilters} ${look.chips}`}>
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
      )}
      <form className={`${styles.accountSearch} ${look.search}`} onSubmit={searchAccounts}>
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
      {view.approval === "pending" && !readyOnly && !!data?.accounts.length && (
        // "Danas" counts only accounts that can be approved now; this list also shows the rest.
        <p className={styles.notice}>
          Odobriti možeš samo nalog s potvrđenim emailom. Ostali čekaju da korisnik otvori link iz
          emaila za potvrdu.
        </p>
      )}
      <div className={`${styles.queue} ${look.list}`} aria-busy={loading}>
        {data?.accounts.map((account) => (
          <article key={account.id} className={look.item}>
            <div className={look.who}>
              <span className={look.avatar} aria-hidden="true">
                {profileInitials(account.name)}
              </span>
              <span className={look.whoText}>
                <strong>{account.name}</strong>
                <span>{account.email}</span>
              </span>
            </div>
            <div className={look.pills}>
              <span data-kind={account.emailVerified ? "ok" : "wait"}>
                {account.emailVerified ? "Email potvrđen" : "Email nije potvrđen"}
              </span>
              <span
                data-kind={
                  account.approval === "approved"
                    ? "ok"
                    : account.approval === "suspended"
                      ? "bad"
                      : "off"
                }
              >
                {account.role === "owner"
                  ? "Administracija"
                  : account.approval === "approved"
                    ? "Odobren"
                    : account.approval === "suspended"
                      ? "Odbijen ili suspendovan"
                      : "Čeka odobrenje"}
              </span>
            </div>
            <div className={`${styles.actions} ${look.actions}`}>
              {expectedAccountId && active && (
                <ProfileVerification
                  kind="person"
                  id={account.id}
                  actorId={expectedAccountId}
                  request={request}
                  disabled={disabled}
                  canGrant={account.emailVerified && account.approval === "approved"}
                  onAccessDenied={clearPrivate}
                />
              )}
              {account.role === "owner" ? (
                <span className={styles.accountReadOnly}>Administrator</span>
              ) : (
                <>
                  {expectedAccountId && active && account.approval === "approved" && (
                    <AccountPackage
                      id={account.id}
                      actorId={expectedAccountId}
                      request={request}
                      disabled={disabled}
                      onAccessDenied={clearPrivate}
                    />
                  )}
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
                </>
              )}
            </div>
          </article>
        ))}
      </div>
      <p className={look.note}>
        <Icon name="info" aria-hidden="true" />
        Svaki nalog odobrava se ručno, i onaj s Google prijavom.
      </p>
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
