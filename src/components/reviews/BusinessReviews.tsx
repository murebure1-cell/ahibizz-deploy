"use client";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { authReturnLinks } from "../../lib/auth-return";
import { localDate } from "../../lib/display-date";
import { IS_PLAY_EDITION } from "../../lib/distribution";
import { bosnianForm, msg, type Translate } from "../../lib/i18n/translate";
import { localNumber } from "../../lib/number-format";
import {
  createReviewsApi,
  type OwnReviewState,
  type ReviewPage,
  type ReviewSaveInput,
  type ReviewsApi,
  ReviewsClientError,
  type ReviewVersionInput,
} from "../../lib/reviews";
import { reportUrl } from "../../lib/support-requests";
import { useI18n } from "../i18n/LocaleProvider";
import { CommunityRulesPrompt } from "../support/CommunityRulesPrompt";
import styles from "./business-reviews.module.css";

type Pending =
  | { action: "save"; input: ReviewSaveInput }
  | { action: "withdraw"; input: ReviewVersionInput };
type PrivateDraft = {
  accountId: string;
  businessId: string;
  version: number;
  text: string;
  rating: number;
};
const empty: ReviewPage = { items: [], page: 1, hasMore: false, summary: { count: 0, sum: 0 } };
function reason(error: unknown) {
  if (error instanceof ReviewsClientError) {
    if (error.code === "VERSION_CONFLICT") return msg("Recenzija je izmijenjena. Osvježi prikaz.");
    if (error.code === "ACCOUNT_IDENTITY_CHANGED")
      return msg("Nalog je promijenjen. Osvježi prikaz.");
    if (error.code === "REVIEW_HIDDEN") return msg("Recenziju provjerava administracija.");
    if (error.status === 401) return msg("Prijavi se ponovo.");
    if (error.status === 403) return msg("Ova radnja nije dostupna tvom nalogu.");
  }
  return msg("Recenzije trenutno nisu dostupne. Pokušaj ponovo.");
}
let translateError: Translate = (text) => text;
const message = (error: unknown) => translateError(reason(error));
export function BusinessReviews({
  businessId,
  api: provided,
}: {
  businessId: string;
  api?: ReviewsApi;
}) {
  const { t, locale } = useI18n();
  translateError = t;
  const api = useMemo(() => provided ?? createReviewsApi(), [provided]),
    [page, setPage] = useState<ReviewPage>(empty),
    [own, setOwn] = useState<OwnReviewState | null>(null),
    [rating, setRating] = useState(5),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [pending, setPending] = useState<Pending | null>(null),
    [checkingOwn, setCheckingOwn] = useState(true),
    [ready, setReady] = useState(false);
  const labelId = useId(),
    current = useRef(businessId),
    generation = useRef(0),
    inFlight = useRef<symbol | null>(null),
    writing = useRef<symbol | null>(null),
    stashedDraft = useRef<PrivateDraft | null>(null),
    privateState = useRef({ own, text, rating, pending });
  current.current = businessId;
  privateState.current = { own, text, rating, pending };
  useEffect(() => {
    let active = true;
    const run = ++generation.current;
    inFlight.current = null;
    writing.current = null;
    stashedDraft.current = null;
    setPage(empty);
    setOwn(null);
    setText("");
    setRating(5);
    setPending(null);
    setBusy(false);
    setError("");
    setNotice("");
    setReady(false);
    setCheckingOwn(true);
    // Public content is independent of the actor-bound private request.
    void api
      .list(businessId)
      .then((list) => {
        if (active) {
          setPage(list);
          setReady(true);
        }
      })
      .catch((error) => {
        if (active) setError(message(error));
      });
    void api
      .own(businessId)
      .then((state) => {
        if (active && run === generation.current) {
          setOwn(state);
          setRating(state.review?.rating ?? 5);
          setText(state.review?.text ?? "");
        }
      })
      .catch((error) => {
        if (
          !(
            error instanceof ReviewsClientError &&
            (error.status === 401 || error.status === 403)
          ) &&
          active &&
          run === generation.current
        )
          setError(message(error));
      })
      .finally(() => {
        if (active && run === generation.current) setCheckingOwn(false);
      });
    return () => {
      active = false;
      generation.current++;
    };
  }, [api, businessId]);
  useEffect(() => {
    let active = true;
    function conceal() {
      const state = privateState.current;
      if (writing.current || state.pending) stashedDraft.current = null;
      else if (state.own) {
        const stored = state.own.review;
        stashedDraft.current =
          state.text !== (stored?.text ?? "") || state.rating !== (stored?.rating ?? 5)
            ? {
                accountId: state.own.accountId,
                businessId,
                version: stored?.version ?? 0,
                text: state.text,
                rating: state.rating,
              }
            : null;
      }
      const run = ++generation.current;
      inFlight.current = null;
      writing.current = null;
      // Native lifecycle events must remove the previous account's private DOM before paint.
      flushSync(() => {
        setOwn(null);
        setText("");
        setRating(5);
        setPending(null);
        setBusy(false);
        setCheckingOwn(true);
        setError("");
        setNotice("");
      });
      return run;
    }
    function revalidate() {
      const run = conceal();
      if (document.visibilityState === "hidden") return;
      const token = Symbol();
      inFlight.current = token;
      // Keep public rows visible while checking for changes made during inactivity.
      void api
        .list(businessId)
        .then((list) => {
          if (!active || current.current !== businessId || generation.current !== run) return;
          setPage(list);
          setReady(true);
        })
        .catch(() => {
          // A failed background read does not discard the last public result.
        });
      void api
        .own(businessId)
        .then((state) => {
          if (!active || current.current !== businessId || generation.current !== run) return;
          const draft = stashedDraft.current;
          stashedDraft.current = null;
          setOwn(state);
          if (
            draft &&
            draft.accountId === state.accountId &&
            draft.businessId === businessId &&
            draft.version === (state.review?.version ?? 0) &&
            state.canReview &&
            !state.review?.hidden
          ) {
            setText(draft.text);
            setRating(draft.rating);
          } else {
            setText(state.review?.text ?? "");
            setRating(state.review?.rating ?? 5);
          }
        })
        .catch((error) => {
          if (!active || current.current !== businessId || generation.current !== run) return;
          if (error instanceof ReviewsClientError && (error.status === 401 || error.status === 403))
            stashedDraft.current = null;
          else setError(message(error));
        })
        .finally(() => {
          if (inFlight.current === token) inFlight.current = null;
          if (active && current.current === businessId && generation.current === run)
            setCheckingOwn(false);
        });
    }
    const visibility = () => {
      if (document.visibilityState === "hidden") conceal();
      else revalidate();
    };
    window.addEventListener("blur", conceal);
    window.addEventListener("pagehide", conceal);
    window.addEventListener("focus", revalidate);
    window.addEventListener("pageshow", revalidate);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      active = false;
      window.removeEventListener("blur", conceal);
      window.removeEventListener("pagehide", conceal);
      window.removeEventListener("focus", revalidate);
      window.removeEventListener("pageshow", revalidate);
      document.removeEventListener("visibilitychange", visibility);
      stashedDraft.current = null;
    };
  }, [api, businessId]);
  async function refresh() {
    if (inFlight.current) return;
    const token = Symbol();
    inFlight.current = token;
    const run = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const [list, state] = await Promise.all([
        api.list(businessId),
        api.own(businessId).catch((error) => {
          if (error instanceof ReviewsClientError && (error.status === 401 || error.status === 403))
            return null;
          throw error;
        }),
      ]);
      if (current.current !== businessId || generation.current !== run) return;
      setPage(list);
      setOwn(state);
      setText(state?.review?.text ?? "");
      setRating(state?.review?.rating ?? 5);
      setPending(null);
      stashedDraft.current = null;
      setReady(true);
    } catch (error) {
      if (current.current === businessId && generation.current === run) setError(message(error));
    } finally {
      if (inFlight.current === token) inFlight.current = null;
      if (current.current === businessId && generation.current === run) setBusy(false);
    }
  }
  async function submit(action: "save" | "withdraw") {
    if (inFlight.current || busy || !own) return;
    const token = Symbol();
    inFlight.current = token;
    writing.current = token;
    const accountId = own.accountId;
    const command =
      pending ??
      (action === "save"
        ? {
            action,
            input: {
              rating,
              text: text.trim(),
              expectedVersion: own.review?.version ?? 0,
              idempotencyKey: crypto.randomUUID(),
            },
          }
        : {
            action,
            input: {
              expectedVersion: own.review?.version ?? 0,
              idempotencyKey: crypto.randomUUID(),
            },
          });
    const run = generation.current;
    setPending(command);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (command.action === "save") await api.save(businessId, command.input, accountId);
      else await api.withdraw(businessId, command.input, accountId);
      if (current.current !== businessId || generation.current !== run) return;
      const [list, state] = await Promise.all([api.list(businessId), api.own(businessId)]);
      if (current.current !== businessId || generation.current !== run) return;
      if (state.accountId !== accountId)
        throw new ReviewsClientError("ACCOUNT_IDENTITY_CHANGED", 401);
      setPage(list);
      setOwn(state);
      setText(state.review?.text ?? "");
      setRating(state.review?.rating ?? 5);
      setPending(null);
      setNotice(
        command.action === "save" ? t("Recenzija je sačuvana.") : t("Recenzija je povučena."),
      );
    } catch (error) {
      if (current.current === businessId && generation.current === run) {
        setError(message(error));
        if (error instanceof ReviewsClientError && error.status < 500) {
          setPending(null);
          if (
            error.status === 401 ||
            error.status === 403 ||
            error.code === "ACCOUNT_IDENTITY_CHANGED"
          ) {
            setOwn(null);
            setText("");
          }
        }
      }
    } finally {
      if (writing.current === token) writing.current = null;
      if (inFlight.current === token) inFlight.current = null;
      if (current.current === businessId && generation.current === run) setBusy(false);
    }
  }
  async function more() {
    if (inFlight.current || busy) return;
    const token = Symbol();
    inFlight.current = token;
    const run = generation.current;
    setBusy(true);
    setError("");
    try {
      const next = await api.list(businessId, page.page + 1);
      if (current.current !== businessId || generation.current !== run) return;
      setPage((previous) => ({
        ...next,
        items: [
          ...previous.items,
          ...next.items.filter((item) => !previous.items.some((old) => old.id === item.id)),
        ],
      }));
    } catch (error) {
      if (current.current === businessId && generation.current === run) setError(message(error));
    } finally {
      if (inFlight.current === token) inFlight.current = null;
      if (current.current === businessId && generation.current === run) setBusy(false);
    }
  }
  return (
    <section className={styles.section} aria-labelledby={labelId} id="recenzije">
      <header className={styles.heading}>
        <div>
          <h2 id={labelId}>{t("Recenzije")}</h2>
          {page.summary.count > 0 && (
            <p>
              <strong>
                {localNumber(locale, page.summary.sum / page.summary.count, {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                })}
              </strong>{" "}
              / 5{" "}
              <span>
                ·{" "}
                {t(
                  bosnianForm(
                    page.summary.count,
                    msg("{count} recenzija"),
                    msg("{count} recenzije"),
                    msg("{count} recenzija"),
                  ),
                  { count: page.summary.count },
                )}
              </span>
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={busy}
          className={styles.refresh}
          aria-label={t("Osvježi recenzije")}
        >
          ↻
        </button>
      </header>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
      {ready && page.items.length === 0 && (
        <p className={styles.empty}>{t("Još nema recenzija.")}</p>
      )}
      <div className={styles.list}>
        {page.items.map((review) => (
          <article key={review.id} className={styles.review}>
            <header className={styles.author}>
              {review.author.id && review.author.photoVersion ? (
                // biome-ignore lint/performance/noImgElement: Already normalized public avatar route; no image optimizer authentication or cache.
                <img
                  src={`/api/connections/people/${encodeURIComponent(review.author.id)}/media/photo?v=${review.author.photoVersion}`}
                  width={40}
                  height={40}
                  alt=""
                />
              ) : (
                <span className={styles.avatar} aria-hidden="true">
                  {review.author.name.slice(0, 1)}
                </span>
              )}
              <div>
                {review.author.id ? (
                  <Link href={`/ljudi/${encodeURIComponent(review.author.id)}`}>
                    <bdi>{review.author.name}</bdi>
                  </Link>
                ) : (
                  <strong dir="auto">{review.author.name}</strong>
                )}
                <time dateTime={review.createdAt}>{localDate(review.createdAt, locale)}</time>
              </div>
              <span
                className={styles.stars}
                role="img"
                aria-label={t("{value} od 5", { value: review.rating })}
              >
                {"★".repeat(review.rating)}
                <span aria-hidden="true">{"☆".repeat(5 - review.rating)}</span>
              </span>
            </header>
            <p dir="auto">{review.text}</p>
            <Link href={reportUrl("review", review.id)}>{t("Prijavi recenziju")}</Link>
          </article>
        ))}
      </div>
      {page.hasMore && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void more()}
          className={styles.secondary}
        >
          {t("Prikaži još")}
        </button>
      )}
      {ready && !checkingOwn && !own && (
        <Link
          href={authReturnLinks(`/djelatnosti/${businessId}#recenzije`).login}
          className={styles.signin}
        >
          {t("Prijavi se za recenziju")}
        </Link>
      )}
      {own && (own.canReview || (own.review && !own.review.withdrawn)) && (
        <>
          {IS_PLAY_EDITION && own.canReview && (
            <CommunityRulesPrompt key={own.accountId} actor={own.accountId} />
          )}
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              void submit(pending?.action ?? "save");
            }}
          >
            <h3>
              {own.review && !own.review.withdrawn ? t("Tvoja recenzija") : t("Napiši recenziju")}
            </h3>
            {own.review?.hidden ? (
              <p>{t("Recenziju provjerava administracija.")}</p>
            ) : own.canReview ? (
              <>
                <fieldset disabled={busy || pending !== null}>
                  <legend>{t("Ocjena")}</legend>
                  <div className={styles.rating}>
                    {[1, 2, 3, 4, 5].map((value) => (
                      <label key={value} data-selected={value <= rating}>
                        <input
                          type="radio"
                          name={`${labelId}-rating`}
                          value={value}
                          checked={rating === value}
                          onChange={() => setRating(value)}
                        />
                        <span aria-hidden="true">★</span>
                        <span className={styles.sr}>{t("{value} od 5", { value })}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className={styles.text}>
                  {t("Tvoje iskustvo")}
                  <textarea
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    maxLength={2000}
                    required
                    disabled={busy || pending !== null}
                    rows={4}
                  />
                </label>
                <button type="submit" disabled={busy || !text.trim()} className={styles.primary}>
                  {pending
                    ? t("Pokušaj ponovo")
                    : own.review && !own.review.withdrawn
                      ? t("Sačuvaj izmjene")
                      : t("Objavi recenziju")}
                </button>
              </>
            ) : null}
            {own.review && !own.review.withdrawn && (
              <button
                type="button"
                disabled={busy || (pending !== null && pending.action !== "withdraw")}
                onClick={() => void submit("withdraw")}
                className={styles.secondary}
              >
                {t("Povuci recenziju")}
              </button>
            )}
          </form>
        </>
      )}
    </section>
  );
}
