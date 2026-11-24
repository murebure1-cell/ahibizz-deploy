import Link from "next/link";
import styles from "../../../../components/directory/public-search.module.css";
import { getTranslator } from "../../../../server/i18n";

export default async function BusinessNotFound() {
  const t = await getTranslator();
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <section className={styles.unavailable}>
        <h1>{t("Profil nije pronađen.")}</h1>
        <p>{t("Možda je uklonjen ili još nije objavljen.")}</p>
        <Link className="text-link" href="/pretraga">
          {t("Istraži djelatnosti")}
        </Link>
      </section>
    </main>
  );
}
