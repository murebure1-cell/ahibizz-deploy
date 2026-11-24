"use client";
import { useActionState } from "react";
import type { SupportTarget } from "../../lib/support-requests";
import { useT } from "../i18n/LocaleProvider";
import { submitSupportRequest } from "./request-actions";
import styles from "./resources.module.css";

export function RequestForm({ actor, target }: { actor: string; target: SupportTarget }) {
  const t = useT();
  const [result, action, pending] = useActionState(submitSupportRequest, {
    sent: false,
    message: "",
  });
  const deletion = target.subject === "deletion";
  if (result.sent)
    return (
      <p className={styles.confirmed} role="status">
        {t(result.message)}
      </p>
    );
  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="actor" value={actor} />
      <input type="hidden" name="subject" value={target.subject} />
      <input type="hidden" name="reference" value={target.reference} />
      {deletion ? (
        <label className={styles.choice}>
          <input name="confirm" type="checkbox" value="yes" required />
          {t("Želim trajno obrisati svoj nalog i povezane podatke.")}
        </label>
      ) : (
        <label>
          {t("Razlog prijave")}
          <textarea name="details" required rows={4} maxLength={800} />
        </label>
      )}
      {result.message && <p role="alert">{t(result.message)}</p>}
      <button disabled={pending} className="button button-navy" type="submit">
        {pending ? t("Šaljem…") : deletion ? t("Zatraži brisanje") : t("Pošalji prijavu")}
      </button>
    </form>
  );
}
