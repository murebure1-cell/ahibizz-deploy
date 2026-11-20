import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MarketingWorkspace } from "../../../../components/marketing/MarketingWorkspace";
import { IS_PLAY_EDITION } from "../../../../lib/distribution";
import { readEligibleNavigationRole } from "../../../../lib/session-navigation";
import {
  AccountAccessError,
  getAccountService,
  type SafeAccountProfile,
} from "../../../../server/auth/accounts";
export const dynamic = "force-dynamic";
export const metadata = { title: "Oglašavanje i krediti" };
export default async function MarketingAdmin() {
  if (IS_PLAY_EDITION) notFound();
  let actor: SafeAccountProfile | undefined;
  const login = "/prijava?nastavi=%2Fadministracija%2Foglasi";
  try {
    actor = await getAccountService()?.read(await headers());
  } catch (error) {
    if (error instanceof AccountAccessError && [401, 403].includes(error.status)) redirect(login);
  }
  if (actor && readEligibleNavigationRole(actor) !== "owner") redirect("/nalog");
  return (
    <main id="glavni-sadrzaj" className="container" style={{ paddingBlock: "2rem" }}>
      <Link href="/administracija">Administracija</Link>
      <h1>Oglašavanje i krediti</h1>
      {actor ? (
        <MarketingWorkspace key={actor.id} accountId={actor.id} mode="admin" />
      ) : (
        <p>Administracija trenutno nije dostupna.</p>
      )}
    </main>
  );
}
