import Link from "next/link";
import styles from "../../../components/support/resources.module.css";
import { IS_PLAY_EDITION } from "../../../lib/distribution";
import { promotionDurations, promotionKinds, promotionLabels } from "../../../lib/promotions";
import { getTranslator, titled } from "../../../server/i18n";

export const generateMetadata = titled("Istakni djelatnost");
export default async function PromotePage() {
  const t = await getTranslator();
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <h1>{t("Istakni djelatnost")}</h1>
      {IS_PLAY_EDITION ? (
        <>
          <p>{t("Ovaj odjeljak nije dostupan u aplikaciji.")}</p>
          <Link href="/">{t("Na početnu")}</Link>
        </>
      ) : (
        <>
          <p>
            {t(
              "Objava djelatnosti je besplatna. Za dodatnu vidljivost odaberi mjesto i period isticanja.",
            )}
          </p>
          <ul>
            {promotionKinds.map((kind) => (
              <li key={kind}>{t(promotionLabels[kind])}</li>
            ))}
          </ul>
          <p>
            {t(
              "Isticanje traje {days} dana. Cijenu vidiš prije narudžbe. Ako je mjesto zauzeto, možeš odabrati prvi slobodan termin.",
              { days: promotionDurations.join(", ") },
            )}
          </p>
          <p>
            {t(
              "Uplati bankovnim transferom prema uputama uz narudžbu. Isticanje uključujemo nakon potvrde uplate.",
            )}
          </p>
          <Link className="button button-navy" href="/nalog/isticanja">
            {t("Moja isticanja")}
          </Link>
        </>
      )}
    </main>
  );
}
