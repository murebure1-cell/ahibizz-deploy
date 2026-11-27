import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import styles from "../../../../components/account/logins.module.css";
import { Row, RowGroup, RowPill, rowStyles, ScreenBar } from "../../../../components/ui/Rows";
import {
  type MyLogins,
  MyLoginsError,
  readMyLogins,
  unlinkMyGoogle,
} from "../../../../server/auth/my-logins";
import { getAuthService } from "../../../../server/auth/service";
import { getTranslator, titled } from "../../../../server/i18n";

export const dynamic = "force-dynamic";
export const generateMetadata = titled("Google nalog", { robots: { index: false, follow: false } });

const path = "/nalog/google";
const back = "/nalog?odjeljak=postavke";
const login = `/prijava?nastavi=${encodeURIComponent(path)}`;

async function unlink() {
  "use server";
  const auth = getAuthService();
  let outcome = "odvojeno";
  try {
    if (!auth) throw new MyLoginsError(503, "UNAVAILABLE");
    await unlinkMyGoogle(auth, await headers());
  } catch (error) {
    if (error instanceof MyLoginsError && error.status === 401) redirect(login);
    outcome =
      error instanceof MyLoginsError && error.code === "PASSWORD_REQUIRED" ? "lozinka" : "greska";
  }
  redirect(`${path}?ishod=${outcome}`);
}

/** Whether Google sign-in is attached to this account, and a way to detach it. */
export default async function GoogleSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ ishod?: string }>;
}) {
  const t = await getTranslator();
  const outcome = (await searchParams).ishod;
  const auth = getAuthService();
  let logins: MyLogins | null = null;
  if (auth) {
    try {
      logins = await readMyLogins(auth, await headers());
    } catch (error) {
      if (error instanceof MyLoginsError && error.status === 401) redirect(login);
    }
  }
  return (
    <main id="glavni-sadrzaj" className={rowStyles.screen}>
      <ScreenBar title={t("Google nalog")} backHref={back} backLabel={t("Postavke")} />
      {outcome === "odvojeno" && (
        <p role="status" className={styles.feedback}>
          {t("Google prijava je odvojena. Prijavljuješ se emailom i lozinkom.")}
        </p>
      )}
      {outcome === "lozinka" && (
        <p role="alert" className={styles.feedback} data-kind="error">
          {t("Prije odvajanja postavi lozinku, da se možeš prijaviti emailom.")}
        </p>
      )}
      {outcome === "greska" && (
        <p role="alert" className={styles.feedback} data-kind="error">
          {t("Promjena nije potvrđena. Pokušaj kasnije.")}
        </p>
      )}
      {logins ? (
        <>
          <RowGroup>
            <Row
              icon="globe"
              title={logins.google ? t("Povezan") : t("Nije povezan")}
              sub={
                logins.google
                  ? t("Prijavljuješ se jednim dodirom preko Googlea.")
                  : t("Poveže se sam kad se prijaviš Googleom s istom potvrđenom adresom.")
              }
              end={logins.google ? <RowPill kind="ok">{t("Aktivan")}</RowPill> : undefined}
            />
            <Row
              icon="key"
              title={t("Lozinka")}
              sub={logins.password ? t("Postavljena") : t("Nije postavljena")}
              href={logins.password ? "/nalog/lozinka" : "/zaboravljena-lozinka"}
            />
          </RowGroup>
          <p className={styles.note}>{t("AhiBizz ne vidi tvoju Google lozinku.")}</p>
          {logins.google &&
            (logins.password ? (
              <div className={styles.actions}>
                <form action={unlink}>
                  <button type="submit" className={styles.wide}>
                    {t("Odvoji Google nalog")}
                  </button>
                </form>
              </div>
            ) : (
              <>
                <p className={styles.note}>
                  {t("Prije odvajanja postavi lozinku, da se možeš prijaviti emailom.")}
                </p>
                <div className={styles.actions}>
                  <Link href="/zaboravljena-lozinka" className={styles.primary} prefetch={false}>
                    {t("Postavi lozinku")}
                  </Link>
                </div>
              </>
            ))}
        </>
      ) : (
        <p className={styles.note}>{t("Ovo trenutno nije dostupno. Pokušaj kasnije.")}</p>
      )}
    </main>
  );
}
