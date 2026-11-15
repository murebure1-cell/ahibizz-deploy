"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ConnectionAction,
  type ConnectionItem,
  type ConnectionPage,
  type ConnectionView,
  readConnectionItem,
  readRelationship,
} from "../../lib/connections";
import {
  ConnectionRequestError,
  connectionAccountRequest,
  connectionError,
  connectionRequest,
} from "../../lib/connections-client";
import { Icon } from "../Icon";
import styles from "./connections.module.css";
import { PersonAvatar, type PersonMediaUrl, personLocation } from "./PeopleSearch";

type PendingWrite = {
  path: string;
  body: string;
  id: string;
  personId: string;
  expectedVersion: number;
};
const views = [
  ["contacts", "Prijatelji"],
  ["incoming", "Primljeni zahtjevi"],
  ["outgoing", "Poslani zahtjevi"],
] as const;
const emptyMessages: Record<ConnectionView, string> = {
  contacts: "Još nemaš prijatelja na AhiBizzu.",
  incoming: "Nema novih zahtjeva.",
  outgoing: "Nema poslanih zahtjeva.",
};

export function ConnectionsPanel({
  active = true,
  heading = true,
  preview = false,
  request = connectionRequest,
  profileHref = (id: string) => `/ljudi/${encodeURIComponent(id)}`,
  peopleHref = "/ljudi",
  imageUrl,
  expectedAccountId,
}: {
  active?: boolean;
  heading?: boolean;
  preview?: boolean;
  request?: typeof connectionRequest;
  profileHref?: (id: string) => string;
  peopleHref?: string;
  imageUrl?: PersonMediaUrl;
  expectedAccountId?: string;
}) {
  const [view, setView] = useState<ConnectionView>("contacts"),
    [page, setPage] = useState(1),
    [items, setItems] = useState<ConnectionItem[]>([]),
    [hasMore, setHasMore] = useState(false),
    [ready, setReady] = useState(false),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [pending, setPending] = useState<PendingWrite | null>(null),
    [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const api = useRef(request),
    revision = useRef(0),
    controller = useRef<AbortController | null>(null),
    writing = useRef(false),
    live = useRef(false),
    actor = useRef(expectedAccountId),
    previousActor = useRef(expectedAccountId),
    accessEpoch = useRef(0),
    cache = useRef(new Map<string, ConnectionPage>());
  api.current = request;
  actor.current = expectedAccountId;
  const scopedRequest = useCallback(
    (path: string, options: RequestInit = {}) =>
      connectionAccountRequest(api.current, expectedAccountId, path, options),
    [expectedAccountId],
  );

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      revision.current++;
      controller.current?.abort();
    };
  }, []);

  const clearDeniedAccess = useCallback((failure: ConnectionRequestError) => {
    // Every in-flight read/write from before this denial loses permission to refill private state.
    accessEpoch.current++;
    revision.current++;
    controller.current?.abort();
    cache.current.clear();
    writing.current = false;
    setItems([]);
    setHasMore(false);
    setReady(false);
    setLoading(false);
    setBusy(false);
    setPending(null);
    setConfirmRemove(null);
    setNotice("");
    setError(connectionError(failure));
  }, []);

  useEffect(() => {
    if (previousActor.current !== expectedAccountId) {
      previousActor.current = expectedAccountId;
      clearDeniedAccess(new ConnectionRequestError(401, "ACCOUNT_IDENTITY_CHANGED"));
    }
  }, [clearDeniedAccess, expectedAccountId]);

  const load = useCallback(async () => {
    controller.current?.abort();
    const current = ++revision.current,
      nextController = new AbortController(),
      key = `${view}:${page}`,
      access = accessEpoch.current,
      expectedActor = expectedAccountId;
    controller.current = nextController;
    const previous = cache.current.get(key);
    setItems(previous?.items ?? []);
    setHasMore(previous?.hasMore ?? false);
    setReady(Boolean(previous));
    if (preview && api.current === connectionRequest) {
      setError("Pregled prijatelja trenutno nije dostupan.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await scopedRequest(`connections?view=${view}&page=${page}`, {
        signal: nextController.signal,
      });
      if (
        !Array.isArray(result.items) ||
        result.page !== page ||
        typeof result.hasMore !== "boolean"
      )
        throw new Error("invalid_connections_list");
      const nextItems = result.items.map(readConnectionItem);
      if (
        nextItems.some((item) =>
          view === "contacts"
            ? item.status !== "accepted"
            : item.status !== "pending" || item.direction !== view,
        )
      )
        throw new Error("invalid_connections_view");
      if (
        !live.current ||
        actor.current !== expectedActor ||
        access !== accessEpoch.current ||
        nextController.signal.aborted ||
        current !== revision.current
      )
        return;
      const next = { items: nextItems, page, hasMore: result.hasMore };
      cache.current.set(key, next);
      setItems(next.items);
      setHasMore(next.hasMore);
      setReady(true);
    } catch (failure) {
      if (!live.current || actor.current !== expectedActor || access !== accessEpoch.current)
        return;
      if (
        failure instanceof ConnectionRequestError &&
        (failure.status === 401 || failure.status === 403)
      ) {
        clearDeniedAccess(failure);
        return;
      }
      if (!nextController.signal.aborted && current === revision.current)
        setError(connectionError(failure));
    } finally {
      if (
        live.current &&
        actor.current === expectedActor &&
        access === accessEpoch.current &&
        current === revision.current
      )
        setLoading(false);
    }
  }, [page, preview, view, clearDeniedAccess, scopedRequest, expectedAccountId]);

  useEffect(() => {
    if (active) void load();
    return () => {
      revision.current++;
      controller.current?.abort();
    };
  }, [active, load]);

  async function send(intent: PendingWrite) {
    if (writing.current || (preview && api.current === connectionRequest)) return;
    const access = accessEpoch.current,
      expectedActor = expectedAccountId;
    writing.current = true;
    revision.current++;
    controller.current?.abort();
    setBusy(true);
    setError("");
    setNotice("");
    setConfirmRemove(null);
    setPending(intent);
    try {
      const result = await scopedRequest(intent.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: intent.body,
      });
      const next = readRelationship(result.relationship);
      if (
        next.id !== intent.id ||
        next.personId !== intent.personId ||
        next.version <= intent.expectedVersion
      )
        throw new Error("unconfirmed_connection_action");
      if (live.current && actor.current === expectedActor && access === accessEpoch.current) {
        setPending(null);
        cache.current.clear();
        setNotice("Prijateljstva su ažurirana.");
        await load();
      }
    } catch (failure) {
      if (live.current && actor.current === expectedActor && access === accessEpoch.current) {
        if (
          failure instanceof ConnectionRequestError &&
          (failure.status === 401 || failure.status === 403)
        ) {
          clearDeniedAccess(failure);
          return;
        }
        setError(connectionError(failure));
        if (
          failure instanceof ConnectionRequestError &&
          failure.status >= 400 &&
          failure.status < 500
        ) {
          setPending(null);
          if (failure.status === 409) {
            cache.current.clear();
            await load();
            if (live.current && actor.current === expectedActor && access === accessEpoch.current)
              setNotice("Zahtjev je izmijenjen. Prikaz je osvježen.");
          }
        }
      }
    } finally {
      if (actor.current === expectedActor && access === accessEpoch.current) {
        writing.current = false;
        if (live.current) setBusy(false);
      }
    }
  }

  function act(item: ConnectionItem, action: ConnectionAction) {
    if (!item.id || busy || pending) return;
    if (action === "remove" && confirmRemove !== item.id) {
      setConfirmRemove(item.id);
      return;
    }
    void send({
      path: `connections/${encodeURIComponent(item.id)}/${action}`,
      body: JSON.stringify({ expectedVersion: item.version, idempotencyKey: crypto.randomUUID() }),
      id: item.id,
      personId: item.personId,
      expectedVersion: item.version,
    });
  }

  function switchView(next: ConnectionView) {
    if (busy || pending || next === view) return;
    const previous = cache.current.get(`${next}:1`);
    setItems(previous?.items ?? []);
    setReady(Boolean(previous));
    setHasMore(previous?.hasMore ?? false);
    setLoading(true);
    setView(next);
    setPage(1);
    setConfirmRemove(null);
    setNotice("");
  }

  function switchPage(next: number) {
    if (disabled || next < 1) return;
    const previous = cache.current.get(`${view}:${next}`);
    setItems(previous?.items ?? []);
    setReady(Boolean(previous));
    setHasMore(previous?.hasMore ?? false);
    setLoading(true);
    setConfirmRemove(null);
    setPage(next);
  }

  const disabled = busy || loading || pending !== null;
  return (
    <section className={styles.workspace} aria-label="Prijatelji">
      <div className={styles.heading}>
        {heading && <h2>Prijatelji</h2>}
        <Link className={styles.secondary} href={peopleHref}>
          <Icon name="search" /> Pronađi ljude
        </Link>
      </div>
      <fieldset className={styles.tabs}>
        <legend className={styles.visuallyHidden}>Pregled prijateljstava</legend>
        {views.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={view === key}
            disabled={busy || pending !== null}
            onClick={() => switchView(key)}
          >
            {label}
          </button>
        ))}
      </fieldset>
      {error && (
        <div className={styles.error} role="alert">
          <p>{error}</p>
          <button
            type="button"
            className={styles.secondary}
            disabled={busy || loading}
            onClick={() => (pending ? void send(pending) : void load())}
          >
            Pokušaj ponovo
          </button>
        </div>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {!ready && !error && (
        <section className={styles.skeleton} aria-busy="true" aria-label="Prijateljstva">
          <span />
          <span />
          <span />
        </section>
      )}
      {ready && items.length === 0 && !loading && (
        <div className={styles.empty}>
          <Icon name="user" />
          <h3>{emptyMessages[view]}</h3>
          {view === "contacts" && (
            <Link className={styles.secondary} href={peopleHref}>
              Pronađi ljude
            </Link>
          )}
        </div>
      )}
      {ready && items.length > 0 && (
        <ul className={styles.connectionList} aria-busy={loading || busy}>
          {items.map((item) => (
            <li key={item.id} className={styles.connectionCard}>
              <div className={styles.connectionIdentity}>
                {item.person ? (
                  <PersonAvatar person={item.person} imageUrl={imageUrl} />
                ) : (
                  <div className={styles.avatar} aria-hidden="true">
                    <Icon name="user" />
                  </div>
                )}
                <div className={styles.personInfo}>
                  <h3>
                    {item.person ? (
                      <Link href={profileHref(item.person.id)}>{item.person.name}</Link>
                    ) : (
                      "Profil nije javno dostupan"
                    )}
                  </h3>
                  {item.person && personLocation(item.person) && (
                    <p className={styles.location}>{personLocation(item.person)}</p>
                  )}
                </div>
              </div>
              <div className={styles.actions}>
                {view === "incoming" ? (
                  <>
                    {item.person && (
                      <button
                        type="button"
                        className={styles.primary}
                        disabled={disabled}
                        onClick={() => act(item, "accept")}
                      >
                        <Icon name="check" /> Prihvati
                      </button>
                    )}
                    <button
                      type="button"
                      className={styles.secondary}
                      disabled={disabled}
                      onClick={() => act(item, "decline")}
                    >
                      Odbij
                    </button>
                  </>
                ) : view === "outgoing" ? (
                  <button
                    type="button"
                    className={styles.secondary}
                    disabled={disabled}
                    onClick={() => act(item, "cancel")}
                  >
                    Povuci zahtjev
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className={
                        confirmRemove === item.id ? styles.dangerButton : styles.quietButton
                      }
                      disabled={disabled}
                      onClick={() => act(item, "remove")}
                    >
                      {confirmRemove === item.id ? "Potvrdi uklanjanje" : "Ukloni"}
                    </button>
                    {confirmRemove === item.id && (
                      <button
                        type="button"
                        className={styles.secondary}
                        disabled={disabled}
                        onClick={() => setConfirmRemove(null)}
                      >
                        Odustani
                      </button>
                    )}
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {ready && (page > 1 || hasMore) && (
        <nav className={styles.pagination} aria-label="Stranice prijateljstava">
          <button
            type="button"
            className={styles.secondary}
            disabled={disabled || page === 1}
            onClick={() => switchPage(page - 1)}
          >
            Prethodna
          </button>
          <span>{page}</span>
          <button
            type="button"
            className={styles.secondary}
            disabled={disabled || !hasMore}
            onClick={() => switchPage(page + 1)}
          >
            Sljedeća
          </button>
        </nav>
      )}
    </section>
  );
}
