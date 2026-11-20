import { headers } from "next/headers";
import Link from "next/link";
import { type SupportTarget, supportEmail, supportSubjects } from "../../lib/support-requests";
import { getAccountService } from "../../server/auth/accounts";
import { RequestForm } from "./RequestForm";
import styles from "./resources.module.css";

export async function RequestScreen({ target }: { target: SupportTarget }) {
  const deletion = target.subject === "deletion";
  const account = await getAccountService()
    ?.read(await headers())
    .catch(() => undefined);
  const subject = deletion
    ? "AhiBizz – zahtjev za trajno brisanje naloga"
    : "AhiBizz – prijava sadržaja";
  const email =
    "mailto:" +
    supportEmail +
    "?subject=" +
    encodeURIComponent(subject) +
    (deletion
      ? ""
      : "&body=" +
        encodeURIComponent(
          `${supportSubjects[target.subject]} · ${target.reference}\nRazlog prijave: `,
        ));
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <Link href="/privatnost">Privatnost i podrška</Link>
      <h1>{deletion ? "Brisanje AhiBizz naloga" : "Prijavi sadržaj"}</h1>
      {deletion ? (
        <>
          <p>
            Zahtjev obuhvata tvoj nalog, profil, slike i povezane lične podatke. Podrška provjerava
            vlasništvo naloga i javlja ti kada završi brisanje.
          </p>
          <p>
            Ako vodiš djelatnost, navedi treba li je ukloniti ili prenijeti drugom vlasniku. Podaci
            o izvršenim uplatama mogu se zadržati radi zakonskih obaveza.
          </p>
        </>
      ) : (
        <p>
          {supportSubjects[target.subject]} · {target.reference}
        </p>
      )}
      {account && (
        <RequestForm
          key={account.id + target.subject + target.reference}
          actor={account.id}
          target={target}
        />
      )}
      <section className={styles.section}>
        <h2>{account ? "Kontakt podrške" : "Pošalji zahtjev emailom"}</h2>
        <p>
          {deletion
            ? "Piši s email adrese vezane za nalog. U naslov stavi „Brisanje AhiBizz naloga“. Zahtjev možeš poslati i nakon deinstalacije aplikacije."
            : "U poruci navedi sadržaj koji prijavljuješ i razlog prijave."}
        </p>
        <a href={email}>{supportEmail}</a>
      </section>
    </main>
  );
}
