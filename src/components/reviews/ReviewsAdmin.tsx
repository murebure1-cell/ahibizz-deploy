"use client";
import Link from "next/link";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  createReviewsAdminApi,
  type ReviewModerationItem,
  type ReviewModerationPage,
  type ReviewsAdminApi,
  ReviewsClientError,
  type ReviewVersionInput,
} from "../../lib/reviews";
import styles from "./business-reviews.module.css";

type Command = { id: string; input: ReviewVersionInput & { hidden: boolean; reason: string } };
type PrivateReason = { accountId: string; reviewId: string; version: number; reason: string };
export function ReviewsAdmin({
  api: provided,
  expectedAccountId,
  active = true,
}: {
  api?: ReviewsAdminApi;
  expectedAccountId: string;
  active?: boolean;
}) {
  const api = useMemo(() => provided ?? createReviewsAdminApi(), [provided]),
    [data, setData] = useState<ReviewModerationPage | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [reason, setReason] = useState(""),
    [selected, setSelected] = useState<ReviewModerationItem | null>(null),
    [pending, setPending] = useState<Command | null>(null);
  const epoch = useRef(0),
    current = useRef({ expectedAccountId, active }),
    inFlight = useRef<symbol | null>(null),
    writing = useRef<symbol | null>(null),
    readController = useRef<AbortController | null>(null),
    pageNumber = useRef(1),
    stashedReason = useRef<PrivateReason | null>(null),
    privateState = useRef({ data, selected, reason, pending }),
    scope = useRef({ api, expectedAccountId });
  current.current = { expectedAccountId, active };
  privateState.current = { data, selected, reason, pending };
  function valid(run: number) {
    return (
      epoch.current === run &&
      current.current.active &&
      current.current.expectedAccountId === expectedAccountId
    );
  }
  function accept(value: ReviewModerationPage) {
    if (value.accountId !== expectedAccountId)
      throw new ReviewsClientError("ACCOUNT_IDENTITY_CHANGED", 401);
    setData(value);
    pageNumber.current = value.page;
    stashedReason.current = null;
    setSelected(null);
    setPending(null);
    setReason("");
  }
  function failure(error: unknown) {
    if (error instanceof ReviewsClientError && (error.status === 401 || error.status === 403)) {
      setData(null);
      stashedReason.current = null;
      setSelected(null);
      setPending(null);
      setReason("");
      setError("Pristup administraciji nije dostupan. Prijavi se ponovo.");
    } else
      setError(
        error instanceof ReviewsClientError && error.code === "VERSION_CONFLICT"
          ? "Recenzija je izmijenjena. Osvježi prikaz."
          : "Izmjena nije potvrđena. Pokušaj ponovo.",
      );
  }
  useLayoutEffect(() => {
    let mounted = true;
    if (scope.current.api !== api || scope.current.expectedAccountId !== expectedAccountId) {
      stashedReason.current = null;
      pageNumber.current = 1;
    }
    scope.current = { api, expectedAccountId };
    function conceal(synchronous = true) {
      const state = privateState.current;
      if (writing.current || state.pending) stashedReason.current = null;
      else if (state.data && state.data.accountId === expectedAccountId && state.selected) {
        stashedReason.current = {
          accountId: state.data.accountId,
          reviewId: state.selected.id,
          version: state.selected.version,
          reason: state.reason,
        };
      }
      const run = ++epoch.current;
      readController.current?.abort();
      readController.current = null;
      inFlight.current = null;
      writing.current = null;
      const clear = () => {
        setData(null);
        setSelected(null);
        setReason("");
        setPending(null);
        setBusy(false);
        setError("");
      };
      // Conceal before native lifecycle events return; layout activation clears before paint.
      if (synchronous) flushSync(clear);
      else clear();
      return run;
    }
    function revalidate(synchronous = true) {
      const run = conceal(synchronous);
      if (!active || document.visibilityState === "hidden") return;
      const controller = new AbortController(),
        token = Symbol();
      readController.current = controller;
      inFlight.current = token;
      setBusy(true);
      void api
        .list(pageNumber.current, expectedAccountId, controller.signal)
        .then((value) => {
          if (
            !mounted ||
            controller.signal.aborted ||
            !current.current.active ||
            current.current.expectedAccountId !== expectedAccountId ||
            run !== epoch.current
          )
            return;
          if (value.accountId !== expectedAccountId)
            throw new ReviewsClientError("ACCOUNT_IDENTITY_CHANGED", 401);
          const draft = stashedReason.current;
          stashedReason.current = null;
          setData(value);
          pageNumber.current = value.page;
          const restored =
            draft?.accountId === value.accountId
              ? value.items.find(
                  (item) => item.id === draft.reviewId && item.version === draft.version,
                )
              : undefined;
          setSelected(restored ?? null);
          setReason(restored ? (draft?.reason ?? "") : "");
        })
        .catch((error) => {
          if (
            !mounted ||
            controller.signal.aborted ||
            !current.current.active ||
            current.current.expectedAccountId !== expectedAccountId ||
            run !== epoch.current
          )
            return;
          if (error instanceof ReviewsClientError && (error.status === 401 || error.status === 403))
            stashedReason.current = null;
          setError(
            error instanceof ReviewsClientError && (error.status === 401 || error.status === 403)
              ? "Pristup administraciji nije dostupan. Prijavi se ponovo."
              : "Recenzije trenutno nisu dostupne.",
          );
        })
        .finally(() => {
          if (readController.current === controller) readController.current = null;
          if (inFlight.current === token) inFlight.current = null;
          if (mounted && run === epoch.current) setBusy(false);
        });
    }
    const hide = () => conceal(),
      show = () => revalidate(),
      visibility = () => {
        if (document.visibilityState === "hidden") conceal();
        else revalidate();
      };
    revalidate(false);
    if (active) {
      window.addEventListener("blur", hide);
      window.addEventListener("pagehide", hide);
      window.addEventListener("focus", show);
      window.addEventListener("pageshow", show);
      document.addEventListener("visibilitychange", visibility);
    }
    return () => {
      mounted = false;
      epoch.current++;
      readController.current?.abort();
      readController.current = null;
      inFlight.current = null;
      writing.current = null;
      window.removeEventListener("blur", hide);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("focus", show);
      window.removeEventListener("pageshow", show);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [api, expectedAccountId, active]);
  async function load(page = 1) {
    if (inFlight.current || busy || !active) return;
    const token = Symbol();
    inFlight.current = token;
    const controller = new AbortController();
    readController.current = controller;
    const run = epoch.current;
    setBusy(true);
    setError("");
    try {
      const value = await api.list(page, expectedAccountId, controller.signal);
      if (valid(run)) accept(value);
    } catch (error) {
      if (valid(run)) failure(error);
    } finally {
      if (readController.current === controller) readController.current = null;
      if (inFlight.current === token) inFlight.current = null;
      if (valid(run)) setBusy(false);
    }
  }
  async function moderate() {
    if (
      !selected ||
      !data ||
      data.accountId !== expectedAccountId ||
      inFlight.current ||
      busy ||
      !active ||
      !reason.trim()
    )
      return;
    const token = Symbol();
    inFlight.current = token;
    writing.current = token;
    const run = epoch.current,
      command = pending ?? {
        id: selected.id,
        input: {
          hidden: !selected.hidden,
          reason: reason.trim(),
          expectedVersion: selected.version,
          idempotencyKey: crypto.randomUUID(),
        },
      };
    setPending(command);
    setBusy(true);
    setError("");
    let controller: AbortController | undefined;
    try {
      await api.moderate(command.id, command.input, expectedAccountId);
      if (!valid(run)) return;
      controller = new AbortController();
      readController.current = controller;
      const next = await api.list(data.page, expectedAccountId, controller.signal);
      if (valid(run)) accept(next);
    } catch (error) {
      if (valid(run)) {
        failure(error);
        if (error instanceof ReviewsClientError && error.status < 500) setPending(null);
      }
    } finally {
      if (readController.current === controller) readController.current = null;
      if (writing.current === token) writing.current = null;
      if (inFlight.current === token) inFlight.current = null;
      if (valid(run)) setBusy(false);
    }
  }
  if (!active) return null;
  const visible = data?.accountId === expectedAccountId ? data : null;
  return (
    <section className={styles.section}>
      <header className={styles.heading}>
        <h2>Recenzije</h2>
        <button
          type="button"
          disabled={busy}
          className={styles.secondary}
          onClick={() => void load(visible?.page ?? 1)}
        >
          Osvježi
        </button>
      </header>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {visible?.items.length === 0 && <p className={styles.empty}>Nema recenzija.</p>}
      <div className={styles.list}>
        {visible?.items.map((item) => (
          <article className={styles.review} key={item.id}>
            <header className={styles.author}>
              <Link href={`/djelatnosti/${item.businessId}`}>{item.businessTitle}</Link>
              <span className={styles.stars}>{item.rating} / 5</span>
            </header>
            <p>{item.text}</p>
            <p>
              {item.author.name}
              {item.hidden ? " · Skrivena" : ""}
              {item.withdrawn ? " · Povučena" : ""}
            </p>
            <button
              type="button"
              disabled={busy || pending !== null}
              className={styles.secondary}
              onClick={() => {
                setSelected(item);
                setReason("");
              }}
            >
              {item.hidden ? "Vrati recenziju" : "Sakrij recenziju"}
            </button>
            {selected?.id === item.id && (
              <form
                className={styles.form}
                onSubmit={(e) => {
                  e.preventDefault();
                  void moderate();
                }}
              >
                <label className={styles.text}>
                  Razlog
                  <textarea
                    required
                    maxLength={500}
                    value={reason}
                    disabled={busy || pending !== null}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                  />
                </label>
                <button type="submit" disabled={busy || !reason.trim()} className={styles.primary}>
                  {pending ? "Pokušaj ponovo" : "Potvrdi"}
                </button>
                <button
                  type="button"
                  disabled={busy || pending !== null}
                  className={styles.secondary}
                  onClick={() => setSelected(null)}
                >
                  Odustani
                </button>
              </form>
            )}
          </article>
        ))}
      </div>
      {visible && (
        <nav aria-label="Stranice recenzija" className={styles.form}>
          {visible.page > 1 && (
            <button
              type="button"
              className={styles.secondary}
              disabled={busy}
              onClick={() => void load(visible.page - 1)}
            >
              Prethodna
            </button>
          )}
          {visible.hasMore && (
            <button
              type="button"
              className={styles.secondary}
              disabled={busy}
              onClick={() => void load(visible.page + 1)}
            >
              Sljedeća
            </button>
          )}
        </nav>
      )}
    </section>
  );
}
