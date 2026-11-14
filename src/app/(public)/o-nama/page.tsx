import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "../../../components/Icon";

export const metadata: Metadata = { title: "O AhiBizzu" };

export default function AboutPage() {
  return (
    <main id="glavni-sadrzaj" className="about-page container">
      <section className="about-intro">
        <span className="eyebrow">
          <span className="gold-dash" />
          Ideja je jednostavna
        </span>
        <h1>
          Lokalno počinje
          <br />
          <span className="heading-accent">s ljudima.</span>
        </h1>
        <p>
          Dobri poslovi često su nam nadohvat ruke. AhiBizz nastaje da ih lakše pronađemo — i da
          ljudi koji iza njih stoje dobiju svoje mjesto.
        </p>
      </section>
      <section className="about-principles" aria-label="Smjer nove platforme">
        <article>
          <span className="feature-icon">
            <Icon name="shop" />
          </span>
          <span className="step-number">01</span>
          <h2>Pronađi.</h2>
          <p>Lokalne djelatnosti i usluge, predstavljene jasno.</p>
        </article>
        <article>
          <span className="feature-icon">
            <Icon name="message" />
          </span>
          <span className="step-number">02</span>
          <h2>Dogovori se.</h2>
          <p>Jednostavniji kontakt s ljudima koji rade posao.</p>
        </article>
        <article>
          <span className="feature-icon">
            <Icon name="calendar" />
          </span>
          <span className="step-number">03</span>
          <h2>Nađi svoj termin.</h2>
          <p>Pregledna dostupnost i manje nepotrebnog dopisivanja.</p>
        </article>
      </section>
      <section className="about-status">
        <div>
          <p className="eyebrow">Tek počinjemo</p>
          <h2>Prostor se gradi pažljivo.</h2>
          <p>
            Nova platforma je u pripremi. Profili djelatnosti, poruke i online termini još nisu
            otvoreni.
          </p>
        </div>
        <Link className="button button-navy" href="/pretraga">
          Pogledaj imenik
          <Icon name="arrow" />
        </Link>
      </section>
    </main>
  );
}
