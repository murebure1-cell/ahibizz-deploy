import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { MenuEditor } from "../../../../components/menu-offer/MenuEditor";
import { rowStyles, ScreenBar } from "../../../../components/ui/Rows";
import { AccountAccessError } from "../../../../server/auth/accounts";
import { getAuthDatabasePool, getAuthService } from "../../../../server/auth/service";
import { readOwnMenu } from "../../../../server/business-menu";
import { getTranslator, titled } from "../../../../server/i18n";

export const dynamic = "force-dynamic";
export const generateMetadata = titled("Jelovnik i meso");

/** The owner's menu and meat origin for one business (?djelatnost=<id>). */
export default async function MenuPage({
  searchParams,
}: {
  searchParams: Promise<{ djelatnost?: string }>;
}) {
  const t = await getTranslator();
  const id = (await searchParams).djelatnost ?? "";
  const auth = getAuthService(),
    pool = getAuthDatabasePool();
  const back = "/nalog?odjeljak=djelatnosti";
  let data: Awaited<ReturnType<typeof readOwnMenu>> | null = null;
  let accountId = "";
  if (auth && pool) {
    const request = await headers();
    try {
      data = await readOwnMenu(auth, pool, request, id);
      accountId = (await auth.api.getSession({ headers: request }))?.user?.id ?? "";
    } catch (error) {
      if (error instanceof AccountAccessError && error.status === 401)
        redirect(`/prijava?nastavi=${encodeURIComponent(`/nalog/jelovnik?djelatnost=${id}`)}`);
      if (error instanceof AccountAccessError && error.status === 404) redirect(back);
    }
  }
  return (
    <main id="glavni-sadrzaj" className={rowStyles.screen}>
      <ScreenBar title={t("Jelovnik i meso")} backHref={back} backLabel={t("Moje djelatnosti")} />
      {data && accountId ? (
        <MenuEditor accountId={accountId} businessId={id} initial={data.menu} />
      ) : (
        <p style={{ padding: "16px 20px" }}>{t("Ovo trenutno nije dostupno. Pokušaj kasnije.")}</p>
      )}
    </main>
  );
}
