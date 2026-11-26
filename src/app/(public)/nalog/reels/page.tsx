import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ReelManager } from "../../../../components/reels/ReelManager";
import styles from "../../../../components/reels/reels.module.css";
import { ScreenBar } from "../../../../components/ui/Rows";
import { businessUuid } from "../../../../lib/business-today";
import { packageName } from "../../../../lib/packages";
import { AccountAccessError } from "../../../../server/auth/accounts";
import { getTranslator, titled } from "../../../../server/i18n";
import { manageReels } from "../../../../server/reels/service";

export const dynamic = "force-dynamic";
export const generateMetadata = titled("Moji reels");
type Query = { djelatnost?: string | string[]; stranica?: string | string[] };

export default async function ManageReelsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const t = await getTranslator();
  const query = await searchParams;
  const selected = businessUuid(query.djelatnost) ? query.djelatnost.toLowerCase() : undefined;
  const page =
    typeof query.stranica === "string" && /^[1-9]\d{0,2}$/.test(query.stranica)
      ? Number(query.stranica)
      : 1;
  const list = await manageReels(await headers(), false, (page - 1) * 30).catch(
    (error: unknown) => {
      if (error instanceof AccountAccessError && [401, 403].includes(error.status)) {
        const here = selected ? `/nalog/reels?djelatnost=${selected}` : "/nalog/reels";
        redirect(`/prijava?nastavi=${encodeURIComponent(here)}`);
      }
      return null;
    },
  );
  const href = (n: number) =>
    `/nalog/reels?stranica=${n}${selected ? `&djelatnost=${selected}` : ""}`;
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <ScreenBar title={t("Moji reels")} backHref="/nalog" backLabel={t("Moj nalog")}>
        {list?.allowance && (
          <span className={styles.packagePill} data-package={list.allowance.package}>
            {t("Paket")} <strong>{packageName(list.allowance.package)}</strong>
          </span>
        )}
      </ScreenBar>
      {list ? (
        <ReelManager
          key={list.accountId}
          accountId={list.accountId}
          businesses={list.businesses}
          businessId={selected}
          reels={list.reels}
          admin={false}
          allowance={list.allowance}
        />
      ) : (
        <p className={styles.empty}>{t("Moji reels trenutno nisu dostupni.")}</p>
      )}
      {(page > 1 || (list?.hasMore && page < 999)) && (
        <nav className={styles.pagination} aria-label={t("Stranice mojih reelova")}>
          {page > 1 && <Link href={href(page - 1)}>{t("Prethodna")}</Link>}
          {list?.hasMore && page < 999 && <Link href={href(page + 1)}>{t("Sljedeća")}</Link>}
        </nav>
      )}
    </main>
  );
}
