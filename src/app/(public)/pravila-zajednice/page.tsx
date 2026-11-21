import Link from "next/link";
import styles from "../../../components/support/resources.module.css";
import { communityRules } from "../../../lib/community-rules";
import { reportHelpPath } from "../../../lib/help-center";

export const metadata = { title: "Pravila zajednice" };

export default function CommunityRulesPage() {
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <h1>Pravila AhiBizz zajednice</h1>
      {communityRules.map((rule) => (
        <p key={rule}>{rule}</p>
      ))}
      <Link href={reportHelpPath}>Kako prijaviti sadržaj</Link>
    </main>
  );
}
