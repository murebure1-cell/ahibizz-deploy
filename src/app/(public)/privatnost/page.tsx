import Link from "next/link";
import styles from "../../../components/support/resources.module.css";
import { IS_PLAY_EDITION } from "../../../lib/distribution";
import { supportEmail } from "../../../lib/support-requests";

export const metadata = { title: "Privatnost i podrška" };

// Keep this page in line with what the code actually stores and sends. Owner decisions and the ones
// still open (retention of financial records and server logs) are listed in docs/handover/PRIVATNOST.md.
export default function PrivacyPage() {
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <h1>Privatnost na AhiBizzu</h1>
      <p>
        Ovdje piše koje podatke AhiBizz koristi, zašto, ko ih vidi i koliko dugo ostaju. Isto važi
        za web i za Android aplikaciju.
      </p>

      <section className={styles.section}>
        <h2>Ko je odgovoran za podatke</h2>
        <p>
          Upravljač podataka je Ajdin Tabaković, Tuzla, Bosna i Hercegovina. Za sva pitanja o
          privatnosti piši na <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.
        </p>
        <p>
          AhiBizz je namijenjen osobama od 18 ili više godina. Mlađe osobe ne mogu otvoriti nalog.
        </p>
      </section>

      <section className={styles.section}>
        <h2>Obavezni podaci za nalog</h2>
        <ul>
          <li>Ime i email adresa: prijava, potvrda naloga i važne obavijesti o nalogu.</li>
          <li>Lozinka: čuvamo je samo u zaštićenom obliku (hash), nikad kao čitljiv tekst.</li>
          <li>
            Sesija: IP adresa i vrsta preglednika ili uređaja, radi sigurnosti prijave. Sesija
            prestaje odjavom ili istekom.
          </li>
          <li>Prihvatanje pravila zajednice prije objave sadržaja.</li>
        </ul>
        <p>Imenik djelatnosti možeš pregledati i bez naloga.</p>
      </section>

      <section className={styles.section}>
        <h2>Opcionalni podaci</h2>
        <ul>
          <li>
            <strong>Lični profil</strong>: fotografija, naslovna slika, grad, država, opis, vještine
            i radni status prikazuju se prema vidljivosti profila. Datum rođenja je opcionalan i
            privatan; ne prikazuje se na profilu.
          </li>
          <li>
            <strong>Djelatnosti</strong>: naziv, opis, kontakt, adresa, lokacija, radno vrijeme i
            fotografije su javni nakon objave.
          </li>
          <li>
            <strong>Reels</strong>: video i naslovnica vidljivi su najviše 24 sata od objave. Nakon
            toga se snimak i naslovnica automatski brišu. Nedovršen prijenos briše se nakon 24 sata.
          </li>
          <li>
            <strong>Recenzije, poruke i prijave sadržaja</strong>: recenzije su javne, poruke vide
            samo učesnici razgovora, a prijave samo moderatori.
          </li>
          <li>
            <strong>Termini i rezervacije</strong>: ime, email i telefon gosta te vrijeme termina
            vide gost i djelatnost kod koje je termin. Djelatnost može sama upisati gosta koji je
            termin zakazao telefonom; tada te podatke unosi djelatnost.
          </li>
          <li>
            <strong>Aktivnost u aplikaciji</strong>: favoriti, sačuvane pretrage, veze, blokade i
            sviđanja na Reelsima čuvaju se uz nalog.
          </li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2>Lokacija</h2>
        <p>
          Lokacija se koristi samo ako je dopustiš. Za djelatnosti u blizini aplikacija šalje
          serveru koordinate zaokružene na oko 100 m. AhiBizz ih ne sprema uz tvoj nalog. Na uređaju
          se pamti samo približno područje (oko 1 km) najviše 24 sata, da bi rezultati bili odmah
          prikazani. Briše se kad isključiš lokaciju ili se odjaviš.
        </p>
        <p>
          Kad uređuješ lokaciju djelatnosti, tvoj preglednik šalje upisanu adresu ili odabranu tačku
          na karti direktno servisu Photon (komoot), koji pronalazi adresu. Ako tu odabereš „moja
          lokacija“, šalju se koordinate tvog uređaja. Karte učitava preglednik direktno od Google
          Maps ili OpenStreetMap; oni primaju područje karte koje gledaš i tvoju IP adresu.
        </p>
      </section>

      <section className={styles.section}>
        <h2>Obavijesti i email</h2>
        <p>
          Za obavijesti na uređaju čuvamo pretplatu uređaja. Obavijesti dostavlja push servis tvog
          preglednika ili telefona (na Androidu obično Google). Email za prijavu, potvrdu naloga i
          obavijesti šaljemo preko pružaoca email usluge. Obavijesti možeš isključiti u Postavkama,
          a dozvole u postavkama uređaja.
        </p>
      </section>

      <section className={styles.section}>
        <h2>Ko još obrađuje podatke</h2>
        <p>
          OctaDeploy za hosting aplikacije i baze podataka, pružalac email usluge, push servis
          preglednika ili telefona, Photon (komoot) za adrese te Google Maps ili OpenStreetMap za
          karte. Aplikacija ne koristi oglasni identifikator uređaja.
        </p>
        <p>
          {IS_PLAY_EDITION
            ? "Aplikacija nema kupovina ni plaćanja."
            : "Plaćanje isticanja na webu ide bankovnom uplatom. Android aplikacija nema kupovina ni plaćanja."}
        </p>
      </section>

      <section className={styles.section}>
        <h2>Koliko dugo čuvamo podatke</h2>
        <ul>
          <li>Nalog i sadržaj: dok ih ne obrišeš ili ne zatražiš brisanje naloga.</li>
          <li>Reels: najviše 24 sata od objave, zatim se snimak i naslovnica brišu.</li>
          <li>Približna lokacija na uređaju: najviše 24 sata.</li>
          <li>
            Nakon brisanja naloga ostaju samo anonimizirani identifikator, prošli termini bez tvog
            imena i kontakta, poruke drugih korisnika te evidencija uplata koju moramo čuvati zbog
            zakonskih obaveza.
          </li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2>Tvoja prava</h2>
        <p>
          Podatke profila i djelatnosti ispravljaš sam u nalogu. Možeš zatražiti uvid u svoje
          podatke, njihovu ispravku ili brisanje te postaviti pitanje o obradi. Zahtjeve obrađujemo
          najkasnije u roku od 30 dana i odgovaramo s adrese podrške.
        </p>
        <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
        <ul>
          <li>
            <Link href="/brisanje-naloga">Brisanje naloga i podataka</Link>: šta se briše, šta
            ostaje i kako poslati zahtjev, i bez aplikacije.
          </li>
          <li>
            Samo djelatnost ili Reel brišeš u nalogu, pod Mojim djelatnostima i Mojim reelsima.
          </li>
          <li>
            Zloupotrebu prijavi na profilu, recenziji, Reelu ili u razgovoru. Korisnika možeš
            blokirati.
          </li>
        </ul>
      </section>
    </main>
  );
}
