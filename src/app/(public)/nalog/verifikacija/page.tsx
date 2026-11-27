import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import styles from "../../../../components/account/logins.module.css";
import { Icon } from "../../../../components/Icon";
import { Row, RowGroup, rowStyles, ScreenBar } from "../../../../components/ui/Rows";
import { getAuthDatabasePool, getAuthService } from "../../../../server/auth/service";
import { getTranslator, titled } from "../../../../server/i18n";

export const dynamic = "force-dynamic";
export const generateMetadata = titled("Verifikacija profila", {
  robots: { index: false, follow: false },
});

/** What profile verification checks and how to ask for it. Administration decides by hand. */
export default async function VerificationPage() {
  const t = await getTranslator();
  const auth = getAuthService(),
    pool = getAuthDatabasePool();
  const session = auth ? await auth.api.getSession({ headers: await headers() }) : null;
  if (!session?.user?.id) redirect(`/prijava?nastavi=${encodeURIComponent("/nalog/verifikacija")}`);
  let verified: boolean | null = null;
  if (pool) {
    try {
      const row = (
        await pool.query<{ verified: boolean }>(
          'SELECT profile_verified AS "verified" FROM auth_user WHERE id=$1',
          [session.user.id],
        )
      ).rows[0];
      verified = row ? row.verified === true : null;
    } catch {
      verified = null;
    }
  }
  return (
    <main id="glavni-sadrzaj" className={rowStyles.screen}>
      <ScreenBar
        title={t("Verifikacija profila")}
        backHref="/nalog?odjeljak=postavke"
        backLabel={t("Postavke")}
      />
      <div className={styles.hero}>
        <span className={styles.mark} aria-hidden="true">
          <Icon name="shield" />
        </span>
        <strong>
          {verified ? t("Tvoj profil je verifikovan.") : t("Tvoj profil još nije verifikovan.")}
        </strong>
        <p>{t("Oznaka pokazuje da je administracija ručno provjerila ko stoji iza profila.")}</p>
      </div>
      <RowGroup title={t("Šta se provjerava")}>
        <Row icon="user" title={t("Identitet")} sub={t("Da si osoba za koju se predstavljaš")} />
        <Row
          icon="shop"
          title={t("Vlasništvo djelatnosti")}
          sub={t("Ako imaš djelatnost, da je zaista tvoja")}
        />
      </RowGroup>
      <p className={styles.note}>
        {t(
          "Administracija ti se javlja i dogovara provjeru. Oznaka se ne kupuje i ne dolazi s paketom.",
        )}
      </p>
      {!verified && (
        <div className={styles.actions}>
          <Link href="/pomoc?tema=nalog#kontakt" className={styles.primary} prefetch={false}>
            <Icon name="shield" />
            {t("Zatraži verifikaciju")}
          </Link>
        </div>
      )}
    </main>
  );
}
