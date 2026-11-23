import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PromotionWorkspace } from "../../../../components/promotions/PromotionWorkspace";
import styles from "../../../../components/support/resources.module.css";
import { businessUuid } from "../../../../lib/business-today";
import { IS_PLAY_EDITION } from "../../../../lib/distribution";
import { AccountAccessError, getAccountService } from "../../../../server/auth/accounts";
export const dynamic = "force-dynamic";
export const metadata = { title: "Moja isticanja" };
export default async function PromotionsPage({
  searchParams,
}: {
  searchParams: Promise<{ djelatnost?: string | string[] }>;
}) {
  if (IS_PLAY_EDITION)
    return (
      <main id="glavni-sadrzaj" className={styles.page}>
        <h1>Moja isticanja</h1>
        <p>Ovaj odjeljak nije dostupan u aplikaciji.</p>
        <Link href="/nalog">Moj nalog</Link>
      </main>
    );
  const query = await searchParams;
  const selected = businessUuid(query.djelatnost) ? query.djelatnost.toLowerCase() : undefined;
  const path = `/nalog/isticanja${selected ? `?djelatnost=${selected}` : ""}`;
  const account = await getAccountService()
    ?.read(await headers())
    .catch((error: unknown) => {
      if (error instanceof AccountAccessError && [401, 403].includes(error.status))
        redirect(`/prijava?nastavi=${encodeURIComponent(path)}`);
      return null;
    });
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <Link href="/nalog">Moj nalog</Link>
      <h1>Moja isticanja</h1>
      {account ? (
        <PromotionWorkspace accountId={account.id} businessId={selected} />
      ) : (
        <p>Isticanja trenutno nisu dostupna.</p>
      )}
    </main>
  );
}
