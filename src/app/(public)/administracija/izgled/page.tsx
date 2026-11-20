import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { VisualDesigner } from "../../../../components/design/VisualDesigner";
import { AccountAccessError } from "../../../../server/auth/accounts";
import { getVisualDesignStore } from "../../../../server/visual-design-store";

export const dynamic = "force-dynamic";
export const metadata = { title: "Uređivač izgleda" };
export default async function DesignPage() {
  const service = getVisualDesignStore();
  try {
    if (service) {
      const { actor, state } = await service.read(await headers());
      return <VisualDesigner actor={actor} initial={state} />;
    }
  } catch (error) {
    if (error instanceof AccountAccessError && error.status === 401)
      redirect("/prijava?nastavi=%2Fadministracija%2Fizgled");
    if (error instanceof AccountAccessError && error.status === 403) redirect("/nalog");
  }
  return (
    <main className="container" id="glavni-sadrzaj">
      <h1>Uređivač trenutno nije dostupan.</h1>
      <Link href="/administracija">Administracija</Link>
    </main>
  );
}
