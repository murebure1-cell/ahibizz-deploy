import Link from "next/link";
import styles from "../../../components/content-hub/help.module.css";
import { Icon } from "../../../components/Icon";
import { msg } from "../../../lib/i18n/translate";
import { getSupportConfig } from "../../../lib/support";
import { getTranslator, titled } from "../../../server/i18n";

export const generateMetadata = titled("O AhiBizzu");

/** About AhiBizz as drawn ("O nama"): what it is, three things it does, and where to go next. */
export default async function AboutPage() {
  const t = await getTranslator();
  const features = [
    {
      icon: "shop",
      title: msg("Pronađi."),
      text: msg("Lokalne djelatnosti i usluge, predstavljene jasno."),
    },
    {
      icon: "message",
      title: msg("Dogovori se."),
      text: msg("Jednostavniji kontakt s ljudima koji rade posao."),
    },
    {
      icon: "calendar",
      title: msg("Nađi svoj termin."),
      text: msg("Pregledna dostupnost i manje nepotrebnog dopisivanja."),
    },
  ] as const;
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <section className={styles.hero}>
        <h1>{t("O AhiBizzu")}</h1>
        <p>
          {t(
            "AhiBizz povezuje ljude i lokalne djelatnosti. Pronađi uslugu, javi se vlasniku ili zakaži termin.",
          )}
        </p>
      </section>
      <section className={styles.features} aria-label={t("Smjer nove platforme")}>
        {features.map((feature) => (
          <article key={feature.title} className={styles.feature}>
            <span aria-hidden="true">
              <Icon name={feature.icon} />
            </span>
            <div>
              <h2>{t(feature.title)}</h2>
              <p>{t(feature.text)}</p>
            </div>
          </article>
        ))}
      </section>
      <section className={styles.card}>
        <h2>{t("Poslovni imenik")}</h2>
        <p>{t("Pretraži djelatnosti po nazivu, kategoriji ili mjestu.")}</p>
        <Link className={styles.main} href="/pretraga">
          {t("Pogledaj imenik")}
          <Icon name="arrow" aria-hidden="true" />
        </Link>
      </section>
      {getSupportConfig() && (
        <section className={styles.card}>
          <h2>{t("Podrži razvoj AhiBizza.")}</h2>
          <p>{t("Dobrovoljna podrška razvoju platforme.")}</p>
          <Link className={styles.main} href="/podrzi">
            {t("Doniraj")}
            <Icon name="arrow" aria-hidden="true" />
          </Link>
        </section>
      )}
      <nav className={styles.rows} aria-label={t("Dodatni izvori pomoći")}>
        <Link href="/pomoc#kontakt">
          <Icon name="mail" aria-hidden="true" />
          <span>{t("Kontakt")}</span>
          <Icon name="chevron" aria-hidden="true" />
        </Link>
        <Link href="/pravila-zajednice">
          <Icon name="doc" aria-hidden="true" />
          <span>{t("Pravila zajednice")}</span>
          <Icon name="chevron" aria-hidden="true" />
        </Link>
        <Link href="/privatnost">
          <Icon name="lock" aria-hidden="true" />
          <span>{t("Privatnost")}</span>
          <Icon name="chevron" aria-hidden="true" />
        </Link>
      </nav>
    </main>
  );
}
