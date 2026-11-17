import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BusinessLocationBatch } from "../../../../components/admin/BusinessLocationBatch";
import { readEligibleNavigationRole } from "../../../../lib/session-navigation";
import {
  AccountAccessError,
  getAccountService,
  type SafeAccountProfile,
} from "../../../../server/auth/accounts";
export const dynamic = "force-dynamic";
export const metadata = { title: "Lokacije djelatnosti" };
export default async function BusinessLocationBatchPage() {
  const login = "/prijava?nastavi=%2Fadministracija%2Flokacije";
  let profile: SafeAccountProfile | undefined;
  try {
    const service = getAccountService();
    if (service) profile = await service.read(await headers());
  } catch (error) {
    if (error instanceof AccountAccessError && [401, 403].includes(error.status)) redirect(login);
  }
  if (profile && readEligibleNavigationRole(profile) !== "owner") redirect("/nalog");
  if (!profile)
    return (
      <main id="glavni-sadrzaj" className="container" style={{ paddingBlock: 70 }}>
        <h1>Administracija trenutno nije dostupna.</h1>
        <Link href={login}>Na prijavu</Link>
      </main>
    );
  return <BusinessLocationBatch key={profile.id} expectedAccountId={profile.id} />;
}
