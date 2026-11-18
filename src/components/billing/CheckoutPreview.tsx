"use client";

import { useReducer, useState } from "react";
import { checkoutPreviewTransition, promotionTrialOffer } from "../../lib/checkout-preview";
import styles from "./checkout-preview.module.css";

export function CheckoutPreview() {
  const [state, dispatch] = useReducer(checkoutPreviewTransition, "offer");
  const [purpose, setPurpose] = useState<"promotion" | "support">("promotion");
  const support = purpose === "support";
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <a href="/pregled">← AhiBizz pregled</a>
      <header>
        <span className={styles.label}>PROBNI PRIKAZ · BEZ NAPLATE</span>
        <h1>{state === "offer" ? "Isprobaj checkout" : "Pregled prije plaćanja"}</h1>
        <p>
          Ovo nije PayPal sandbox ni stvarna uplata. Nema unosa kartice, zaduženja ili aktivacije
          isticanja.
        </p>
      </header>
      <section className={styles.choices} aria-label="Namjena">
        <button
          type="button"
          aria-pressed={!support}
          onClick={() => {
            setPurpose("promotion");
            dispatch("cancel");
          }}
        >
          Istakni profil
        </button>
        <button
          type="button"
          aria-pressed={support}
          onClick={() => {
            setPurpose("support");
            dispatch("cancel");
          }}
        >
          Podrži razvoj AhiBizza
        </button>
      </section>
      <section className={styles.card} aria-label="Probna ponuda">
        <h2>{support ? "Podrži razvoj AhiBizza" : promotionTrialOffer.title}</h2>
        <p>
          {support
            ? "Dobrovoljna podrška razvoju. Ne kupuje isticanje, članstvo ili druga prava."
            : "Probni profil · probna kategorija. Stvarni profili se ne mijenjaju."}
        </p>
        <p className={styles.price}>{support ? "Iznos po izboru" : "10 KM"}</p>
        <p>
          {support
            ? "Odvojeno od kupovine usluge."
            : "Jednokratno · 7 dana · bez automatske obnove"}
        </p>
        {!support && (
          <p>
            PayPal ne podržava BAM. Iznos u podržanoj valuti bit će prikazan i potvrđen prije
            stvarnog plaćanja. 10 KM nije 10 EUR.
          </p>
        )}
        {support && (
          <p>
            Postojeća stranica /podrzi i njen PayPal link ostaju neizmijenjeni. Ovaj demo ih ne
            otvara niti šalje novac.
          </p>
        )}
        {state === "offer" && (
          <button className={styles.primary} type="button" onClick={() => dispatch("review")}>
            Pregledaj probnu narudžbu
          </button>
        )}
        {state === "review" && (
          <>
            <p role="status">
              Provjeri namjenu{!support && ", cijenu i trajanje"}. Sljedeći korak samo provjerava
              spremnost PayPal povezivanja.
            </p>
            <button className={styles.primary} type="button" onClick={() => dispatch("continue")}>
              Nastavi u probnom prikazu
            </button>
            <button type="button" onClick={() => dispatch("cancel")}>
              Odustani
            </button>
          </>
        )}
        {state === "blocked" && (
          <div role="status" className={styles.notice}>
            <h3>PayPal još nije povezan za test</h3>
            <p>
              Ništa nije naplaćeno.{" "}
              {support ? "Podrška nije uplaćena." : "Isticanje nije aktivirano."} Za stvarni PayPal
              sandbox test treba povezati testnu aplikaciju i testni račun.
            </p>
            <button type="button" onClick={() => dispatch("back")}>
              Pokušaj ponovo
            </button>
          </div>
        )}
      </section>
      <p className={styles.footer}>
        Samo lokalni prikaz. Ne sprema narudžbe niti podatke o plaćanju. Osvježavanje vraća početak.
      </p>
    </main>
  );
}
