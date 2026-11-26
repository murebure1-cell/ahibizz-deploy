"use client";

import { useEffect, useRef, useState } from "react";
import { msg } from "../../lib/i18n/translate";
import {
  PersonBusinessesError,
  type PersonBusinessesPage,
  type PersonBusinessesRequest,
  personBusinessesRequest,
  readPersonBusinessesPage,
} from "../../lib/person-businesses";
import { DirectoryResultCard } from "../directory/DirectoryResultCard";
import { useT } from "../i18n/LocaleProvider";
import styles from "./person-businesses.module.css";

export function PublicPersonBusinesses({
  personId,
  request = personBusinessesRequest,
  preview = false,
  title = msg("Moje djelatnosti"),
}: {
  personId: string;
  request?: PersonBusinessesRequest;
  preview?: boolean;
  /** The heading; the profile owner's own page says "Moje djelatnosti". */
  title?: string;
}) {
  const t = useT();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PersonBusinessesPage | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const revision = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh explicitly retries a failed public read.
  useEffect(() => {
    const current = ++revision.current;
    const controller = new AbortController();
    setData(null);
    setError("");
    setLoading(true);
    if (preview && request === personBusinessesRequest) {
      setError(t("Djelatnosti nisu dostupne u ovom pregledu."));
      setLoading(false);
      return () => controller.abort();
    }
    void request(personId, page, { signal: controller.signal })
      .then((value) => {
        const next = readPersonBusinessesPage(value, page);
        if (!controller.signal.aborted && current === revision.current) setData(next);
      })
      .catch((failure) => {
        if (!controller.signal.aborted && current === revision.current)
          setError(
            failure instanceof PersonBusinessesError && failure.status === 404
              ? t("Ovaj profil nije javno dostupan.")
              : t("Djelatnosti trenutno nisu dostupne."),
          );
      })
      .finally(() => {
        if (!controller.signal.aborted && current === revision.current) setLoading(false);
      });
    return () => {
      controller.abort();
      revision.current++;
    };
  }, [personId, page, request, preview, refresh]);
  const hasMore = data?.page === page && data.hasMore;
  return (
    <section className={styles.workspace} aria-label={t(title)} aria-busy={loading}>
      <h2>{t(title)}</h2>
      {loading && <p role="status">{t("Dohvaćanje djelatnosti…")}</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => setRefresh((value) => value + 1)}>
            {t("Pokušaj ponovo")}
          </button>
        </div>
      )}
      {data?.items.length === 0 && <p>{t("Nema objavljenih djelatnosti.")}</p>}
      <div className={styles.list}>
        {data?.items.map((business) => (
          <DirectoryResultCard key={business.id} business={business} />
        ))}
      </div>
      {(page > 1 || hasMore) && (
        <nav className={styles.pagination} aria-label={t("Stranice djelatnosti")}>
          <button
            type="button"
            disabled={loading || page === 1}
            onClick={() => setPage((value) => value - 1)}
          >
            {t("Prethodna")}
          </button>
          <span>{page}</span>
          <button
            type="button"
            disabled={loading || !hasMore || page >= 999}
            onClick={() => setPage((value) => value + 1)}
          >
            {t("Sljedeća")}
          </button>
        </nav>
      )}
    </section>
  );
}
