import { headers } from "next/headers";
import { AppMenu, type MenuAccount } from "../../../components/menu/AppMenu";
import type { PackageId } from "../../../lib/packages";
import { getSupportConfig } from "../../../lib/support";
import { getAccountService } from "../../../server/auth/accounts";
import { getAuthDatabasePool } from "../../../server/auth/service";
import { titled } from "../../../server/i18n";

export const dynamic = "force-dynamic";
export const generateMetadata = titled("Meni");

export default async function MenuPage() {
  let account: MenuAccount | null = null;
  let packageId: PackageId | null = null;
  try {
    const service = getAccountService();
    if (service) {
      const request = await headers();
      const profile = await service.read(request);
      // The founder mark is a detail of the card, read apart so the menu still opens without it.
      const founder = await getAuthDatabasePool()
        ?.query<{ founder: boolean }>("SELECT founder FROM auth_user WHERE id=$1", [profile.id])
        .then((result) => result.rows[0]?.founder === true)
        .catch(() => false);
      account = {
        id: profile.id,
        name: profile.name,
        owner: profile.role === "owner",
        founder: founder === true,
      };
      // The package is a detail of the card; the menu still opens when it cannot be read.
      packageId = await service.overview(request).then(
        (overview) => overview.package,
        () => null,
      );
    }
  } catch {
    // A guest, or a session that cannot be read now, gets the menu without the account rows.
  }
  return (
    <AppMenu
      account={account}
      packageId={packageId}
      supportAvailable={getSupportConfig() !== null}
    />
  );
}
