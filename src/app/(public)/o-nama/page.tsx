import Link from "next/link";
import { Icon } from "../../../components/Icon";
import { getSupportConfig } from "../../../lib/support";
import { getTranslator, titled } from "../../../server/i18n";

export const generateMetadata = titled("O AhiBizzu");

export default async function AboutPage() {
  const t = await getTranslator();
  return (
    <main id="glavni-sadrzaj" className="about-page container">
      <section className="about-intro">
        <h1>{t("O AhiBizzu")}</h1>
        <p>
          {t(
            "AhiBizz povezuje ljude i lokalne djelatnosti. Pronađi uslugu, javi se vlasniku ili zakaži termin.",
          )}
        </p>
      </section>
      <section className="about-principles" aria-label={t("Smjer nove platforme")}>
        <article>
          <span className="feature-icon">
            <Icon name="shop" />
          </span>
          <h2>{t("Pronađi.")}</h2>
          <p>{t("Lokalne djelatnosti i usluge, predstavljene jasno.")}</p>
        </article>
        <article>
          <span className="feature-icon">
            <Icon name="message" />
          </span>
          <h2>{t("Dogovori se.")}</h2>
          <p>{t("Jednostavniji kontakt s ljudima koji rade posao.")}</p>
        </article>
        <article>
          <span className="feature-icon">
            <Icon name="calendar" />
          </span>
          <h2>{t("Nađi svoj termin.")}</h2>
          <p>{t("Pregledna dostupnost i manje nepotrebnog dopisivanja.")}</p>
        </article>
      </section>
      <section className="about-status">
        <div>
          <h2>{t("Poslovni imenik")}</h2>
          <p>{t("Pretraži djelatnosti po nazivu, kategoriji ili mjestu.")}</p>
        </div>
        <Link className="button button-primary" href="/pretraga">
          {t("Pogledaj imenik")}
          <Icon name="arrow" />
        </Link>
      </section>
      {getSupportConfig() && (
        <section className="about-status">
          <div>
            <h2>{t("Podrži razvoj AhiBizza.")}</h2>
            <p>{t("Dobrovoljna podrška razvoju platforme.")}</p>
          </div>
          <Link className="button button-primary" href="/podrzi">
            {t("Doniraj")}
            <Icon name="arrow" />
          </Link>
        </section>
      )}
    </main>
  );
}
