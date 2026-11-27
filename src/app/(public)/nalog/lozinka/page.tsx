import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PasswordForm } from "../../../../components/account/AccountPassword";
import { rowStyles, ScreenBar } from "../../../../components/ui/Rows";
import { getAuthService } from "../../../../server/auth/service";
import { getTranslator, titled } from "../../../../server/i18n";

export const dynamic = "force-dynamic";
export const generateMetadata = titled("Promijeni lozinku", {
  robots: { index: false, follow: false },
});

/** The password change on its own screen, reached from Postavke. */
export default async function PasswordPage() {
  const t = await getTranslator();
  const auth = getAuthService();
  const session = auth ? await auth.api.getSession({ headers: await headers() }) : null;
  if (!session?.user?.id) redirect(`/prijava?nastavi=${encodeURIComponent("/nalog/lozinka")}`);
  return (
    <main id="glavni-sadrzaj" className={rowStyles.screen}>
      <ScreenBar
        title={t("Promijeni lozinku")}
        backHref="/nalog?odjeljak=postavke"
        backLabel={t("Postavke")}
      />
      <PasswordForm accountId={session.user.id} email={session.user.email} />
    </main>
  );
}
