"use client";

import { useActionState } from "react";
import { Icon } from "../Icon";
import { bookmarkArticle } from "./blog-actions";
import styles from "./content-hub.module.css";

export function BookmarkForm({
  slug,
  actor,
  initialSaved,
}: {
  slug: string;
  actor: string;
  initialSaved: boolean;
}) {
  const [state, action, pending] = useActionState(bookmarkArticle, { saved: null, error: "" });
  const saved = state.saved ?? initialSaved;
  return (
    <form action={action} className={styles.toolRow}>
      <input type="hidden" name="actor" value={actor} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="save" value={saved ? "no" : "yes"} />
      <button type="submit" className={styles.bookmark} aria-pressed={saved} disabled={pending}>
        <Icon name={saved ? "check" : "heart"} />
        {saved ? "Ukloni iz sačuvanih" : "Sačuvaj članak"}
      </button>
      {state.error && <p role="alert">{state.error}</p>}
    </form>
  );
}
