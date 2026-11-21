import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SavedSearchList } from "../../../components/favorites/SavedSearches";
import styles from "../../../components/favorites/saved-searches.module.css";
import { AccountAccessError } from "../../../server/auth/accounts";
import { readSavedSearches } from "../../../server/saved-search";
export const dynamic = "force-dynamic";
export const metadata = { title: "Sačuvane pretrage" };
export default async function SavedSearchPage() {
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
        <h1>Sačuvane pretrage</h1>
        <nav aria-label="Sačuvano">
          <Link className="text-link" href="/pretraga">
            Nova pretraga
          </Link>
          <Link className="text-link" href="/nalog?odjeljak=sacuvani">
            Sačuvane djelatnosti
          </Link>
          <Link className="text-link" href="/blog?sacuvano=1">
            Sačuvani članci
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
        <p role="status">Pretrage trenutno nisu dostupne.</p>
      )}
    </main>
  );
}
