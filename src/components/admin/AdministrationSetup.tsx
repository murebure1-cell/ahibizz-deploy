"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "../Icon";
import { useI18n } from "../i18n/LocaleProvider";
import { rowStyles, ScreenBar } from "../ui/Rows";
import styles from "./administration-setup.module.css";

type State = {
  actor: "founder-owner" | "administration";
  administration: { email: string; passwordSet: boolean } | null;
  handOverPending: boolean;
};

const addAccount = "/prijava?administracija=1";

function readState(value: unknown): State | null {
  const v = value as Partial<State> | null;
  if (!v || (v.actor !== "founder-owner" && v.actor !== "administration")) return null;
  return {
    actor: v.actor,
    administration:
      v.administration && typeof v.administration.email === "string"
        ? { email: v.administration.email, passwordSet: v.administration.passwordSet === true }
        : null,
    handOverPending: v.handOverPending === true,
  };
}

/**
 * "Odvojena administracija": the founder creates the "AhiBizz administracija" account, chooses
 * its password on a one-time link, signs it in beside his own, and from there hands the
 * administration over so his own account becomes an ordinary one with the founder mark.
 */
export function AdministrationSetup({ initial }: { initial: State | null }) {
  const { t } = useI18n();
  const [state, setState] = useState(initial);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function act(action: "create" | "link" | "hand-over") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/account/administration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(result.code ?? "failed"));
      if (typeof result.link === "string") {
        setLink(result.link);
        setCopied(false);
      }
      const fresh = await fetch("/api/account/administration", { cache: "no-store" });
      if (fresh.ok) setState(readState(await fresh.json()));
      else if (action === "hand-over") setState((s) => s && { ...s, handOverPending: false });
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : "";
      setError(
        code === "ADMINISTRATION_EMAIL_TAKEN"
          ? t("Adresa administracija@ahibizz.com već pripada drugom nalogu.")
          : t("Nije uspjelo. Pokušaj ponovo."),
      );
    } finally {
      setBusy(false);
      setSure(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const admin = state?.administration;
  return (
    <main id="glavni-sadrzaj" className={rowStyles.screen}>
      <ScreenBar
        title={t("Odvojena administracija")}
        backHref="/administracija"
        backLabel={t("Nazad")}
      />
      <div className={styles.body}>
        {!state && (
          <p className={styles.lead}>{t("Ovo trenutno nije dostupno. Pokušaj kasnije.")}</p>
        )}

        {state?.actor === "founder-owner" && (
          <>
            <p className={styles.lead}>
              {t(
                "Administracija dobija svoj nalog. Tvoj lični nalog postaje običan nalog s oznakom osnivača, bez ograničenja za djelatnosti i reelse.",
              )}
            </p>
            {!admin ? (
              <section className={styles.card}>
                <span className={styles.mark} aria-hidden="true">
                  <Icon name="shield" />
                </span>
                <h2>{t("AhiBizz administracija")}</h2>
                <p>
                  {t(
                    "Prijava: administrator ili administracija@ahibizz.com. Lozinku biraš ti, na jednokratnom linku koji vrijedi sat vremena.",
                  )}
                </p>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={busy}
                  onClick={() => void act("create")}
                >
                  {busy ? t("Trenutak…") : t("Napravi administratorski nalog")}
                </button>
              </section>
            ) : (
              <>
                <section className={styles.account}>
                  <span className={styles.mark} aria-hidden="true">
                    <Icon name="shield" />
                  </span>
                  <span className={styles.who}>
                    <strong>{t("AhiBizz administracija")}</strong>
                    <span>administrator · {admin.email}</span>
                  </span>
                  <span className={styles.status} data-ok={admin.passwordSet ? "" : undefined}>
                    {admin.passwordSet ? t("Lozinka postavljena") : t("Bez lozinke")}
                  </span>
                </section>
                {link && (
                  <section className={styles.link}>
                    <h2>{t("Jednokratni link")}</h2>
                    <p>
                      {t(
                        "Vrijedi sat vremena i samo jednom. Ne šalji ga nikome. Na njemu izaberi lozinku administracije.",
                      )}
                    </p>
                    <code>{link}</code>
                    <div className={styles.actions}>
                      <a className={styles.primary} href={link} target="_blank" rel="noopener">
                        {t("Otvori link")}
                      </a>
                      <button
                        type="button"
                        className={styles.secondary}
                        onClick={() => void copy()}
                      >
                        {copied ? t("Kopirano") : t("Kopiraj")}
                      </button>
                    </div>
                  </section>
                )}
                <ol className={styles.steps}>
                  <li data-done={admin.passwordSet ? "" : undefined}>
                    <span>{t("Postavi lozinku na jednokratnom linku.")}</span>
                    {!link && (
                      <button
                        type="button"
                        className={styles.secondary}
                        disabled={busy}
                        onClick={() => void act("link")}
                      >
                        {admin.passwordSet ? t("Novi link za lozinku") : t("Napravi link")}
                      </button>
                    )}
                  </li>
                  <li>
                    <span>
                      {t("Dodaj nalog i prijavi se kao administrator. Tvoj ostaje prijavljen.")}
                    </span>
                    <Link className={styles.secondary} href={addAccount} prefetch={false}>
                      {t("Dodaj nalog")}
                    </Link>
                  </li>
                  <li>
                    <span>
                      {t("Kao administracija otvori ovu stranicu i pritisni „Završi odvajanje“.")}
                    </span>
                  </li>
                </ol>
              </>
            )}
          </>
        )}

        {state?.actor === "administration" &&
          (state.handOverPending ? (
            <section className={styles.card}>
              <span className={styles.mark} aria-hidden="true">
                <Icon name="crown" />
              </span>
              <h2>{t("Završi odvajanje")}</h2>
              <p>
                {t(
                  "Odobravanje, objave i odluke od sada idu samo s ovog naloga. Tvoj lični nalog postaje običan nalog s oznakom „Osnivač AhiBizza“ i bez ograničenja za djelatnosti i reelse.",
                )}
              </p>
              <button
                type="button"
                className={styles.primary}
                disabled={busy}
                onClick={() => (sure ? void act("hand-over") : setSure(true))}
              >
                {busy
                  ? t("Trenutak…")
                  : sure
                    ? t("Sigurno? Pritisni ponovo")
                    : t("Završi odvajanje")}
              </button>
            </section>
          ) : (
            <section className={styles.card}>
              <span className={styles.mark} data-ok="" aria-hidden="true">
                <Icon name="check" />
              </span>
              <h2>{t("Administracija je odvojena.")}</h2>
              <p>
                {t(
                  "Ovaj nalog radi administraciju. Na svoj lični profil prelaziš preko Menija → Prebaci nalog.",
                )}
              </p>
              <Link className={styles.primary} href="/administracija" prefetch={false}>
                {t("Na administraciju")}
              </Link>
            </section>
          ))}

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
