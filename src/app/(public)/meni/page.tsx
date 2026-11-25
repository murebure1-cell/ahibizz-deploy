import { headers } from "next/headers";
import { AppMenu, type MenuAccount } from "../../../components/menu/AppMenu";
import type { PackageId } from "../../../lib/packages";
import { getSupportConfig } from "../../../lib/support";
import { getAccountService } from "../../../server/auth/accounts";
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
      account = { id: profile.id, name: profile.name, owner: profile.role === "owner" };
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
