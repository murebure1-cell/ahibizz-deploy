import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import styles from "../../../../../components/directory/public-search.module.css";
import { Directions } from "../../../../../components/map/Directions";
import { initialLocationPoint } from "../../../../../lib/business-location";
import { DirectoryAccessError, getPublicDirectoryService } from "../../../../../server/directory";
import { getTranslator } from "../../../../../server/i18n";

export const dynamic = "force-dynamic";

const businessIdPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslator();
  const fallback: Metadata = { title: t("Uputstva") };
  if (!businessIdPattern.test(id)) return fallback;
  const business = await Promise.resolve()
    .then(() => getPublicDirectoryService()?.readPublic(id))
    .catch(() => null);
  const title = business?.title?.trim();
  return title ? { title: t("Uputstva do {title}", { title }) } : fallback;
}

/** The way to a published business that has a place on the map, shown inside the app. */
export default async function DirectionsPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, t] = await Promise.all([params, getTranslator()]);
  if (!businessIdPattern.test(id)) notFound();
  try {
    const service = getPublicDirectoryService();
    if (service) {
      const [business, { categories }] = await Promise.all([
        service.readPublic(id),
        service.categories().catch(() => ({ categories: [] })),
      ]);
      const point = initialLocationPoint(business.latitude, business.longitude);
      // A business without a place on the map has no way to be shown.
      if (!point) notFound();
      return (
        <main id="glavni-sadrzaj" data-fullscreen="true">
          <Directions
            back={`/djelatnosti/${id}`}
            place={{
              id,
              title: business.title,
              latitude: point.latitude,
              longitude: point.longitude,
              category: categories.find((item) => item.id === business.categoryId)?.name ?? null,
              address: [business.addressLine?.trim(), business.city?.trim()]
                .filter(Boolean)
                .join(", "),
            }}
          />
        </main>
      );
    }
  } catch (error) {
    if (error instanceof DirectoryAccessError && error.status === 404) notFound();
    // notFound() above throws on purpose; let it through.
    if (!(error instanceof DirectoryAccessError)) throw error;
  }
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <section className={styles.unavailable}>
        <h1>{t("Uputstva trenutno nisu dostupna.")}</h1>
        <p>{t("Pokušaj ponovo kasnije.")}</p>
        <Link className="text-link" href={`/djelatnosti/${id}`}>
          {t("Nazad na djelatnost")}
        </Link>
      </section>
    </main>
  );
}
