import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicBooking } from "../../../../components/booking/PublicBooking";
import { PublicBusinessProfile } from "../../../../components/directory/PublicBusinessProfile";
import styles from "../../../../components/directory/public-search.module.css";
import { RentalFleet } from "../../../../components/rentals/RentalFleet";
import { StayUnits } from "../../../../components/stays/StayUnits";
import {
  type DirectorySearchParams,
  directorySearchSuffix,
} from "../../../../lib/directory-navigation";
import { getBookingService } from "../../../../server/booking";
import { DirectoryAccessError, getPublicDirectoryService } from "../../../../server/directory";
import { publicBusinessView } from "../../../../server/directory/public-view";
import { getRentalService } from "../../../../server/rentals/service";
import { getStayService } from "../../../../server/stays/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Poslovni profil" };
export default async function PublicBusinessPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<DirectorySearchParams>;
}) {
  const [{ id }, search] = await Promise.all([params, searchParams]);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id))
    notFound();
  try {
    const service = getPublicDirectoryService();
    if (service) {
      const [business, { categories }] = await Promise.all([
        service.readPublic(id),
        service.categories(),
      ]);
      const rentsCars = categories.some(
        (c) => c.vehicleRental && (c.id === business.categoryId || c.id === business.subcategoryId),
      );
      const hostsGuests = categories.some(
        (c) => c.accommodation && (c.id === business.categoryId || c.id === business.subcategoryId),
      );
      // Optional offers must not prevent the business profile from opening.
      const [booking, catalog, stays] = await Promise.allSettled([
        Promise.resolve().then(() => getBookingService()?.publicConfig(id)),
        rentsCars ? Promise.resolve().then(() => getRentalService()?.publicCatalog(id)) : null,
        hostsGuests ? Promise.resolve().then(() => getStayService()?.publicCatalog(id)) : null,
      ]);
      const stayCatalog = stays.status === "fulfilled" ? (stays.value ?? undefined) : undefined;
      const initialCatalog =
        catalog.status === "fulfilled" ? (catalog.value ?? undefined) : undefined;
      return (
        <main id="glavni-sadrzaj">
          <PublicBusinessProfile
            backHref={`/pretraga${directorySearchSuffix(search)}`}
            business={publicBusinessView(business, categories)}
            accommodation={
              hostsGuests && (!stayCatalog || stayCatalog.units.length > 0) ? (
                <StayUnits
                  key={id}
                  businessId={id}
                  photos={business.media?.gallery}
                  initialCatalog={stayCatalog}
                />
              ) : undefined
            }
            rental={
              rentsCars && (!initialCatalog || initialCatalog.vehicles.length > 0) ? (
                <RentalFleet
                  businessId={id}
                  photos={business.media?.gallery}
                  initialCatalog={initialCatalog}
                />
              ) : undefined
            }
          >
            {(!hostsGuests ||
              (booking.status === "fulfilled" &&
                booking.value?.enabled &&
                booking.value.services.length > 0)) && (
              <PublicBooking
                businessId={id}
                configuration={booking.status === "fulfilled" ? (booking.value ?? null) : null}
              />
            )}
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
