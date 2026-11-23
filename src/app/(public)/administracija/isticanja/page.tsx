import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PromotionWorkspace } from "../../../../components/promotions/PromotionWorkspace";
import styles from "../../../../components/support/resources.module.css";
import { IS_PLAY_EDITION } from "../../../../lib/distribution";
import { AccountAccessError, getAccountService } from "../../../../server/auth/accounts";
export const dynamic = "force-dynamic";
export const metadata = { title: "Isticanja" };
export default async function AdminPromotionsPage() {
  if (IS_PLAY_EDITION)
    return (
      <main id="glavni-sadrzaj" className={styles.page}>
        <h1>Isticanja</h1>
        <p>Ovaj odjeljak nije dostupan u aplikaciji.</p>
        <Link href="/administracija">Administracija</Link>
      </main>
    );
  const account = await getAccountService()
    ?.read(await headers())
    .catch((error: unknown) => {
      if (error instanceof AccountAccessError && error.status === 401)
        redirect("/prijava?nastavi=%2Fadministracija%2Fisticanja");
      return null;
    });
  if (account && account.role !== "owner") redirect("/nalog");
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <Link href="/administracija">Administracija</Link>
      <h1>Isticanja</h1>
      {account ? (
        <PromotionWorkspace accountId={account.id} admin />
      ) : (
        <p>Isticanja trenutno nisu dostupna.</p>
      )}
    </main>
  );
}
