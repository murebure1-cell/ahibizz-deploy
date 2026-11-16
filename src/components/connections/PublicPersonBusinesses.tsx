"use client";

import { useEffect, useRef, useState } from "react";
import {
  PersonBusinessesError,
  type PersonBusinessesPage,
  type PersonBusinessesRequest,
  personBusinessesRequest,
  readPersonBusinessesPage,
} from "../../lib/person-businesses";
import { DirectoryResultCard } from "../directory/DirectoryResultCard";
import styles from "./person-businesses.module.css";

export function PublicPersonBusinesses({
  personId,
  request = personBusinessesRequest,
  preview = false,
}: {
  personId: string;
  request?: PersonBusinessesRequest;
  preview?: boolean;
}) {
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
      setError("Djelatnosti nisu dostupne u ovom pregledu.");
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
              ? "Ovaj profil nije javno dostupan."
              : "Djelatnosti trenutno nisu dostupne.",
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
  return (
    <section className={styles.workspace} aria-label="Moje djelatnosti" aria-busy={loading}>
      <h2>Moje djelatnosti</h2>
      {loading && <p role="status">Dohvaćanje djelatnosti…</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => setRefresh((value) => value + 1)}>
            Pokušaj ponovo
          </button>
        </div>
      )}
      {data?.items.length === 0 && <p>Nema objavljenih djelatnosti.</p>}
      <div className={styles.list}>
        {data?.items.map((business) => (
          <DirectoryResultCard key={business.id} business={business} />
        ))}
      </div>
      {data && (page > 1 || data.hasMore) && (
        <nav className={styles.pagination} aria-label="Stranice djelatnosti">
          <button
            type="button"
            disabled={loading || page === 1}
            onClick={() => setPage((value) => value - 1)}
          >
            Prethodna
          </button>
          <span>{page}</span>
          <button
            type="button"
            disabled={loading || !data.hasMore || page >= 999}
            onClick={() => setPage((value) => value + 1)}
          >
            Sljedeća
          </button>
        </nav>
      )}
    </section>
  );
}
