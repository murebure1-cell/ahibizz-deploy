"use client";
import { useEffect, useState } from "react";
import { accountDate } from "../../lib/display-date";
import {
  type PackageSettlementPage,
  packageSettlementStatusLabels,
  readPackageSettlements,
} from "../../lib/package-settlements";
import { checkoutEuro } from "../../lib/paypal-card-flow";
import styles from "./billing.module.css";

export function PackageSettlements({
  accountId,
  reviewOnly = false,
}: {
  accountId: string;
  reviewOnly?: boolean;
}) {
  const [open, setOpen] = useState(reviewOnly),
    [page, setPage] = useState(1),
    [data, setData] = useState<PackageSettlementPage | null>(null),
    [error, setError] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setError(false);
    setData(null);
    fetch(`/api/paketi/admin/settlements/${reviewOnly ? "review/" : ""}${page}`, {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
      headers: { "X-AhiBizz-Account-ID": accountId },
    })
      .then(async (res) => {
        if (!res.ok) throw Error();
        return readPackageSettlements(await res.json(), page);
      })
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [open, page, accountId, reviewOnly]);
  return (
    <section className={styles.production} aria-label="PayPal transakcije">
      <div>
        {!reviewOnly && (
          <button
            type="button"
            className={styles.secondary}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            PayPal transakcije paketa
          </button>
        )}
        {open && (
          <>
            {error && <p className={styles.error}>Transakcije trenutno nisu dostupne.</p>}
            {!error && !data && <p role="status">Dohvaćanje transakcija…</p>}
            {data?.page === page && (
              <>
                {data.items.length === 0 && (
                  <p>{reviewOnly ? "Nema uplata za provjeru." : "Nema transakcija."}</p>
                )}
                {data.items.map((sale) => (
                  <article className={styles.receipt} key={sale.id}>
                    <h3>{sale.businessTitle}</h3>
                    <p>
                      {checkoutEuro(sale.amountEurMinor)} ·{" "}
                      {packageSettlementStatusLabels[sale.status]} · {accountDate(sale.paidAt)}
                    </p>
                    <p>Referenca {sale.id}</p>
                    <p>
                      {sale.needsReview
                        ? "Za provjeru"
                        : sale.recorded
                          ? "U evidenciji"
                          : "Čeka knjiženje"}
                    </p>
                  </article>
                ))}
                {(page > 1 || data.more) && (
                  <div className={styles.actions}>
                    <button
                      className={styles.secondary}
                      type="button"
                      disabled={page === 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      Prethodna
                    </button>
                    <button
                      className={styles.secondary}
                      type="button"
                      disabled={!data.more || page >= 9999}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Sljedeća
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
