import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminDashboard } from "../../../components/admin/AdminDashboard";
import {
  AccountAccessError,
  getAccountService,
  type SafeAccountProfile,
} from "../../../server/auth/accounts";
export const dynamic = "force-dynamic";
export const metadata = { title: "Administracija" };
export default async function AdminPage() {
  let profile: SafeAccountProfile | undefined;
  try {
    const service = getAccountService();
    if (service) profile = await service.read(await headers());
  } catch (error) {
    if (error instanceof AccountAccessError && [401, 403].includes(error.status))
      redirect("/prijava");
  }
  if (profile && profile.role !== "owner") redirect("/nalog");
  if (!profile)
    return (
      <main id="glavni-sadrzaj" className="container" style={{ paddingBlock: 70 }}>
        <h1>Administracija trenutno nije dostupna.</h1>
        <p style={{ marginBlock: 18 }}>Pokušaj ponovo kasnije.</p>
        <Link href="/prijava">Na prijavu</Link>
      </main>
    );
  return <AdminDashboard initial={profile} />;
}
