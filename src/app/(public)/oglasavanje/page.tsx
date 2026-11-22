import Link from "next/link";
import { Icon, type IconName } from "../../../components/Icon";
import { AdExplorer } from "../../../components/marketing/AdExplorer";
import styles from "../../../components/marketing/ad-guide.module.css";
import { volumeLabels } from "../../../lib/ad-pricing";
import { IS_PLAY_EDITION } from "../../../lib/distribution";
import { categoryPromotionPriceBamMinor } from "../../../lib/marketing";
import { supportEmail } from "../../../lib/support-requests";
import { formatCreditsFromBam } from "../../../lib/wallet";
import { publicOptInAudience } from "../../../server/ad-audience-sample";
import { getAuthDatabasePool } from "../../../server/auth/service";
import { publicDirectoryCounts } from "../../../server/directory/read-service";
import { publicAdAudience } from "../../../server/marketing/ad-delivery";
import { getPublicAdPricing } from "../../../server/marketing/ad-pricing";
import { readPlatformCreditsOnly } from "../../../server/wallet/platform-policy";
import { readWalletRate } from "../../../server/wallet/service";

export const metadata = {
  title: "Oglašavanje na AhiBizzu",
  description:
    "Pregledaj pozicije oglasa na telefonu i računaru, izračunaj cijenu kampanje i zatraži ponudu za svoju djelatnost.",
};
export const dynamic = "force-dynamic";

const targeting: { title: string; detail: string; icon: IconName }[] = [
  {
    title: "Lokacija",
    detail:
      "Odabrani gradovi pretrage ili poslovnog profila. Na profilu se može birati i država djelatnosti.",
    icon: "pin",
  },
  {
    title: "Vrijeme",
    detail:
      "Odaberi početak, broj dana i sate emitiranja u svojoj vremenskoj zoni, uključujući termine preko ponoći.",
    icon: "calendar",
  },
  { title: "Kategorija", detail: "Djelatnosti u odabranoj poslovnoj kategoriji.", icon: "shop" },
  { title: "Ključna riječ", detail: "Upit koji posjetilac unese u pretragu.", icon: "search" },
  {
    title: "Raspon cijena",
    detail: "Poslovni profili s objavljenom uslugom ili ponudom u odabranom rasponu cijena.",
    icon: "card",
  },
  {
    title: "Spol",
    detail:
      "Na poslovnim profilima, za posjetioce koji su sami uključili ovu postavku oglasa. Izuzete su kreditne ponude.",
    icon: "people",
  },
];
const formatNumber = (value: number) => new Intl.NumberFormat("bs-BA").format(value);
const platformNames = { android: "Android", ios: "iOS", desktop: "Računar", other: "Ostalo" };

export default async function PromotionPage() {
  const creditsOnly = readPlatformCreditsOnly();
  const pool = creditsOnly ? getAuthDatabasePool() : null;
  const [pricing, audience, directory, sample, walletRate] = await Promise.all([
    getPublicAdPricing(),
    publicAdAudience(),
    publicDirectoryCounts(),
    publicOptInAudience(),
    pool ? readWalletRate(pool).catch(() => null) : null,
  ]);
  // The audience section appears only once there are measured campaign results or an opt-in sample.
  const hasAudience = Boolean((audience && audience.impressions > 0) || sample);
  const contactPhone =
    pricing?.contactPhone && /^\+[1-9]\d{6,14}$/.test(pricing.contactPhone)
      ? pricing.contactPhone
      : null;
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroContent}>
          <h1>
            Oglašavanje na <em>AhiBizzu.</em>
          </h1>
          <p>
            Predstavi svoju djelatnost ljudima koji traže usluge u tvom gradu i širom poslovne
            mreže.
          </p>
          {directory && (
            <dl className={styles.heroMetrics}>
              <div>
                <dt>Objavljene djelatnosti</dt>
                <dd>{formatNumber(directory.businesses)}</dd>
              </div>
              <div>
                <dt>Aktivne kategorije</dt>
                <dd>{formatNumber(directory.categories)}</dd>
              </div>
            </dl>
          )}
          <div className={styles.heroButtons}>
            <a className={styles.primary} href="#pozicije">
              Pregledaj pozicije <Icon name="arrow" />
            </a>
            <a href={`mailto:${supportEmail}?subject=Upit%20za%20ogla%C5%A1avanje`}>
              <Icon name="mail" /> Piši nam
            </a>
            {contactPhone && (
              <a href={`tel:${contactPhone}`}>
                <Icon name="phone" /> Pozovi
              </a>
            )}
          </div>
        </div>
      </header>
      <nav className={styles.nav} aria-label="Dijelovi vodiča za oglašavanje">
        <a href="#pozicije">Pozicije</a>
        <a href="#cjenovnik">Cjenovnik</a>
        <a href="#ciljanje">Ciljanje</a>
        {hasAudience && <a href="#publika">Publika</a>}
        <a href="#uslovi">Uslovi</a>
      </nav>
      <AdExplorer pricing={pricing} creditRate={creditsOnly ? walletRate : undefined} />
      <section className={styles.section} id="ciljanje">
        <h2>Kome se kampanja prikazuje?</h2>
        <div className={`${styles.tiles} ${styles.targetTiles}`}>
          {targeting.map((t) => (
            <article key={t.title}>
              <Icon name={t.icon} />
              <h3>{t.title}</h3>
              <p>{t.detail}</p>
            </article>
          ))}
        </div>
      </section>
      {hasAudience && (
        <section className={styles.section} id="publika">
          <h2>Publika AhiBizza</h2>
          {audience && audience.impressions > 0 ? (
            <>
              <p className={styles.note}>
                Izmjereni rezultati kampanja u posljednjih 30 dana. Jedna osoba može ostvariti više
                prikaza.
              </p>
              <dl className={styles.metrics}>
                {(
                  [
                    ["Prikazi", audience.impressions],
                    ["Klikovi", audience.clicks],
                    ["Prikazi na telefonu", audience.mobile],
                    ["Prikazi na računaru", audience.desktop],
                  ] as const
                ).map(([label, total]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{formatNumber(total)}</dd>
                  </div>
                ))}
              </dl>
              <h3>Prikazi prema platformi</h3>
              <dl className={styles.platforms}>
                {(
                  [
                    ["Android", audience.platforms.android],
                    ["iOS", audience.platforms.ios],
                    ["Desktop", audience.platforms.desktop],
                    ["Ostalo", audience.platforms.other],
                  ] as const
                ).map(([label, total]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{formatNumber(total)}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : null}
          {sample && (
            <article className={styles.sample}>
              <h3>Posjete AhiBizzu</h3>
              <p>
                Dobrovoljni uzorak korisnika koji su uključili statistiku tokom posljednjih 30 dana.
              </p>
              <dl className={styles.platforms}>
                <div>
                  <dt>Korisnici</dt>
                  <dd>{formatNumber(sample.users)}</dd>
                </div>
                <div>
                  <dt>Posjete</dt>
                  <dd>{formatNumber(sample.visits)}</dd>
                </div>
                <div>
                  <dt>Pregledi stranica</dt>
                  <dd>{formatNumber(sample.views)}</dd>
                </div>
              </dl>
              {sample.platforms.length > 0 && (
                <div className={styles.tableWrap}>
                  <table>
                    <caption>
                      Podaci po platformama iz dobrovoljnog uzorka. Jedna osoba može koristiti više
                      uređaja.
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Platforma</th>
                        <th scope="col">Korisnici</th>
                        <th scope="col">Posjete</th>
                        <th scope="col">Pregledi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sample.platforms.map((row) => (
                        <tr key={row.platform}>
                          <th scope="row">{platformNames[row.platform]}</th>
                          <td>{formatNumber(row.users)}</td>
                          <td>{formatNumber(row.visits)}</td>
                          <td>{formatNumber(row.views)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {sample.regions.length > 0 && (
                <>
                  <h3>Regije koje su korisnici odabrali</h3>
                  <dl className={styles.platforms}>
                    {sample.regions.map((row) => (
                      <div key={row.region}>
                        <dt>{row.region}</dt>
                        <dd>{formatNumber(row.users)}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              )}
            </article>
          )}
        </section>
      )}
      <section id="uslovi" className={styles.section}>
        <h2>Uslovi oglašavanja</h2>
        <div className={styles.panels}>
          <article>
            <h3>Popusti na kampanje</h3>
            {pricing ? (
              <>
                <dl className={styles.discountList}>
                  {volumeLabels.map((label, i) => (
                    <div key={label}>
                      <dt>{label} prikaza</dt>
                      <dd>{pricing.terms.volumePercent[i]}%</dd>
                    </div>
                  ))}
                  <div>
                    <dt>Avansni popust</dt>
                    <dd>{pricing.terms.advancePercent}%</dd>
                  </div>
                  <div>
                    <dt>Popust dobrodošlice</dt>
                    <dd>{pricing.terms.welcomePercent}%</dd>
                  </div>
                </dl>
                <p>
                  Primjenjuje se najveći odobreni popust. Minimalni zakup banera iznosi{" "}
                  {creditsOnly
                    ? formatCreditsFromBam(pricing.terms.minimumMinor, walletRate)
                    : `${formatNumber(pricing.terms.minimumMinor / 100)} KM`}
                  .
                </p>
              </>
            ) : (
              <p>Za uslove zakupa zatraži ponudu.</p>
            )}
          </article>
          <article>
            <h3>Priprema oglasa</h3>
            <ul className={styles.specs}>
              <li>
                Pripremi sliku u dimenzijama odabranog formata. U pregledu možeš isprobati JPG, PNG,
                WebP ili GIF do 1.000 KB.
              </li>
              <li>
                Za objavu odaberi fotografiju svoje djelatnosti ili priloži pripremljeni JPG, PNG,
                WebP, GIF, MP4 ili HTML5 do 1.000 KB. Tim pregleda materijal prije slanja ponude.
              </li>
              <li>
                HTML5 baner pripremi u jednoj datoteci s ugrađenim slikama i stilovima, bez vanjskih
                skripti i praćenja posjetilaca.
              </li>
              <li>
                {creditsOnly
                  ? "U ponudi vidiš cijenu i uslove prije plaćanja Ahi kreditima."
                  : "U ponudi vidiš cijenu i uslove prije plaćanja karticom, PayPalom ili Ahi kreditima."}
              </li>
            </ul>
          </article>
        </div>
      </section>
      {!IS_PLAY_EDITION && (
        <section className={styles.section}>
          <h2>Isticanje djelatnosti</h2>
          <div className={styles.tiles}>
            <article>
              <Icon name="shop" />
              <h3>U kategoriji</h3>
              <p>
                Istakni objavljenu djelatnost na 7 dana ·{" "}
                {creditsOnly
                  ? formatCreditsFromBam(categoryPromotionPriceBamMinor, walletRate)
                  : "10 KM"}
                .
              </p>
              <Link href="/naplata">
                Odaberi djelatnost <Icon name="chevron" />
              </Link>
            </article>
            <article>
              <Icon name="pin" />
              <h3>U blizini</h3>
              <p>Istakni se među djelatnostima na svojoj lokaciji.</p>
              <Link href="/nalog?odjeljak=oglasi">
                Moji oglasi <Icon name="chevron" />
              </Link>
            </article>
            <article>
              <Icon name="home" />
              <h3>Na početnoj</h3>
              <p>Predstavi se posjetiocima iz svih gradova.</p>
              <Link href="/nalog?odjeljak=oglasi">
                Zatraži isticanje <Icon name="chevron" />
              </Link>
            </article>
            <article>
              <Icon name="star" />
              <h3>Uz paket</h3>
              <p>Provjeri dane isticanja u Poslovnom ili Premium paketu.</p>
              <Link href="/paketi">
                Uporedi pakete <Icon name="chevron" />
              </Link>
            </article>
          </div>
        </section>
      )}
      <section className={styles.contact}>
        <div>
          <h2>Razgovarajmo o tvojoj kampanji</h2>
          <p>Pošalji nam cilj, termin i budžet.</p>
        </div>
        <a href={`mailto:${supportEmail}?subject=Upit%20za%20kampanju`}>
          <Icon name="mail" />
          {supportEmail}
        </a>
        {contactPhone && (
          <a href={`tel:${contactPhone}`}>
            <Icon name="phone" />
            {contactPhone}
          </a>
        )}
      </section>
      <section className={styles.publish}>
        <h2>Dodaj svoju djelatnost</h2>
        <p>Otvori poslovni profil kako bi te kupci mogli pronaći i kontaktirati.</p>
        <Link className={styles.primary} href="/nalog?odjeljak=djelatnosti">
          Moje djelatnosti <Icon name="arrow" />
        </Link>
      </section>
    </main>
  );
}
