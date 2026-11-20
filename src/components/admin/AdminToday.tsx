"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { type AdminTodayRow, adminQueues, readAdminToday } from "../../lib/admin-today";
import { IS_PLAY_EDITION } from "../../lib/distribution";
import { Icon } from "../Icon";
import styles from "./admin.module.css";
import { adminActorRequest, errorMessage, responseData } from "./responses";

const dateFormat = new Intl.DateTimeFormat("bs-BA", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Sarajevo",
});
const relativeTime = new Intl.RelativeTimeFormat("bs-BA", { numeric: "always" });
function waitingSince(iso: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60_000));
  if (!minutes) return "upravo";
  if (minutes < 60) return relativeTime.format(-minutes, "minute");
  if (minutes < 1440) return relativeTime.format(-Math.floor(minutes / 60), "hour");
  return relativeTime.format(-Math.floor(minutes / 1440), "day");
}

export function AdminToday({ accountId }: { accountId: string }) {
  const [rows, setRows] = useState<AdminTodayRow[] | null>(null);
  const [error, setError] = useState("");
  const [revision, refresh] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: manual refresh requests a fresh owner-authorized snapshot.
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setRows(null);
    adminActorRequest(accountId)("/api/admin/today", { signal: controller.signal })
      .then(responseData)
      .then((data) => {
        const next = readAdminToday(data.queues);
        if (!controller.signal.aborted) setRows(next);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(errorMessage(failure));
      });
    return () => controller.abort();
  }, [accountId, revision]);
  const queues = adminQueues.filter((item) => !IS_PLAY_EDITION || item.id !== "settlements");
  return (
    <section className={styles.card} aria-label="Na čekanju">
      <div className={styles.queueHeading}>
        <h2>Na čekanju</h2>
        <button
          className={styles.secondary}
          type="button"
          disabled={!rows && !error}
          onClick={() => refresh((n) => n + 1)}
        >
          Osvježi
        </button>
      </div>
      {error ? (
        <p className={styles.notice} role="alert">
          {error}
        </p>
      ) : rows ? (
        <ul className={styles.queueRows}>
          {queues.map((item) => {
            const row = rows.find((r) => r.id === item.id);
            if (!row) return null;
            return (
              <li key={item.id}>
                <Link href={item.href} prefetch={false}>
                  <Icon name={item.icon} />
                  <span>
                    <strong>{item.title}</strong>
                    {row.oldestAt && (
                      <small>
                        {item.id === "businesses" ? "Najstarija izmjena" : "Najstariji zapis"} ·{" "}
                        <time
                          dateTime={row.oldestAt}
                          title={dateFormat.format(new Date(row.oldestAt))}
                        >
                          {waitingSince(row.oldestAt)}
                        </time>
                      </small>
                    )}
                  </span>
                  <b data-pending={row.count > 0}>{row.count}</b>
                  <Icon name="chevron" />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p role="status" className={styles.loading}>
          Dohvaćanje zahtjeva…
        </p>
      )}
    </section>
  );
}
