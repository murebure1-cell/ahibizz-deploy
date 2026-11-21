"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { articleCategories, type BlogArticle, contentSearchKey } from "../../lib/content-hub";
import styles from "./content-hub.module.css";
import { saveBlogArticle } from "./editor-actions";

type EditableArticle = Omit<BlogArticle, "minutes">;
function slugSuggestion(value: string) {
  return contentSearchKey(value)
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 80)
    .replace(/^-+|-+$/g, "");
}

export function ArticleEditor({ actor, article }: { actor: string; article?: EditableArticle }) {
  const [result, action, pending] = useActionState(saveBlogArticle, { error: "" });
  const [title, setTitle] = useState(article?.title ?? "");
  const [customSlug, setCustomSlug] = useState<string | null>(article?.slug ?? null);
  const [category, setCategory] = useState<string>(article?.category ?? "vodici");
  const [excerpt, setExcerpt] = useState(article?.excerpt ?? "");
  const [body, setBody] = useState(article?.body ?? "");
  const [published, setPublished] = useState(Boolean(article?.publishedAt));
  const [featured, setFeatured] = useState(article?.featured ?? false);

  return (
    <form action={action} className={styles.editor} id="uredi">
      <h2>{article ? "Uredi članak" : "Novi članak"}</h2>
      <input type="hidden" name="actor" value={actor} />
      <input type="hidden" name="revision" value={article?.revision ?? 0} />
      <label>
        Naslov
        <input
          name="title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
          minLength={3}
          maxLength={125}
        />
      </label>
      <label>
        Oznaka za adresu članka
        <input
          name="slug"
          value={customSlug ?? slugSuggestion(title)}
          onChange={(event) => setCustomSlug(event.target.value)}
          required
          maxLength={80}
          pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
          readOnly={Boolean(article)}
          autoCapitalize="none"
          spellCheck={false}
        />
      </label>
      <label>
        Tema
        <select
          name="category"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          {Object.entries(articleCategories).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Sažetak
        <textarea
          name="excerpt"
          value={excerpt}
          onChange={(event) => setExcerpt(event.target.value)}
          rows={2}
          required
          minLength={10}
          maxLength={300}
        />
      </label>
      <label>
        Sadržaj
        <textarea
          name="body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={10}
          required
          minLength={30}
          maxLength={20000}
          placeholder="Odvoji odlomke praznim redom."
        />
      </label>
      <label>
        <input
          type="checkbox"
          name="published"
          value="yes"
          checked={published}
          onChange={(event) => setPublished(event.target.checked)}
        />
        Objavi na blogu
      </label>
      <label>
        <input
          type="checkbox"
          name="featured"
          value="yes"
          checked={published && featured}
          disabled={!published}
          onChange={(event) => setFeatured(event.target.checked)}
        />
        Izdvoji na vrhu bloga
      </label>
      {result.error && <p role="alert">{result.error}</p>}
      <div className={styles.toolRow}>
        <button type="submit" className={styles.accent} disabled={pending}>
          {pending ? "Čuvam…" : "Sačuvaj članak"}
        </button>
        {article?.publishedAt && (
          <Link href={`/blog/${article.slug}`} className={styles.secondary}>
            Otvori objavu
          </Link>
        )}
      </div>
    </form>
  );
}
