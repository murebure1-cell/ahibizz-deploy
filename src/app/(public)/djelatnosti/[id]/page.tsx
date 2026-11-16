import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicBooking } from "../../../../components/booking/PublicBooking";
import { PublicBusinessProfile } from "../../../../components/directory/PublicBusinessProfile";
import styles from "../../../../components/directory/public-search.module.css";
import type { PublicBookingConfiguration } from "../../../../lib/booking";
import { getBookingService } from "../../../../server/booking";
import { DirectoryAccessError, getPublicDirectoryService } from "../../../../server/directory";
import { publicBusinessView } from "../../../../server/directory/public-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Poslovni profil" };
export default async function PublicBusinessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id))
    notFound();
  try {
    const service = getPublicDirectoryService();
    if (service) {
      const [business, { categories }] = await Promise.all([
        service.readPublic(id),
        service.categories(),
      ]);
      // An unavailable optional booking service must not hide a public business profile.
      let booking: PublicBookingConfiguration | null | undefined;
      try {
        booking = await getBookingService()?.publicConfig(id);
      } catch {
        booking = null;
      }
      return (
        <main id="glavni-sadrzaj">
          <PublicBusinessProfile business={publicBusinessView(business, categories)}>
            <PublicBooking businessId={id} configuration={booking ?? null} />
          </PublicBusinessProfile>
        </main>
      );
    }
  } catch (error) {
    if (error instanceof DirectoryAccessError && error.status === 404) notFound();
  }
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <section className={styles.unavailable}>
        <h1>Profil trenutno nije dostupan.</h1>
        <p>Pokušaj ponovo kasnije.</p>
        <Link className="text-link" href="/pretraga">
          Nazad na pretragu
        </Link>
      </section>
    </main>
  );
}
