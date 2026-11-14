"use client";

import Form from "next/form";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Icon, type IconName } from "../Icon";
import { BusinessCard } from "./BusinessCard";
import { previewBusinesses } from "./data";
import { PreviewInstall } from "./PreviewPwa";
import { usePreviewState } from "./PreviewState";

const categories: { name: string; label: string; icon: IconName }[] = [
  { name: "Ljepota i zdravlje", label: "Za tebe", icon: "heart" },
  { name: "Dom i uređenje", label: "Za dom", icon: "home" },
  { name: "Hrana i piće", label: "Hrana i piće", icon: "coffee" },
  { name: "Servisi i usluge", label: "Usluge", icon: "shop" },
];

export function PreviewHome() {
  const { place, setPlace } = usePreviewState();
  const [choosingPlace, setChoosingPlace] = useState(false);
  const [paused, setPaused] = useState(false);
  const nearby = previewBusinesses.filter((business) => business.location === place);
  return (
    <main id="glavni-sadrzaj" className="preview-home">
      <section className="preview-hero" aria-labelledby="preview-home-title">
        <Image
          className="preview-hero-photo"
          src="/preview/hero.webp"
          alt=""
          fill
          sizes="100vw"
          fetchPriority="high"
        />
        <div className="preview-container preview-hero-content">
          <div className="hero-location">
            <Icon name="pin" /> Ljudi i poslovi, blizu tebe
          </div>
          <h1 id="preview-home-title">
            Pronađi pravu
            <br />
            uslugu<span>.</span>
          </h1>
          <p>Od dobrog majstora do mjesta za predah.</p>
          <Form action="/pregled/pretraga" className="preview-search">
            <label>
              <Icon name="search" />
              <span className="visually-hidden">Naziv ili usluga</span>
              <input type="search" name="q" placeholder="Šta tražiš?" />
            </label>
            <label className="preview-search-place">
              <Icon name="pin" />
              <span className="visually-hidden">Grad ili mjesto</span>
              <input name="place" placeholder="Grad ili mjesto" />
            </label>
            <button type="submit" className="preview-search-submit">
              <Icon name="search" />
              <span>Pretraži</span>
            </button>
          </Form>
        </div>
      </section>

      <nav className="preview-container preview-categories" aria-label="Popularne kategorije">
        {categories.map((category) => (
          <Link
            key={category.name}
            href={`/pregled/pretraga?category=${encodeURIComponent(category.name)}`}
          >
            <span>
              <Icon name={category.icon} />
            </span>
            {category.label}
          </Link>
        ))}
      </nav>

      <section className="preview-container preview-section" aria-labelledby="featured-heading">
        <div className="preview-section-heading">
          <div>
            <span className="preview-kicker">IZ CIJELE ZAJEDNICE</span>
            <h2 id="featured-heading">Istaknute djelatnosti</h2>
          </div>
          <Link href="/pregled/pretraga" className="preview-subtle-link">
            Pogledaj sve <Icon name="chevron" />
          </Link>
        </div>
        <div className="preview-business-grid">
          {previewBusinesses.map((business) => (
            <BusinessCard key={business.id} business={business} />
          ))}
        </div>
      </section>

      <section className="preview-container preview-ad" aria-label="Oglasni prostor">
        <div>
          <span className="preview-kicker">OGLASNI PROSTOR</span>
          <h2>
            Tvoj posao.
            <br />
            Na pravom mjestu.
          </h2>
        </div>
        <Link href="/pregled/prostor/oglasavanje" className="preview-button preview-button-dark">
          Oglasi se <Icon name="chevron" />
        </Link>
        <span className="preview-ad-mark" aria-hidden="true">
          a.
        </span>
      </section>

      <section
        className="preview-container preview-section nearby-section"
        aria-labelledby="nearby-heading"
      >
        <div className="preview-section-heading">
          <div>
            <span className="preview-kicker">U KOMŠILUKU</span>
            <h2 id="nearby-heading">Blizu tebe</h2>
          </div>
          <button
            type="button"
            className="preview-place-button"
            aria-expanded={choosingPlace}
            aria-controls="preview-place-picker"
            onClick={() => setChoosingPlace(!choosingPlace)}
          >
            <Icon name="pin" />
            {place}
            <Icon name="chevron" />
          </button>
        </div>
        {choosingPlace && (
          <div id="preview-place-picker" className="preview-place-picker">
            <span>Izaberi grad za pregled</span>
            {["Tuzla", "Sarajevo", "Zenica"].map((city) => (
              <button
                type="button"
                key={city}
                aria-pressed={city === place}
                onClick={() => {
                  setPlace(city);
                  setChoosingPlace(false);
                }}
              >
                {city}
              </button>
            ))}
          </div>
        )}
        <div className="preview-nearby-grid">
          {nearby.map((business) => (
            <BusinessCard key={business.id} business={business} compact />
          ))}
        </div>
      </section>

      <section className="preview-partners" aria-label="Poslovna mreža">
        <div className="preview-container preview-partners-heading">
          <span>Mjesto za tvoju poslovnu mrežu.</span>
          <button
            type="button"
            aria-label={paused ? "Pokreni traku logotipa" : "Zaustavi traku logotipa"}
            aria-pressed={paused}
            onClick={() => setPaused(!paused)}
          >
            <Icon name={paused ? "play" : "pause"} />
          </button>
        </div>
        <div className={`preview-logo-track${paused ? " is-paused" : ""}`}>
          {[0, 1].map((copy) => (
            <div
              className="preview-logo-group"
              key={copy}
              aria-hidden={copy === 1 ? true : undefined}
            >
              {[0, 1, 2, 3, 4, 5].map((item) => (
                <Image
                  key={item}
                  src="/brand/ahi-logo-color.svg"
                  alt={copy === 0 && item === 0 ? "AhiBizz" : ""}
                  width={142}
                  height={40}
                  unoptimized
                />
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="preview-container preview-credits">
        <div className="preview-credits-icon" aria-hidden="true">
          a<span>c</span>
        </div>
        <div>
          <span className="preview-kicker">AHI CREDITS</span>
          <h2>
            Daj svom poslu
            <br />
            više prostora.
          </h2>
          <p>Istakni se tamo gdje te ljudi traže.</p>
        </div>
        <Link href="/pregled/prostor/credits" className="preview-button">
          Upoznaj Credits <Icon name="chevron" />
        </Link>
      </section>

      <PreviewInstall />
      <footer className="preview-footer preview-container">
        <Image src="/brand/ahi-logo-color.svg" alt="AhiBizz" width={125} height={34} unoptimized />
        <Link href="/o-nama">O projektu</Link>
        <span>Pregled novog izgleda</span>
      </footer>
    </main>
  );
}
