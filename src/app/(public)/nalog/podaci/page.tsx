import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DataExportScreen } from "../../../../components/account/PrivacyScreens";
import { rowStyles, ScreenBar } from "../../../../components/ui/Rows";
import { getAuthService } from "../../../../server/auth/service";
import { getTranslator, titled } from "../../../../server/i18n";

export const dynamic = "force-dynamic";
export const generateMetadata = titled("Preuzmi svoje podatke", {
  robots: { index: false, follow: false },
});

/** Preuzmi svoje podatke, reached from Postavke. */
export default async function Page() {
  const t = await getTranslator();
  const auth = getAuthService();
  const session = auth ? await auth.api.getSession({ headers: await headers() }) : null;
  if (!session?.user?.id) redirect(`/prijava?nastavi=${encodeURIComponent("/nalog/podaci")}`);
  return (
    <main id="glavni-sadrzaj" className={rowStyles.screen}>
      <ScreenBar
        title={t("Preuzmi svoje podatke")}
        backHref="/nalog?odjeljak=postavke"
        backLabel={t("Postavke")}
      />
      <DataExportScreen />
    </main>
  );
}
