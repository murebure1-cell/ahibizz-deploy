import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import Link from "next/link";
import styles from "../../../components/content-hub/content-hub.module.css";
import { HelpDesk } from "../../../components/content-hub/HelpDesk";
import { helpTopic } from "../../../lib/help-center";
import { getAccountService } from "../../../server/auth/accounts";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "AhiBizz pomoć",
  description: "Pronađi odgovor ili pošalji zahtjev AhiBizz podršci.",
};

export default async function HelpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const account = await getAccountService()
    ?.read(await headers())
    .catch(() => undefined);
  const topic = helpTopic((await searchParams).tema);
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <h1 className={styles.pageTitle}>Kako ti možemo pomoći?</h1>
      <HelpDesk
        key={`${account?.id ?? "gost"}:${topic ?? ""}`}
        actor={account?.id}
        requestId={account ? randomUUID() : undefined}
        initialTopic={topic}
      />
      <nav className={styles.toolRow} aria-label="Dodatni izvori pomoći">
        <Link href="/blog" className={styles.secondary}>
          Vodiči na blogu
        </Link>
        <Link href="/pravila-zajednice" className={styles.secondary}>
          Pravila zajednice
        </Link>
        <Link href="/privatnost" className={styles.secondary}>
          Privatnost
        </Link>
      </nav>
    </main>
  );
}
