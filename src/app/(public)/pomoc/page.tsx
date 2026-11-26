import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import Link from "next/link";
import { HelpDesk } from "../../../components/content-hub/HelpDesk";
import styles from "../../../components/content-hub/help.module.css";
import { Icon } from "../../../components/Icon";
import { helpTopic, reportHelpPath } from "../../../lib/help-center";
import { msg } from "../../../lib/i18n/translate";
import { getAccountService } from "../../../server/auth/accounts";
import { getTranslator, titled } from "../../../server/i18n";

export const dynamic = "force-dynamic";
export const generateMetadata = titled("AhiBizz pomoć", {
  description: msg("Pronađi odgovor ili pošalji zahtjev AhiBizz podršci."),
});

/** The help centre as drawn: pills to its parts, the desk, and the texts around it. */
export default async function HelpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslator();
  const account = await getAccountService()
    ?.read(await headers())
    .catch(() => undefined);
  const query = await searchParams;
  const topic = helpTopic(query.tema);
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <nav className={styles.tabs} aria-label={t("Dijelovi pomoći")}>
        <Link href="/pomoc" aria-current="page">
          {t("Pomoć")}
        </Link>
        <Link href="#pitanja">{t("Česta pitanja")}</Link>
        <Link href="#kontakt">{t("Kontakt")}</Link>
      </nav>
      <HelpDesk
        key={`${account?.id ?? "gost"}:${topic ?? ""}`}
        actor={account?.id}
        requestId={account ? randomUUID() : undefined}
        initialTopic={topic}
      />
      <nav className={styles.rows} aria-label={t("Dodatni izvori pomoći")}>
        <Link href="/blog">
          <Icon name="book" aria-hidden="true" />
          <span>{t("Vodiči na blogu")}</span>
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
        <Link href={reportHelpPath}>
          <Icon name="shield" aria-hidden="true" />
          <span>{t("Kako prijaviti sadržaj")}</span>
          <Icon name="chevron" aria-hidden="true" />
        </Link>
      </nav>
    </main>
  );
}
