"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
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
    inFlight = useRef<symbol | null>(null);
  current.current = { expectedAccountId, active };
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
    setSelected(null);
    setPending(null);
    setReason("");
  }
  function failure(error: unknown) {
    if (error instanceof ReviewsClientError && (error.status === 401 || error.status === 403)) {
      setData(null);
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
  useEffect(() => {
    const run = ++epoch.current,
      controller = new AbortController();
    if (!active) return;
    const token = Symbol();
    inFlight.current = token;
    setBusy(true);
    setError("");
    void api
      .list(1, expectedAccountId, controller.signal)
      .then((v) => {
        if (run === epoch.current) {
          if (v.accountId !== expectedAccountId)
            throw new ReviewsClientError("ACCOUNT_IDENTITY_CHANGED", 401);
          setData(v);
          setSelected(null);
          setPending(null);
          setReason("");
        }
      })
      .catch((error) => {
        if (run === epoch.current && !controller.signal.aborted) {
          setData(null);
          setSelected(null);
          setPending(null);
          setReason("");
          setError(
            error instanceof ReviewsClientError && (error.status === 401 || error.status === 403)
              ? "Pristup administraciji nije dostupan. Prijavi se ponovo."
              : "Recenzije trenutno nisu dostupne.",
          );
        }
      })
      .finally(() => {
        if (inFlight.current === token) inFlight.current = null;
        if (run === epoch.current) setBusy(false);
      });
    return () => {
      epoch.current++;
      controller.abort();
      if (inFlight.current === token) inFlight.current = null;
    };
  }, [api, expectedAccountId, active]);
  async function load(page = 1) {
    if (inFlight.current || busy || !active) return;
    const token = Symbol();
    inFlight.current = token;
    const run = epoch.current;
    setBusy(true);
    setError("");
    try {
      const value = await api.list(page, expectedAccountId);
      if (valid(run)) accept(value);
    } catch (error) {
      if (valid(run)) failure(error);
    } finally {
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
    try {
      await api.moderate(command.id, command.input, expectedAccountId);
      if (!valid(run)) return;
      const next = await api.list(data.page, expectedAccountId);
      if (valid(run)) accept(next);
    } catch (error) {
      if (valid(run)) {
        failure(error);
        if (error instanceof ReviewsClientError && error.status < 500) setPending(null);
      }
    } finally {
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
