import { headers } from "next/headers";
import { redirect } from "next/navigation";
import styles from "../../../../components/account/logins.module.css";
import { Row, RowGroup, RowPill, rowStyles, ScreenBar } from "../../../../components/ui/Rows";
import { bosnianDateTime } from "../../../../lib/display-date";
import {
  listMySessions,
  MyLoginsError,
  type MySession,
  revokeMyOtherSessions,
  revokeMySession,
} from "../../../../server/auth/my-logins";
import { getAuthService } from "../../../../server/auth/service";
import { getTranslator, titled } from "../../../../server/i18n";

export const dynamic = "force-dynamic";
export const generateMetadata = titled("Aktivne prijave", {
  robots: { index: false, follow: false },
});

const path = "/nalog/prijave";
const back = "/nalog?odjeljak=postavke";
const login = `/prijava?nastavi=${encodeURIComponent(path)}`;

async function signOutOne(form: FormData) {
  "use server";
  const auth = getAuthService();
  let outcome = "odjavljeno";
  try {
    if (!auth) throw new MyLoginsError(503, "UNAVAILABLE");
    await revokeMySession(auth, await headers(), form.get("id"));
  } catch (error) {
    if (error instanceof MyLoginsError && error.status === 401) redirect(login);
    outcome = "greska";
  }
  redirect(`${path}?ishod=${outcome}`);
}

async function signOutOthers() {
  "use server";
  const auth = getAuthService();
  let outcome = "ostali";
  try {
    if (!auth) throw new MyLoginsError(503, "UNAVAILABLE");
    await revokeMyOtherSessions(auth, await headers());
  } catch (error) {
    if (error instanceof MyLoginsError && error.status === 401) redirect(login);
    outcome = "greska";
  }
  redirect(`${path}?ishod=${outcome}`);
}

/** The account's signed-in devices, with a way to sign out one or all the others. */
export default async function ActiveSignInsPage({
  searchParams,
}: {
  searchParams: Promise<{ ishod?: string }>;
}) {
  const t = await getTranslator();
  const outcome = (await searchParams).ishod;
  const auth = getAuthService();
  let sessions: MySession[] | null = null;
  if (auth) {
    try {
      sessions = await listMySessions(auth, await headers());
    } catch (error) {
      if (error instanceof MyLoginsError && error.status === 401) redirect(login);
    }
  }
  const name = (session: MySession) =>
    [session.device, session.browser].filter(Boolean).join(" · ") || t("Nepoznat uređaj");
  return (
    <main id="glavni-sadrzaj" className={rowStyles.screen}>
      <ScreenBar title={t("Aktivne prijave")} backHref={back} backLabel={t("Postavke")} />
      {outcome === "odjavljeno" && (
        <p role="status" className={styles.feedback}>
          {t("Uređaj je odjavljen.")}
        </p>
      )}
      {outcome === "ostali" && (
        <p role="status" className={styles.feedback}>
          {t("Ostali uređaji su odjavljeni.")}
        </p>
      )}
      {outcome === "greska" && (
        <p role="alert" className={styles.feedback} data-kind="error">
          {t("Odjava nije potvrđena. Osvježi stranicu i pokušaj ponovo.")}
        </p>
      )}
      {sessions ? (
        <>
          <RowGroup>
            {sessions.map((session) => (
              <Row
                key={session.id}
                icon={/iPhone|Android|iPad/.test(session.device) ? "phone" : "globe"}
                title={name(session)}
                sub={
                  session.current
                    ? t("Sada")
                    : `${t("Zadnja aktivnost")} ${bosnianDateTime(session.lastActive)}`
                }
                end={
                  session.current ? (
                    <RowPill kind="ok">{t("Ovaj uređaj")}</RowPill>
                  ) : (
                    <form action={signOutOne} className={styles.inline}>
                      <input type="hidden" name="id" value={session.id} />
                      <button type="submit" className={styles.small}>
                        {t("Odjavi")}
                      </button>
                    </form>
                  )
                }
              />
            ))}
          </RowGroup>
          {sessions.length > 1 && (
            <div className={styles.actions}>
              <form action={signOutOthers}>
                <button type="submit" className={styles.wide}>
                  {t("Odjavi sve ostale uređaje")}
                </button>
              </form>
            </div>
          )}
          <p className={styles.note}>
            {t("Ne prepoznaješ neki uređaj? Odjavi ga i promijeni lozinku.")}
          </p>
        </>
      ) : (
        <p className={styles.note}>{t("Ovo trenutno nije dostupno. Pokušaj kasnije.")}</p>
      )}
    </main>
  );
}
