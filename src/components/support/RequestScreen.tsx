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
            Zahtjev obuhvata cijeli nalog. Podrška provjerava da zahtjev šalje vlasnik naloga i
            obrađuje ga najkasnije u roku od 30 dana.
          </p>
          <section className={styles.section}>
            <h2>Želiš obrisati samo dio?</h2>
            <p>Za ovo ne treba brisati nalog:</p>
            <ul>
              <li>
                <Link href="/nalog?odjeljak=djelatnosti">Moje djelatnosti</Link>: izbriši pojedinu
                djelatnost s njenim fotografijama, opisom, kontaktom, lokacijom i Reelsima.
              </li>
              <li>
                <Link href="/nalog/reels">Moji reels</Link>: obriši Reel prije isteka. Svaki Reel se
                ionako sam briše 24 sata nakon objave.
              </li>
              <li>Recenziju koju si napisao možeš povući na profilu djelatnosti.</li>
            </ul>
          </section>
          <section className={styles.section}>
            <h2>Prije zahtjeva</h2>
            <ul>
              <li>
                <strong>Otvoreni termini i rezervacije</strong> (kao gost ili kao djelatnost):
                otkaži ih ili ih završi u kalendaru. Dok postoje, brisanje se ne može dovršiti.
              </li>
              <li>
                <strong>Djelatnosti na tvom nalogu</strong>: izbriši ih u Mojim djelatnostima. Ako
                djelatnost treba voditi druga osoba, u zahtjevu navedi njen AhiBizz email za prenos
                vlasništva. Podrška provjerava prenos prije nego što ga izvrši.
              </li>
            </ul>
          </section>
          <section className={styles.section}>
            <h2>Šta se briše, a šta ostaje</h2>
            <p>
              Brišu se prijava i sesije, profil i njegove fotografije, uređaji za obavijesti,
              sačuvane pretrage i favoriti, veze i blokade, tvoje recenzije, tvoji Reels i tvoje
              prijave podršci. Tekst tvojih poruka zamjenjuje se oznakom „[Poruka obrisana]“, a
              tvoje ime i kontakt uklanjaju se iz rezervacija.
            </p>
            <p>
              Ostaju anonimizirani identifikator naloga, zapisi o prošlim terminima kod djelatnosti
              bez tvog imena i kontakta, poruke koje su drugi korisnici poslali tebi te evidencija
              uplata i isticanja koju moramo čuvati zbog zakonskih obaveza.
            </p>
          </section>
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
