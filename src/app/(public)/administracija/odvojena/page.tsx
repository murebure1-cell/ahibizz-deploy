import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AdministrationSetup } from "../../../../components/admin/AdministrationSetup";
import { AccountAccessError } from "../../../../server/auth/accounts";
import {
  type AdministrationState,
  readAdministration,
} from "../../../../server/auth/administration";
import { getAuthDatabasePool, getAuthService } from "../../../../server/auth/service";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Odvojena administracija",
  robots: { index: false, follow: false },
};

const path = "/administracija/odvojena";

/** Creating the separate administration account and handing the administration over to it. */
export default async function SeparateAdministrationPage() {
  const auth = getAuthService(),
    pool = getAuthDatabasePool();
  let state: AdministrationState | null = null;
  if (auth && pool) {
    try {
      state = await readAdministration(auth, pool, await headers());
    } catch (error) {
      if (error instanceof AccountAccessError && error.status === 401)
        redirect(`/prijava?nastavi=${encodeURIComponent(path)}`);
      if (error instanceof AccountAccessError && error.status === 403) redirect("/nalog");
    }
  }
  return <AdministrationSetup initial={state} />;
}
