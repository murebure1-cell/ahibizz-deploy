"use client";
import { useState } from "react";
import { useI18n } from "../i18n/LocaleProvider";
import styles from "./business-reviews.module.css";

/**
 * "Odgovor vlasnika" under a review, as drawn. Everyone sees the answer; the owner of the business
 * (accountId given) can write, change or remove it.
 */
export function ReviewReply({
  reviewId,
  text,
  accountId,
  onSaved,
}: {
  reviewId: string;
  text: string | null;
  accountId: string | null;
  onSaved: (text: string | null) => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(text ?? ""),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  async function save(next: string) {
    if (!accountId || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch(`/api/review-replies/reviews/${reviewId}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-AhiBizz-Account-ID": accountId },
        body: JSON.stringify({ text: next }),
      });
      if (!response.ok) throw new Error("reply_not_saved");
      onSaved(next.trim() || null);
      setEditing(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  if (!text && !accountId) return null;
  return (
    <div className={styles.reply}>
      {text && !editing && (
        <>
          <strong>{t("Odgovor vlasnika")}</strong>
          <p dir="auto">{text}</p>
        </>
      )}
      {accountId && !editing && (
        <button
          type="button"
          className={styles.secondary}
          onClick={() => {
            setDraft(text ?? "");
            setEditing(true);
          }}
        >
          {text ? t("Izmijeni odgovor") : t("Odgovori")}
        </button>
      )}
      {accountId && editing && (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void save(draft);
          }}
        >
          <label className={styles.text}>
            <span>{t("Tvoj odgovor")}</span>
            <textarea
              value={draft}
              maxLength={1000}
              rows={3}
              dir="auto"
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          {failed && (
            <p role="alert" className={styles.error}>
              {t("Odgovor nije sačuvan. Pokušaj ponovo.")}
            </p>
          )}
          <div className={styles.replyActions}>
            <button type="submit" disabled={busy || !draft.trim()} className={styles.primary}>
              {t("Sačuvaj odgovor")}
            </button>
            <button
              type="button"
              disabled={busy}
              className={styles.secondary}
              onClick={() => setEditing(false)}
            >
              {t("Odustani")}
            </button>
            {text && (
              <button
                type="button"
                disabled={busy}
                className={styles.secondary}
                onClick={() => void save("")}
              >
                {t("Ukloni odgovor")}
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
