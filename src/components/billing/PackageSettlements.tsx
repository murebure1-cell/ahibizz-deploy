"use client";
import { useEffect, useState } from "react";
import { checkoutEuro } from "../../lib/paypal-card-flow";
import styles from "./billing.module.css";

const statusLabel: Record<string, string> = {
  COMPLETED: "Potvrđena",
  REFUNDED: "Vraćena",
  REVERSED: "Stornirana",
  PARTIALLY_REFUNDED: "Djelimično vraćena",
};
type Sale = {
  id: string;
  businessTitle: string;
  paidAt: string;
  amountEurMinor: number;
  status: string;
  needsReview: boolean;
  recorded: boolean;
};
export function PackageSettlements({ accountId }: { accountId: string }) {
  const [open, setOpen] = useState(false),
    [page, setPage] = useState(1),
    [data, setData] = useState<{ page: number; more: boolean; items: Sale[] } | null>(null),
    [error, setError] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setError(false);
    fetch(`/api/paketi/admin/settlements/${page}`, {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
      headers: { "X-AhiBizz-Account-ID": accountId },
    })
      .then(async (res) => {
        if (!res.ok) throw Error();
        return res.json();
      })
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [open, page, accountId]);
  return (
    <section className={styles.production} aria-label="PayPal transakcije">
      <div>
        <button
          type="button"
          className={styles.secondary}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          PayPal transakcije paketa
        </button>
        {open && (
          <>
            {error && <p className={styles.error}>Transakcije trenutno nisu dostupne.</p>}
            {data?.page === page && (
              <>
                {data.items.length === 0 && <p>Nema transakcija.</p>}
                {data.items.map((sale) => (
                  <article className={styles.receipt} key={sale.id}>
                    <h3>{sale.businessTitle}</h3>
                    <p>
                      {checkoutEuro(sale.amountEurMinor)} · {statusLabel[sale.status]} ·{" "}
                      {new Intl.DateTimeFormat("bs-BA", { timeZone: "Europe/Sarajevo" }).format(
                        new Date(sale.paidAt),
                      )}
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
                      disabled={!data.more}
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
