import Link from "next/link";
import styles from "../../../components/support/resources.module.css";
import { communityRules } from "../../../lib/community-rules";
import { reportHelpPath } from "../../../lib/help-center";
import { getTranslator, titled } from "../../../server/i18n";

export const generateMetadata = titled("Pravila zajednice");

export default async function CommunityRulesPage() {
  const t = await getTranslator();
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <h1>{t("Pravila AhiBizz zajednice")}</h1>
      {communityRules.map((rule) => (
        <p key={rule}>{t(rule)}</p>
      ))}
      <Link href={reportHelpPath}>{t("Kako prijaviti sadržaj")}</Link>
    </main>
  );
}
