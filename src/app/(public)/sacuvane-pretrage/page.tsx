import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SavedSearchList } from "../../../components/favorites/SavedSearches";
import styles from "../../../components/favorites/saved-searches.module.css";
import { AccountAccessError } from "../../../server/auth/accounts";
import { getTranslator, titled } from "../../../server/i18n";
import { readSavedSearches } from "../../../server/saved-search";
export const dynamic = "force-dynamic";
export const generateMetadata = titled("Sačuvane pretrage");
export default async function SavedSearchPage() {
  const t = await getTranslator();
  let result: Awaited<ReturnType<typeof readSavedSearches>> | undefined;
  try {
    result = await readSavedSearches(await headers());
  } catch (error) {
    if (error instanceof AccountAccessError && [401, 403].includes(error.status))
      redirect("/prijava?nastavi=%2Fsacuvane-pretrage");
  }
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <header>
        <h1>{t("Sačuvane pretrage")}</h1>
        <nav aria-label={t("Sačuvano")}>
          <Link className="text-link" href="/pretraga">
            {t("Nova pretraga")}
          </Link>
          <Link className="text-link" href="/nalog?odjeljak=sacuvani">
            {t("Sačuvane djelatnosti")}
          </Link>
          <Link className="text-link" href="/blog?sacuvano=1">
            {t("Sačuvani članci")}
          </Link>
        </nav>
      </header>
      {result ? (
        <SavedSearchList
          key={result.accountId}
          accountId={result.accountId}
          initial={result.searches}
        />
      ) : (
        <p role="status">{t("Pretrage trenutno nisu dostupne.")}</p>
      )}
    </main>
  );
}
