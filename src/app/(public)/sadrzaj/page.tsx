import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import styles from "../../../components/support/resources.module.css";
import { contentPaths } from "../../../lib/admin-navigation";
import {
  AccountAccessError,
  getAccountService,
  type SafeAccountProfile,
} from "../../../server/auth/accounts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sadržaj", robots: { index: false, follow: false } };

const places = [
  {
    href: contentPaths.articles,
    title: "Članci",
    text: "Piši, uređuj i objavljuj članke bloga.",
  },
  {
    href: contentPaths.design,
    title: "Izgled početne",
    text: "Naslov, fotografija, redoslijed sekcija i boje koje vidi posjetilac.",
  },
  {
    href: contentPaths.categories,
    title: "Kategorije",
    text: "Kategorije i potkategorije u koje se razvrstavaju djelatnosti.",
  },
] as const;

/** The owner's entry to everything a visitor reads. Each page behind it checks the owner again. */
export default async function ContentHome() {
  const loginPath = `/prijava?nastavi=${encodeURIComponent(contentPaths.home)}`;
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
      <Link href="/administracija">Administracija</Link>
      <h1>Sadržaj</h1>
      {!profile ? (
        <p role="alert">Sadržaj trenutno nije dostupan. Pokušaj ponovo kasnije.</p>
      ) : (
        places.map((place) => (
          <section key={place.href} className={styles.section}>
            <h2>
              <Link href={place.href}>{place.title}</Link>
            </h2>
            <p>{place.text}</p>
          </section>
        ))
      )}
    </main>
  );
}
