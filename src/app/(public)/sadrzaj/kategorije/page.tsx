import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CategoryManager } from "../../../../components/admin/CategoryManager";
import styles from "../../../../components/support/resources.module.css";
import { contentPaths } from "../../../../lib/admin-navigation";
import {
  AccountAccessError,
  getAccountService,
  type SafeAccountProfile,
} from "../../../../server/auth/accounts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kategorije", robots: { index: false, follow: false } };

/** The page authorizes the view; every category request checks the current owner again. */
export default async function ContentCategories() {
  const loginPath = `/prijava?nastavi=${encodeURIComponent(contentPaths.categories)}`;
  let profile: SafeAccountProfile | undefined;
  try {
    const service = getAccountService();
    if (service) profile = await service.read(await headers());
  } catch (error) {
    if (error instanceof AccountAccessError && [401, 403].includes(error.status))
      redirect(loginPath);
  }
  if (profile && profile.role !== "owner") redirect("/nalog");
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <Link href={contentPaths.home}>Sadržaj</Link>
      <h1>Kategorije</h1>
      {profile ? (
        <CategoryManager key={profile.id} expectedAccountId={profile.id} />
      ) : (
        <p role="alert">Kategorije trenutno nisu dostupne. Pokušaj ponovo kasnije.</p>
      )}
    </main>
  );
}
