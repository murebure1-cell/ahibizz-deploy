import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "../../../components/Icon";
import { getSupportConfig } from "../../../lib/support";

export const metadata: Metadata = { title: "O AhiBizzu" };

export default function AboutPage() {
  return (
    <main id="glavni-sadrzaj" className="about-page container">
      <section className="about-intro">
        <h1>O AhiBizzu</h1>
        <p>
          AhiBizz povezuje ljude i lokalne djelatnosti. Pronađi uslugu, javi se vlasniku ili zakaži
          termin.
        </p>
      </section>
      <section className="about-principles" aria-label="Smjer nove platforme">
        <article>
          <span className="feature-icon">
            <Icon name="shop" />
          </span>
          <h2>Pronađi.</h2>
          <p>Lokalne djelatnosti i usluge, predstavljene jasno.</p>
        </article>
        <article>
          <span className="feature-icon">
            <Icon name="message" />
          </span>
          <h2>Dogovori se.</h2>
          <p>Jednostavniji kontakt s ljudima koji rade posao.</p>
        </article>
        <article>
          <span className="feature-icon">
            <Icon name="calendar" />
          </span>
          <h2>Nađi svoj termin.</h2>
          <p>Pregledna dostupnost i manje nepotrebnog dopisivanja.</p>
        </article>
      </section>
      <section className="about-status">
        <div>
          <h2>Poslovni imenik</h2>
          <p>Pretraži djelatnosti po nazivu, kategoriji ili mjestu.</p>
        </div>
        <Link className="button button-navy" href="/pretraga">
          Pogledaj imenik
          <Icon name="arrow" />
        </Link>
      </section>
      {getSupportConfig() && (
        <section className="about-status">
          <div>
            <h2>Podrži razvoj AhiBizza.</h2>
            <p>Dobrovoljna podrška razvoju platforme.</p>
          </div>
          <Link className="button button-navy" href="/podrzi">
            Podrži AhiBizz
            <Icon name="arrow" />
          </Link>
        </section>
      )}
    </main>
  );
}
