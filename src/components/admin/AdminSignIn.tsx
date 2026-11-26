"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { Icon } from "../Icon";
import { useI18n } from "../i18n/LocaleProvider";
import styles from "./admin-sign-in.module.css";

/**
 * Signing in to the administration account as drawn (AdminUlaz). On a device where a personal
 * account is already signed in, this adds the administration beside it (Prebaci nalog).
 */
export function AdminSignIn({ available }: { available: boolean }) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !available) return;
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: String(fields.get("email") || "").trim(),
          password: String(fields.get("password") || ""),
          rememberMe: true,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok !== true) {
        setError(
          response.status === 429
            ? t("Previše pokušaja. Sačekaj minut pa pokušaj ponovo.")
            : response.status === 503
              ? t("Prijave trenutno nisu dostupne. Pokušaj kasnije.")
              : t("Ime ili lozinka nisu tačni."),
        );
        return;
      }
      window.location.assign("/administracija");
    } catch {
      setError(t("Prijave trenutno nisu dostupne. Pokušaj kasnije."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <div className={styles.title}>
        <span className={styles.mark} aria-hidden="true">
          <Icon name="shield" />
        </span>
        <span>
          <small>{t("Poseban nalog")}</small>
          <h1>{t("AhiBizz administracija")}</h1>
        </span>
      </div>
      <p className={styles.lead}>
        {t(
          "Za odobravanje, objave i sve odluke o platformi. Tvoj lični profil ostaje lični, kao kod svih ostalih.",
        )}
      </p>
      <form className={styles.form} onSubmit={(event) => void submit(event)}>
        <label>
          {t("Email ili ime administracije")}
          <input
            name="email"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            defaultValue="administrator"
            required
            maxLength={254}
            disabled={!available || busy}
          />
        </label>
        <label>
          {t("Lozinka")}
          <span className={styles.password}>
            <input
              name="password"
              type={visible ? "text" : "password"}
              autoComplete="current-password"
              required
              maxLength={128}
              disabled={!available || busy}
            />
            <button type="button" onClick={() => setVisible((value) => !value)}>
              {visible ? t("Sakrij") : t("Prikaži")}
            </button>
          </span>
        </label>
        <p className={styles.note}>
          <Icon name="key" aria-hidden="true" />
          {t("Sve radnje se bilježe kao „AhiBizz administracija“, ne pod tvojim ličnim imenom.")}
        </p>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {!available && (
          <p className={styles.error} role="status">
            {t("Prijave trenutno nisu dostupne. Pokušaj kasnije.")}
          </p>
        )}
        <span className={styles.spacer} />
        <button type="submit" className={styles.primary} disabled={!available || busy}>
          <Icon name="shield" />
          {busy ? t("Trenutak…") : t("Prijavi se u administraciju")}
        </button>
        <Link href="/nalog" className={styles.personal} prefetch={false}>
          <Icon name="user" />
          {t("Na lični profil")}
        </Link>
      </form>
    </main>
  );
}
