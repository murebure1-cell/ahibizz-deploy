import Link from "next/link";
import styles from "../../../components/support/resources.module.css";
import { supportEmail } from "../../../lib/support-requests";

export const metadata = { title: "Privatnost i podrška" };
export default function PrivacyPage() {
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <h1>Privatnost na AhiBizzu</h1>
      <section className={styles.section}>
        <h2>Nalog i javni profil</h2>
        <p>
          AhiBizz koristi ime, email adresu i podatke za prijavu za pristup nalogu. Podaci koje
          dodaš na profil, objavljene djelatnosti, fotografije i recenzije prikazuju se prema
          njihovoj vidljivosti. Javni profil uređuješ u svom nalogu.
        </p>
      </section>
      <section className={styles.section}>
        <h2>Lokacija i obavijesti</h2>
        <p>
          Ako dopustiš lokaciju, AhiBizz koristi koordinate za prikaz djelatnosti u blizini.
          Pretraga adresa koristi Photon, a karte OpenStreetMap. Usluge za karte primaju upit ili
          područje karte koje otvaraš.
        </p>
        <p>
          Za obavijesti čuvamo pretplatu uređaja. Obavijesti možeš isključiti u Postavkama, a
          dozvole za lokaciju i obavijesti u postavkama uređaja.
        </p>
      </section>
      <section className={styles.section}>
        <h2>Poruke i termini</h2>
        <p>
          Poruke čuvamo za učesnike razgovora. Neposlani tekst može ostati na uređaju. Podatke o
          zakazanom terminu vide korisnik i vlasnik odgovarajuće djelatnosti. Za hosting, email i
          obavijesti koristimo pružaoce tih usluga.
        </p>
      </section>
      <section className={styles.section}>
        <h2>Prijave i brisanje podataka</h2>
        <p>
          Na profilu, recenziji ili u razgovoru možeš prijaviti zloupotrebu. Za pristup svojim
          podacima, ispravku ili pitanje o privatnosti piši podršci AhiBizza.
        </p>
        <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
        <p>
          <Link href="/brisanje-naloga">Zatraži brisanje naloga i podataka</Link>
        </p>
      </section>
    </main>
  );
}
