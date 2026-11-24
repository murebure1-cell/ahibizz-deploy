import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { BlockedPeople } from "../../../components/account/BlockedPeople";
import styles from "../../../components/account/blocks.module.css";
import { blockedPeoplePath } from "../../../lib/account-blocks";
import { createAccountBlocksService } from "../../../server/account-blocks";
import { AccountAccessError, getAccountService } from "../../../server/auth/accounts";
import { getAuthDatabasePool, getAuthService } from "../../../server/auth/service";
import { getTranslator, titled } from "../../../server/i18n";

export const dynamic = "force-dynamic";
export const generateMetadata = titled("Blokirani korisnici", {
  robots: { index: false, follow: false },
});

export default async function BlockedPeoplePage() {
  const t = await getTranslator();
  try {
    const req = await headers();
    const auth = getAuthService(),
      pool = getAuthDatabasePool(),
      accountService = getAccountService();
    if (!auth || !pool || !accountService) throw new Error("account unavailable");
    const account = await accountService.read(req);
    const bound = new Headers(req);
    bound.set("X-AhiBizz-Account-ID", account.id);
    const blocks = await createAccountBlocksService(auth, pool).list(bound, 1);
    return (
      <main id="glavni-sadrzaj" className={`container ${styles.page}`}>
        <header className={styles.heading}>
          <h1>{t("Blokirani korisnici")}</h1>
          <p>
            {t(
              "Blokada zaustavlja nove poruke i zahtjeve za prijateljstvo između vas. Razgovori koje već imaš ostaju u porukama.",
            )}
          </p>
        </header>
        <BlockedPeople key={account.id} accountId={account.id} initial={blocks} />
      </main>
    );
  } catch (error) {
    if (error instanceof AccountAccessError && [401, 403].includes(error.status))
      redirect(`/prijava?nastavi=${encodeURIComponent(blockedPeoplePath)}`);
    return (
      <main id="glavni-sadrzaj" className={`container ${styles.page}`}>
        <header className={styles.heading}>
          <h1>{t("Blokirani korisnici")}</h1>
          <p>{t("Lista trenutno nije dostupna. Pokušaj ponovo kasnije.")}</p>
        </header>
      </main>
    );
  }
}
