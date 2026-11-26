import Link from "next/link";
import styles from "../../../components/content-hub/help.module.css";
import { Icon } from "../../../components/Icon";
import { communityRules } from "../../../lib/community-rules";
import { reportHelpPath } from "../../../lib/help-center";
import { getTranslator, titled } from "../../../server/i18n";

export const generateMetadata = titled("Pravila zajednice");

/** The community rules as drawn ("Pravilnik"): numbered, then where to ask about them. */
export default async function CommunityRulesPage() {
  const t = await getTranslator();
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <div className={styles.doc}>
        <Link href="/pomoc" className={styles.back} aria-label={t("Nazad na pomoć")}>
          <Icon name="arrow" aria-hidden="true" />
        </Link>
        <h1>{t("Pravila AhiBizz zajednice")}</h1>
      </div>
      <ol className={styles.numbered}>
        {communityRules.map((rule, index) => (
          <li key={rule}>
            <span aria-hidden="true">{index + 1}</span>
            <p style={{ margin: 0 }}>{t(rule)}</p>
          </li>
        ))}
      </ol>
      <nav className={styles.rows} aria-label={t("Pitanja o ovom tekstu")}>
        <Link href={reportHelpPath}>
          <Icon name="shield" aria-hidden="true" />
          <span>{t("Kako prijaviti sadržaj")}</span>
          <Icon name="chevron" aria-hidden="true" />
        </Link>
        <Link href="/pomoc#kontakt">
          <Icon name="mail" aria-hidden="true" />
          <span>{t("Piši podršci")}</span>
          <Icon name="chevron" aria-hidden="true" />
        </Link>
      </nav>
    </main>
  );
}
