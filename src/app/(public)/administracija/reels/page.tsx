import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ReelManager } from "../../../../components/reels/ReelManager";
import styles from "../../../../components/reels/reels.module.css";
import { AccountAccessError } from "../../../../server/auth/accounts";
import { manageReels } from "../../../../server/reels/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pregled reelova" };

export default async function ReelModerationPage({
  searchParams,
}: {
  searchParams: Promise<{ stranica?: string | string[] }>;
}) {
  const { stranica } = await searchParams;
  const page =
    typeof stranica === "string" && /^[1-9]\d{0,2}$/.test(stranica) ? Number(stranica) : 1;
  const list = await manageReels(await headers(), true, (page - 1) * 30).catch((error: unknown) => {
    if (error instanceof AccountAccessError) {
      if (error.code === "OWNER_REQUIRED") redirect("/nalog");
      if ([401, 403].includes(error.status)) redirect("/prijava?nastavi=%2Fadministracija%2Freels");
    }
    return null;
  });
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <header>
        <Link href="/administracija" className={styles.back}>
          Administracija
        </Link>
        <h1>Pregled reelova</h1>
      </header>
      {list ? (
        <ReelManager
          key={list.accountId}
          accountId={list.accountId}
          businesses={[]}
          reels={list.reels}
          admin
        />
      ) : (
        <p className={styles.empty}>Pregled reelova trenutno nije dostupan.</p>
      )}
      {(page > 1 || (list?.hasMore && page < 999)) && (
        <nav className={styles.pagination} aria-label="Stranice za pregled reelova">
          {page > 1 && <Link href={`/administracija/reels?stranica=${page - 1}`}>Prethodna</Link>}
          {list?.hasMore && page < 999 && (
            <Link href={`/administracija/reels?stranica=${page + 1}`}>Sljedeća</Link>
          )}
        </nav>
      )}
    </main>
  );
}
