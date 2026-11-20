"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  type BusinessTodayData,
  businessInquiryPath,
  businessUuid,
  type CalendarKind,
  ownerCalendarPath,
} from "../../lib/business-today";
import { Icon } from "../Icon";
import styles from "./business-today.module.css";

const label: Record<CalendarKind, string> = {
  service: "Termini",
  rental: "Najam vozila",
  stay: "Smještaj",
};
const status: Record<string, string> = {
  requested: "Na čekanju",
  confirmed: "Potvrđeno",
  completed: "Održano",
};

export function BusinessToday({ accountId, active }: { accountId: string; active: boolean }) {
  const [choice, setChoice] = useState<string | null | undefined>(undefined);
  const [data, setData] = useState<BusinessTodayData | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const key = `ahibizz:today-business:${accountId}`;
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(key);
    } catch {
      /* Selection remains available in this view. */
    }
    setChoice(businessUuid(saved) ? saved : null);
  }, [key]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: retry repeats the authenticated read after a failure.
  useEffect(() => {
    if (!active || choice === undefined) return;
    let controller: AbortController | null = null;
    const load = async () => {
      if (document.visibilityState === "hidden") return;
      controller?.abort();
      const current = new AbortController();
      controller = current;
      try {
        const res = await fetch(
          `/api/account/business-today${choice ? `?djelatnost=${choice}` : ""}`,
          {
            cache: "no-store",
            credentials: "same-origin",
            mode: "same-origin",
            redirect: "error",
            headers: { "X-AhiBizz-Account-ID": accountId },
            signal: current.signal,
          },
        );
        if (current.signal.aborted) return;
        if (choice && res.status === 404) {
          try {
            sessionStorage.removeItem(key);
          } catch {}
          setData(null);
          setChoice(null);
          return;
        }
        if (!res.ok) throw new Error("unavailable");
        const next: BusinessTodayData = await res.json();
        if (
          next.accountId !== accountId ||
          (choice && choice !== next.selectedId) ||
          !Array.isArray(next.businesses) ||
          !Array.isArray(next.agendas) ||
          !next.inquiries
        )
          throw new Error("invalid");
        if (!current.signal.aborted) {
          setData(next);
          setFailed(false);
          if (choice === null && next.selectedId) {
            try {
              sessionStorage.setItem(key, next.selectedId);
            } catch {}
            setChoice(next.selectedId);
          }
        }
      } catch {
        if (!current.signal.aborted) {
          setData(null);
          setFailed(true);
        }
      }
    };
    void load();
    const interval = window.setInterval(load, 60000);
    document.addEventListener("visibilitychange", load);
    return () => {
      controller?.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", load);
    };
  }, [active, choice, accountId, key, retry]);
  if (!active) return null;
  if (failed)
    return (
      <section className={styles.panel}>
        <h2>Danas u mojoj djelatnosti</h2>
        <p role="status">
          Pregled trenutno nije dostupan.{" "}
          <button onClick={() => setRetry(retry + 1)} type="button">
            Pokušaj ponovo
          </button>
        </p>
      </section>
    );
  if (!data?.selectedId) return null;
  const businessId = data.selectedId;
  const changing = Boolean(choice && choice !== businessId);
  return (
    <section className={styles.panel} aria-label="Danas u mojoj djelatnosti" aria-busy={changing}>
      <header>
        <h2>Danas u mojoj djelatnosti</h2>
        {data.businesses.length > 1 ? (
          <select
            aria-label="Odaberi djelatnost"
            value={choice ?? businessId}
            onChange={(event) => {
              const id = event.target.value;
              try {
                sessionStorage.setItem(key, id);
              } catch {}
              setChoice(id);
            }}
          >
            {data.businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        ) : (
          <span>{data.businesses[0]?.title}</span>
        )}
      </header>
      {!changing && (
        <>
          {data.agendas.map((group) => {
            const href = ownerCalendarPath({ businessId, kind: group.kind });
            return (
              <div key={group.kind} className={styles.group}>
                <div className={styles.title}>
                  <h3>{label[group.kind]}</h3>
                  <Link href={href} prefetch={false}>
                    Kalendar <Icon name="chevron" />
                  </Link>
                </div>
                {group.total === 0 ? (
                  <p className={styles.empty}>
                    {group.kind === "service"
                      ? "Danas nema termina."
                      : group.kind === "rental"
                        ? "Danas nema najmova."
                        : "Danas nema boravaka."}
                  </p>
                ) : (
                  <ul>
                    {group.entries.map((entry) => (
                      <li key={entry.id}>
                        <span>{entry.name}</span>
                        <small>
                          {entry.time} · {status[entry.status]}
                        </small>
                      </li>
                    ))}
                  </ul>
                )}
                {group.total > group.entries.length && (
                  <Link href={href} prefetch={false}>
                    Prikaži sve ({group.total})
                  </Link>
                )}
                {group.pending > 0 && (
                  <Link
                    className={styles.request}
                    href={ownerCalendarPath({
                      businessId,
                      kind: group.kind,
                      ...(group.pendingDay ? { day: group.pendingDay } : {}),
                    })}
                    prefetch={false}
                  >
                    Za potvrdu <strong>{group.pending}</strong>
                    <Icon name="chevron" />
                  </Link>
                )}
              </div>
            );
          })}
          {data.inquiries.threadId && (
            <Link
              className={styles.request}
              href={businessInquiryPath(data.inquiries.threadId)}
              prefetch={false}
            >
              <Icon name="message" /> Nepročitani poslovni upiti{" "}
              <strong>{data.inquiries.count}</strong>
              <Icon name="chevron" />
            </Link>
          )}
        </>
      )}
    </section>
  );
}
