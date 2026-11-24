import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import Link from "next/link";
import styles from "../../../components/content-hub/content-hub.module.css";
import { HelpDesk } from "../../../components/content-hub/HelpDesk";
import { helpTopic } from "../../../lib/help-center";
import { msg } from "../../../lib/i18n/translate";
import { getAccountService } from "../../../server/auth/accounts";
import { getTranslator, titled } from "../../../server/i18n";

export const dynamic = "force-dynamic";
export const generateMetadata = titled("AhiBizz pomoć", {
  description: msg("Pronađi odgovor ili pošalji zahtjev AhiBizz podršci."),
});

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
      <h1 className={styles.pageTitle}>{t("Kako ti možemo pomoći?")}</h1>
      <HelpDesk
        key={`${account?.id ?? "gost"}:${topic ?? ""}`}
        actor={account?.id}
        requestId={account ? randomUUID() : undefined}
        initialTopic={topic}
      />
      <nav className={styles.toolRow} aria-label={t("Dodatni izvori pomoći")}>
        <Link href="/blog" className={styles.secondary}>
          {t("Vodiči na blogu")}
        </Link>
        <Link href="/pravila-zajednice" className={styles.secondary}>
          {t("Pravila zajednice")}
        </Link>
        <Link href="/privatnost" className={styles.secondary}>
          {t("Privatnost")}
        </Link>
      </nav>
    </main>
  );
}
