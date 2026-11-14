import Image from "next/image";
import Link from "next/link";
import { DirectoryResultCard } from "../../components/directory/DirectoryResultCard";
import directoryStyles from "../../components/directory/public-search.module.css";
import { EmptyDirectory } from "../../components/EmptyDirectory";
import { Icon } from "../../components/Icon";
import { SearchForm } from "../../components/SearchForm";
import {
  type DirectoryCategory,
  getDirectoryService,
  type PublicDirectoryBusiness,
} from "../../server/directory";
import { publicBusinessView } from "../../server/directory/public-view";

export const dynamic = "force-dynamic";
export default async function HomePage() {
  let available = false;
  let businesses: PublicDirectoryBusiness[] = [];
  let categories: DirectoryCategory[] = [];
  try {
    const service = getDirectoryService();
    if (service) {
      const [result, classification] = await Promise.all([
        service.listPublic(),
        service.categories(),
      ]);
      businesses = result.items.slice(0, 4);
      categories = classification.categories;
      available = true;
    }
  } catch {
    /* Keep unavailable distinct from a truly empty directory. */
  }
  return (
    <main id="glavni-sadrzaj">
      <section className="home-hero container" aria-labelledby="hero-title">
        <div className="hero-copy">
          <span className="eyebrow">
            <span className="gold-dash" />
            Tvoj grad. Tvoj krug.
          </span>
          <h1 id="hero-title">
            Dobre usluge.
            <br />
            <span className="heading-accent">Bliže tebi.</span>
          </h1>
          <p className="hero-description">
            Mjesto gdje se lokalne djelatnosti i ljudi lakše pronalaze.
          </p>
          <SearchForm />
          <p className="hero-note">
            <span className="status-dot" />
            Novi imenik je u pripremi.
          </p>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="art-grid" />
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <span className="art-dot art-dot-one" />
          <span className="art-dot art-dot-two" />
          <span className="art-dot art-dot-three" />
          <div className="art-wordmark">
            <Image src="/brand/ahi-logo-white.svg" alt="" width={225} height={61} unoptimized />
            <span>
              Poslovi su lokalni.
              <br />
              Povezanost je sve.
            </span>
          </div>
          <div className="art-caption">
            <span>Upoznaj ono blizu sebe</span>
            <Icon name="arrow" />
          </div>
        </div>
      </section>

      <section className="directory-section section-space" aria-labelledby="directory-title">
        <div className="container">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Istraži lokalno</p>
              <h2 id="directory-title">Svaki dobar posao ima svoju priču.</h2>
            </div>
            <Link className="text-link" href="/pretraga">
              Otvori imenik
              <Icon name="arrow" />
            </Link>
          </div>
          {businesses.length ? (
            <div className={directoryStyles.grid}>
              {businesses.map((business) => (
                <DirectoryResultCard
                  key={business.id}
                  business={publicBusinessView(business, categories)}
                />
              ))}
            </div>
          ) : available ? (
            <EmptyDirectory />
          ) : (
            <p className="hero-note">Imenik trenutno nije dostupan.</p>
          )}
        </div>
      </section>

      <section className="container owner-section section-space" aria-labelledby="owner-title">
        <div className="owner-mark" aria-hidden="true">
          <Icon name="shop" />
          <span />
        </div>
        <div className="owner-copy">
          <p className="eyebrow">Za lokalne djelatnosti</p>
          <h2 id="owner-title">
            Iza svakog posla
            <br />
            stoji neko svoj.
          </h2>
          <p>Gradimo jednostavno mjesto za predstavljanje djelatnosti, dogovore i termine.</p>
          <Link className="text-link" href="/o-nama">
            Više o ideji
            <Icon name="arrow" />
          </Link>
        </div>
        <span className="quiet-badge">Vlasnički prostor je u izradi</span>
      </section>
    </main>
  );
}
