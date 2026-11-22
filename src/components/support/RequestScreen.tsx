import { headers } from "next/headers";
import Link from "next/link";
import { reelPath } from "../../lib/reel-navigation";
import {
  reportUrl,
  type SupportTarget,
  supportEmail,
  supportSubjects,
} from "../../lib/support-requests";
import { getAccountService } from "../../server/auth/accounts";
import { RequestForm } from "./RequestForm";
import styles from "./resources.module.css";

export async function RequestScreen({ target }: { target: SupportTarget }) {
  const deletion = target.subject === "deletion";
  const reel = target.subject === "reel";
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
      {reel ? (
        <Link href={reelPath(target.reference)}>Nazad na Reel</Link>
      ) : (
        <Link href="/privatnost">Privatnost i podrška</Link>
      )}
      <h1>{deletion ? "Brisanje AhiBizz naloga" : reel ? "Prijavi Reel" : "Prijavi sadržaj"}</h1>
      {deletion ? (
        <>
          <p>
            Zahtjev obuhvata tvoj nalog, profil, slike i povezane lične podatke. Podrška provjerava
            vlasništvo i obrađuje zahtjev.
          </p>
          <p>
            Ako vodiš djelatnost, dogovori njen prenos ili uklanjanje s podrškom. Podaci o izvršenim
            uplatama mogu se zadržati radi zakonskih obaveza.
          </p>
        </>
      ) : !reel ? (
        <p>
          {supportSubjects[target.subject]} · {target.reference}
        </p>
      ) : null}
      {reel && !account && (
        <Link href={`/prijava?nastavi=${encodeURIComponent(reportUrl("reel", target.reference))}`}>
          Prijavi se za slanje prijave
        </Link>
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
