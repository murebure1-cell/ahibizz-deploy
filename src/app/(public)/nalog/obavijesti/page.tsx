import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Icon } from "../../../../components/Icon";
import {
  activityInboxPath,
  activityLabel,
  activityTarget,
  deviceNotificationSettingsPath,
} from "../../../../lib/activity";
import { businessUuid } from "../../../../lib/business-today";
import { markActivityRead, readActivity } from "../../../../server/account-activity";
import { AccountAccessError } from "../../../../server/auth/accounts";
import styles from "./activity.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Obavijesti" };
const clock = new Intl.DateTimeFormat("bs-BA", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Sarajevo",
});
const login = (returnPath: string) => `/prijava?nastavi=${encodeURIComponent(returnPath)}`;

async function acknowledge(accountId: string, id?: string, version?: number) {
  "use server";
  let target = activityInboxPath;
  try {
    const row = await markActivityRead(
      await headers(),
      accountId,
      id && version !== undefined ? { id, version } : undefined,
    );
    if (row) target = activityTarget(row);
  } catch (error) {
    if (error instanceof AccountAccessError && [401, 403].includes(error.status))
      redirect(login(activityInboxPath));
    redirect(`${activityInboxPath}?pokusaj=1`);
  }
  redirect(target);
}

type Query = { stranica?: string | string[]; stavka?: string | string[]; pokusaj?: string };
export default async function ActivityPage({ searchParams }: { searchParams: Promise<Query> }) {
  const params = await searchParams;
  const selected = businessUuid(params.stavka) ? params.stavka.toLowerCase() : undefined;
  const page =
    typeof params.stranica === "string" && /^[1-9]\d{0,2}$/.test(params.stranica)
      ? Number(params.stranica)
      : 1;
  const result = await readActivity(await headers(), page, selected).catch((error: unknown) => {
    if (error instanceof AccountAccessError && [401, 403].includes(error.status))
      redirect(login(selected ? `${activityInboxPath}?stavka=${selected}` : activityInboxPath));
    return null;
  });
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link href="/nalog" className="text-link">
            ← Moj nalog
          </Link>
          <h1>Obavijesti</h1>
          {result && result.unread > 0 && (
            <p>{result.unread === 100 ? "99+" : result.unread} nepročitanih</p>
          )}
        </div>
        <Link href={deviceNotificationSettingsPath} className={styles.secondary}>
          <Icon name="sliders" /> Postavke
        </Link>
      </header>
      {params.pokusaj === "1" && <p role="alert">Obavijest nije ažurirana. Pokušaj ponovo.</p>}
      {!result ? (
        <p role="status" className={styles.empty}>
          Obavijesti trenutno nisu dostupne.
        </p>
      ) : (
        <>
          {result.unread > 0 && (
            <form action={acknowledge.bind(null, result.accountId, undefined, undefined)}>
              <button type="submit" className={styles.secondary}>
                Označi sve pročitano
              </button>
            </form>
          )}
          {result.items.length ? (
            <ul className={styles.list}>
              {result.items.map((item) => (
                <li key={item.id} data-selected={item.id === selected || undefined}>
                  <form action={acknowledge.bind(null, result.accountId, item.id, item.version)}>
                    <button type="submit" className={styles.event}>
                      <span className={styles.icon}>
                        <Icon
                          name={
                            item.kind === "message"
                              ? "message"
                              : item.kind === "reel"
                                ? "play"
                                : "calendar"
                          }
                        />
                      </span>
                      <span className={styles.content}>
                        <strong>{activityLabel(item)}</strong>
                        {item.unread && <span className={styles.unread}>Novo</span>}
                        {(item.businessTitle || item.subjectName) && (
                          <span className={styles.context}>
                            {[item.businessTitle, item.subjectName].filter(Boolean).join(" · ")}
                          </span>
                        )}
                        <time dateTime={new Date(item.happenedAt).toISOString()}>
                          {clock.format(new Date(item.happenedAt))}
                        </time>
                      </span>
                      <Icon name="chevron" className={styles.arrow} />
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>Još nema obavijesti.</p>
          )}
          {(page > 1 || (page < 999 && result.hasMore)) && (
            <nav className={styles.pages} aria-label="Stranice obavijesti">
              {page > 1 && (
                <Link
                  className={styles.secondary}
                  href={`${activityInboxPath}?stranica=${page - 1}`}
                >
                  Prethodna
                </Link>
              )}
              {page < 999 && result.hasMore && (
                <Link
                  className={styles.secondary}
                  href={`${activityInboxPath}?stranica=${page + 1}`}
                >
                  Sljedeća
                </Link>
              )}
            </nav>
          )}
        </>
      )}
    </main>
  );
}
