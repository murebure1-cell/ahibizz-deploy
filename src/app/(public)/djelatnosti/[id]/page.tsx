import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment, type ReactNode, Suspense } from "react";
import { PublicBooking } from "../../../../components/booking/PublicBooking";
import { PublicBusinessProfile } from "../../../../components/directory/PublicBusinessProfile";
import profileStyles from "../../../../components/directory/public-profile.module.css";
import styles from "../../../../components/directory/public-search.module.css";
import { CampaignAd } from "../../../../components/marketing/CampaignAd";
import adStyles from "../../../../components/marketing/campaign-ad.module.css";
import { BusinessReels } from "../../../../components/reels/ReelShelf";
import { RentalFleet } from "../../../../components/rentals/RentalFleet";
import { StayUnits } from "../../../../components/stays/StayUnits";
import type { PageAds } from "../../../../lib/ad-render";
import {
  type DirectorySearchParams,
  directorySearchSuffix,
} from "../../../../lib/directory-navigation";
import { getBookingService } from "../../../../server/booking";
import { DirectoryAccessError, getPublicDirectoryService } from "../../../../server/directory";
import { publicBusinessView } from "../../../../server/directory/public-view";
import { publicPageAds } from "../../../../server/marketing/ad-delivery";
import { getRentalService } from "../../../../server/rentals/service";
import { getStayService } from "../../../../server/stays/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Poslovni profil" };

type Offer = {
  id: string;
  label: string;
  content: Promise<ReactNode>;
};

async function ListingOffer({ offer, link = false }: { offer: Offer; link?: boolean }) {
  const content = await offer.content;
  if (!content) return null;
  return link ? (
    <a
      href={`#${offer.id}`}
      className={offer.id === "business-appointments" ? profileStyles.appointmentsLink : undefined}
    >
      {offer.label}
    </a>
  ) : (
    <section id={offer.id} className={profileStyles.appointments} aria-label={offer.label}>
      {content}
    </section>
  );
}

async function ListingAd({
  data,
  region,
}: {
  data: Promise<PageAds>;
  region: "inline" | "elsewhere";
}) {
  const ads = await data;
  if (!ads.main.mobile && !ads.main.desktop) return null;
  return <CampaignAd candidates={ads.main} region={region} />;
}

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
        service.categories().catch(() => ({ categories: [] })),
      ]);
      const rentsCars = categories.some(
        (c) => c.vehicleRental && (c.id === business.categoryId || c.id === business.subcategoryId),
      );
      const hostsGuests = categories.some(
        (c) => c.accommodation && (c.id === business.categoryId || c.id === business.subcategoryId),
      );
      // Start each offer once and share it between its link, section, and ad targeting.
      const booking = Promise.resolve()
        .then(() => getBookingService()?.publicConfig(id))
        .catch(() => null);
      const rentals = rentsCars
        ? Promise.resolve()
            .then(() => getRentalService()?.publicCatalog(id))
            .catch(() => undefined)
        : Promise.resolve(undefined);
      const stays = hostsGuests
        ? Promise.resolve()
            .then(() => getStayService()?.publicCatalog(id))
            .catch(() => undefined)
        : Promise.resolve(undefined);
      const offers: Offer[] = [
        {
          id: "business-stays",
          label: "Smještaj",
          content: stays.then((catalog) =>
            hostsGuests && (!catalog || catalog.units.length > 0) ? (
              <StayUnits
                key={id}
                businessId={id}
                photos={business.media?.gallery}
                initialCatalog={catalog ?? undefined}
              />
            ) : null,
          ),
        },
        {
          id: "business-rentals",
          label: "Automobili",
          content: rentals.then((catalog) =>
            rentsCars && (!catalog || catalog.vehicles.length > 0) ? (
              <RentalFleet
                businessId={id}
                photos={business.media?.gallery}
                initialCatalog={catalog ?? undefined}
              />
            ) : null,
          ),
        },
        {
          id: "business-appointments",
          label: "Termini",
          content: booking.then((configuration) =>
            !hostsGuests || (configuration?.enabled && configuration.services.length > 0) ? (
              <PublicBooking businessId={id} configuration={configuration ?? null} />
            ) : null,
          ),
        },
      ];
      const ads = Promise.all([booking, rentals, stays]).then(
        ([configuration, rentalCatalog, stayCatalog]) =>
          publicPageAds({
            page: "listing",
            listingId: id,
            city: business.city ?? "",
            countryCode: business.countryCode,
            categoryIds: [business.categoryId, business.subcategoryId].filter((v): v is string =>
              Boolean(v),
            ),
            publishedPrices: [
              ...new Set(
                [
                  ...(configuration?.enabled ? configuration.services : []),
                  ...(rentalCatalog?.vehicles ?? []),
                  ...(stayCatalog?.units ?? []),
                ].map((service) => service.priceMinor),
              ),
            ],
          }),
      );
      return (
        <main id="glavni-sadrzaj" className={adStyles.withResults}>
          <Suspense fallback={null}>
            <ListingAd data={ads} region="elsewhere" />
          </Suspense>
          <PublicBusinessProfile
            sponsor={
              <Suspense fallback={null}>
                <ListingAd data={ads} region="inline" />
              </Suspense>
            }
            backHref={`/pretraga${directorySearchSuffix(search)}`}
            business={publicBusinessView(business, categories)}
            offerLinks={offers.map((offer) => (
              <Suspense key={offer.id} fallback={null}>
                <ListingOffer offer={offer} link />
              </Suspense>
            ))}
            offerSections={offers.map((offer) => (
              <Fragment key={offer.id}>
                {offer.id === "business-appointments" && (
                  <Suspense fallback={null}>
                    <BusinessReels businessId={id} />
                  </Suspense>
                )}
                <Suspense fallback={null}>
                  <ListingOffer offer={offer} />
                </Suspense>
              </Fragment>
            ))}
          />
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
