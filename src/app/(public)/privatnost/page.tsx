import Link from "next/link";
import help from "../../../components/content-hub/help.module.css";
import { Icon } from "../../../components/Icon";
import { rich } from "../../../components/i18n/Rich";
import styles from "../../../components/support/resources.module.css";
import { supportEmail } from "../../../lib/support-requests";
import { getTranslator, titled } from "../../../server/i18n";

export const generateMetadata = titled("Privatnost i podrška");

// Keep this page in line with what the code actually stores and sends. Owner decisions and the ones
// still open (retention of financial records and server logs) are listed in docs/handover/PRIVATNOST.md.
export default async function PrivacyPage() {
  const t = await getTranslator();
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <Link href="/pomoc" className={help.back} aria-label={t("Nazad na pomoć")}>
        <Icon name="arrow" aria-hidden="true" />
      </Link>
      <h1>{t("Privatnost na AhiBizzu")}</h1>
      <p>
        {t(
          "Ovdje piše koje podatke AhiBizz koristi, zašto, ko ih vidi i koliko dugo ostaju. Isto važi za web i za Android aplikaciju.",
        )}
      </p>

      <section className={styles.section}>
        <h2>{t("Ko je odgovoran za podatke")}</h2>
        <p>
          {rich(
            t(
              "Upravljač podataka je Ajdin Tabaković, Tuzla, Bosna i Hercegovina. Za sva pitanja o privatnosti piši na {email}.",
            ),
            { email: <a href={`mailto:${supportEmail}`}>{supportEmail}</a> },
          )}
        </p>
        <p>
          {t(
            "AhiBizz je namijenjen osobama od 18 ili više godina. Mlađe osobe ne mogu otvoriti nalog.",
          )}
        </p>
      </section>

      <section className={styles.section}>
        <h2>{t("Obavezni podaci za nalog")}</h2>
        <ul>
          <li>{t("Ime i email adresa: prijava, potvrda naloga i važne obavijesti o nalogu.")}</li>
          <li>
            {t("Lozinka: čuvamo je samo u zaštićenom obliku (hash), nikad kao čitljiv tekst.")}
          </li>
          <li>
            {t(
              "Sesija: IP adresa i vrsta preglednika ili uređaja, radi sigurnosti prijave. Sesija prestaje odjavom ili istekom.",
            )}
          </li>
          <li>{t("Prihvatanje pravila zajednice prije objave sadržaja.")}</li>
        </ul>
        <p>{t("Imenik djelatnosti možeš pregledati i bez naloga.")}</p>
      </section>

      <section className={styles.section}>
        <h2>{t("Opcionalni podaci")}</h2>
        <ul>
          <li>
            <strong>{t("Lični profil")}</strong>:{" "}
            {t(
              "fotografija, naslovna slika, grad, država, opis, vještine i radni status prikazuju se prema vidljivosti profila. Datum rođenja je opcionalan i privatan; ne prikazuje se na profilu.",
            )}
          </li>
          <li>
            <strong>{t("Djelatnosti")}</strong>:{" "}
            {t(
              "naziv, opis, kontakt, adresa, lokacija, radno vrijeme i fotografije su javni nakon objave.",
            )}
          </li>
          <li>
            <strong>{t("Reels")}</strong>:{" "}
            {t(
              "video i naslovnica vidljivi su najviše 24 sata od objave. Nakon toga se snimak i naslovnica automatski brišu. Nedovršen prijenos briše se nakon 24 sata.",
            )}
          </li>
          <li>
            <strong>{t("Recenzije, poruke i prijave sadržaja")}</strong>:{" "}
            {t(
              "recenzije su javne, poruke vide samo učesnici razgovora, a prijave samo moderatori.",
            )}
          </li>
          <li>
            <strong>{t("Termini i rezervacije")}</strong>:{" "}
            {t(
              "ime, email i telefon gosta te vrijeme termina vide gost i djelatnost kod koje je termin. Djelatnost može sama upisati gosta koji je termin zakazao telefonom; tada te podatke unosi djelatnost.",
            )}
          </li>
          <li>
            <strong>{t("Aktivnost u aplikaciji")}</strong>:{" "}
            {t(
              "favoriti, sačuvane pretrage, veze, blokade i sviđanja na Reelsima čuvaju se uz nalog.",
            )}
          </li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2>{t("Lokacija")}</h2>
        <p>
          {t(
            "Lokacija se koristi samo ako je dopustiš. Za djelatnosti u blizini aplikacija šalje serveru koordinate zaokružene na oko 100 m. AhiBizz ih ne sprema uz tvoj nalog. Na uređaju se pamti samo približno područje (oko 1 km) najviše 24 sata, da bi rezultati bili odmah prikazani. Briše se kad isključiš lokaciju ili se odjaviš.",
          )}
        </p>
        <p>
          {t(
            "Kad uređuješ lokaciju djelatnosti, tvoj preglednik šalje upisanu adresu ili odabranu tačku na karti direktno servisu Photon (komoot), koji pronalazi adresu. Ako tu odabereš „moja lokacija“, šalju se koordinate tvog uređaja. Karte učitava preglednik direktno od Google Maps; Google prima područje karte koje gledaš i tvoju IP adresu.",
          )}
        </p>
        <p>
          {t(
            "Kad otvoriš uputstva do djelatnosti, preglednik šalje Googleu tvoju lokaciju i lokaciju djelatnosti da bi izračunao putanju. Dok ideš po putanji, tvoje kretanje ostaje na uređaju; lokacija se Googleu šalje ponovo samo ako skreneš s putanje, da bi se ona izračunala iznova.",
          )}
        </p>
      </section>

      <section className={styles.section}>
        <h2>{t("Obavijesti i email")}</h2>
        <p>
          {t(
            "Za obavijesti na uređaju čuvamo pretplatu uređaja. Obavijesti dostavlja push servis tvog preglednika ili telefona (na Androidu obično Google). Email za prijavu, potvrdu naloga i obavijesti šaljemo preko pružaoca email usluge. Obavijesti možeš isključiti u Postavkama, a dozvole u postavkama uređaja.",
          )}
        </p>
      </section>

      <section className={styles.section}>
        <h2>{t("Ko još obrađuje podatke")}</h2>
        <p>
          {t(
            "OctaDeploy za hosting aplikacije i baze podataka, pružalac email usluge, push servis preglednika ili telefona, Photon (komoot) za adrese te Google Maps za karte. Aplikacija ne koristi oglasni identifikator uređaja.",
          )}
        </p>
        <p>{t("Aplikacija nema kupovina ni plaćanja.")}</p>
      </section>

      <section className={styles.section}>
        <h2>{t("Koliko dugo čuvamo podatke")}</h2>
        <ul>
          <li>{t("Nalog i sadržaj: dok ih ne obrišeš ili ne zatražiš brisanje naloga.")}</li>
          <li>{t("Reels: najviše 24 sata od objave, zatim se snimak i naslovnica brišu.")}</li>
          <li>{t("Približna lokacija na uređaju: najviše 24 sata.")}</li>
          <li>
            {t(
              "Nakon brisanja naloga ostaju samo anonimizirani identifikator, prošli termini bez tvog imena i kontakta, poruke drugih korisnika te evidencija uplata koju moramo čuvati zbog zakonskih obaveza.",
            )}
          </li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2>{t("Tvoja prava")}</h2>
        <p>
          {t(
            "Podatke profila i djelatnosti ispravljaš sam u nalogu. Možeš zatražiti uvid u svoje podatke, njihovu ispravku ili brisanje te postaviti pitanje o obradi. Zahtjeve obrađujemo najkasnije u roku od 30 dana i odgovaramo s adrese podrške.",
          )}
        </p>
        <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
        <ul>
          <li>
            <Link href="/brisanje-naloga">{t("Brisanje naloga i podataka")}</Link>:{" "}
            {t("šta se briše, šta ostaje i kako poslati zahtjev, i bez aplikacije.")}
          </li>
          <li>
            {t(
              "Samo djelatnost ili Reel brišeš u nalogu, pod Mojim djelatnostima i Mojim reelsima.",
            )}
          </li>
          <li>
            {t(
              "Zloupotrebu prijavi na profilu, recenziji, Reelu ili u razgovoru. Korisnika možeš blokirati.",
            )}
          </li>
        </ul>
      </section>
      <nav className={help.rows} aria-label={t("Pitanja o ovom tekstu")}>
        <Link href="/pomoc#kontakt">
          <Icon name="mail" aria-hidden="true" />
          <span>{t("Piši podršci")}</span>
          <Icon name="chevron" aria-hidden="true" />
        </Link>
      </nav>
    </main>
  );
}
