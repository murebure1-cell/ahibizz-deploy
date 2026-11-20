"use client";
import { useActionState } from "react";
import type { SupportTarget } from "../../lib/support-requests";
import { submitSupportRequest } from "./request-actions";
import styles from "./resources.module.css";

export function RequestForm({ actor, target }: { actor: string; target: SupportTarget }) {
  const [result, action, pending] = useActionState(submitSupportRequest, {
    sent: false,
    message: "",
  });
  const deletion = target.subject === "deletion";
  if (result.sent)
    return (
      <p className={styles.confirmed} role="status">
        {result.message}
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
          Želim trajno obrisati svoj nalog i povezane podatke.
        </label>
      ) : (
        <label>
          Razlog prijave
          <textarea name="details" required rows={4} maxLength={800} />
        </label>
      )}
      {result.message && <p role="alert">{result.message}</p>}
      <button disabled={pending} className="button button-navy" type="submit">
        {pending ? "Šaljem…" : deletion ? "Zatraži brisanje" : "Pošalji prijavu"}
      </button>
    </form>
  );
}
