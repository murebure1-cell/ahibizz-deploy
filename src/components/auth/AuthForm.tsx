"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { accountReturnPath } from "../../lib/account-return";
import { authReturnLinks } from "../../lib/auth-return";
import { msg } from "../../lib/i18n/translate";
import { Icon } from "../Icon";
import { useT } from "../i18n/LocaleProvider";
import { rich } from "../i18n/Rich";
import styles from "./auth.module.css";

export type AuthMode = "sign-in" | "sign-up" | "reset-request" | "reset-password";
const text = {
  "sign-in": {
    title: msg("Lijepo te je opet vidjeti."),
    intro: msg("Prijavi se u svoj AhiBizz."),
    action: msg("Prijavi se"),
  },
  "sign-up": {
    title: msg("Tvoj prostor za dobar posao."),
    intro: msg("Napravi svoj AhiBizz nalog."),
    action: msg("Napravi nalog"),
  },
  "reset-request": {
    title: msg("Zaboravljena lozinka?"),
    intro: msg("Poslat ćemo ti link za novu lozinku."),
    action: msg("Pošalji link"),
  },
  "reset-password": {
    title: msg("Postavi novu lozinku."),
    intro: msg("Izaberi lozinku koju koristiš samo ovdje."),
    action: msg("Sačuvaj lozinku"),
  },
};
const endpoints = {
  "sign-in": "/api/auth/sign-in/email",
  "sign-up": "/api/auth/sign-up/email",
  "reset-request": "/api/auth/request-password-reset",
  "reset-password": "/api/auth/reset-password",
};

function errorText(code: unknown) {
  if (code === "ACCOUNT_PENDING_APPROVAL" || code === "ACCOUNT_NOT_APPROVED")
    return msg("Tvoj nalog čeka odobrenje. Javit ćemo ti emailom čim bude odobren.");
  if (code === "ACCOUNT_SUSPENDED") return msg("Nalog trenutno nije aktivan. Obrati se podršci.");
  if (code === "EMAIL_NOT_VERIFIED")
    return msg("Prvo potvrdi email putem linka koji smo ti poslali.");
  if (code === "INVALID_EMAIL_OR_PASSWORD") return msg("Email ili lozinka nisu ispravni.");
  if (code === "INVALID_TOKEN" || code === "TOKEN_EXPIRED")
    return msg("Link više nije važeći. Zatraži novi.");
  if (code === "RATE_LIMITED") return msg("Pokušaj ponovo za nekoliko minuta.");
  return msg("Zahtjev nije uspio. Pokušaj ponovo.");
}

export function AuthForm({
  mode,
  available,
  token,
  verified = false,
  verificationError = false,
  returnTo,
}: {
  mode: AuthMode;
  available: boolean;
  token?: string;
  verified?: boolean;
  verificationError?: boolean;
  returnTo?: string;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const [visible, setVisible] = useState(false);
  const passwordField = useRef<HTMLInputElement>(null);
  const [verificationEmail, setVerificationEmail] = useState("");
  const [verificationSent, setVerificationSent] = useState(false);
  const hasPassword =
    mode === "sign-in" || mode === "sign-up" || (mode === "reset-password" && Boolean(token));
  const copy = text[mode];
  const links = authReturnLinks(returnTo);
  function suggestPassword() {
    if (!passwordField.current) return;
    // A 32-character alphabet avoids both ambiguous characters and modulo bias.
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const groups = Array.from({ length: 4 }, () => {
      const bytes = crypto.getRandomValues(new Uint8Array(5));
      return Array.from(bytes, (byte) => alphabet.charAt(byte % alphabet.length)).join("");
    });
    passwordField.current.value = groups.join("-");
    setVisible(true);
    passwordField.current.focus();
    passwordField.current.select();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !available) return;
    const fields = new FormData(event.currentTarget);
    const email = String(fields.get("email") || "").trim();
    const password = String(fields.get("password") || "");
    let body: Record<string, unknown> = { email };
    if (mode === "sign-in") body = { email, password, rememberMe: fields.get("remember") === "on" };
    if (mode === "sign-up")
      body = {
        name: String(fields.get("name") || "").trim(),
        email,
        password,
        callbackURL: links.verification,
      };
    if (mode === "reset-request") body = { email, redirectTo: "/nova-lozinka" };
    if (mode === "reset-password") body = { newPassword: password, token };
    setBusy(true);
    setError("");
    setVerificationEmail("");
    setVerificationSent(false);
    try {
      const response = await fetch(endpoints[mode], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "same-origin",
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok !== true) {
        if (mode === "sign-in" && result.code === "EMAIL_NOT_VERIFIED") setVerificationEmail(email);
        setError(
          response.status === 503
            ? t("Prijave trenutno nisu dostupne. Pokušaj kasnije.")
            : t(errorText(response.status === 429 ? "RATE_LIMITED" : result.code)),
        );
        return;
      }
      if (mode === "sign-in") {
        window.location.assign(accountReturnPath(returnTo));
        return;
      }
      if (mode === "sign-up") setVerificationEmail(email);
      setComplete(true);
    } catch {
      setError(t("Veza je prekinuta. Provjeri internet i pokušaj ponovo."));
    } finally {
      setBusy(false);
    }
  }
  async function resendVerification() {
    if (busy || !verificationEmail || !available) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/send-verification-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: verificationEmail, callbackURL: links.verification }),
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) {
        setError(t(errorText(response.status === 429 ? "RATE_LIMITED" : result.code)));
        return;
      }
      setVerificationSent(true);
      setVerificationEmail("");
    } catch {
      setError(t("Poruka nije poslana. Pokušaj ponovo."));
    } finally {
      setBusy(false);
    }
  }
  const verificationFeedback = (
    <>
      {verificationSent && (
        <p role="status" className={styles.notice}>
          {t("Provjeri email za novi link potvrde.")}
        </p>
      )}
      {verificationEmail && (
        <button
          type="button"
          className={styles.resend}
          disabled={busy}
          onClick={resendVerification}
        >
          {t("Pošalji novu potvrdu emaila")}
        </button>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </>
  );
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <section className={styles.card} aria-labelledby="auth-heading" data-design="auth-form">
        <Link href="/" className={styles.back}>
          <Icon name="chevron" />
          {t("Početna")}
        </Link>
        <h1 id="auth-heading">{t(copy.title)}</h1>
        <p className={styles.intro}>{t(copy.intro)}</p>
        {!available && <p className={styles.notice}>{t("Prijave još nisu otvorene.")}</p>}
        {verified && (
          <p className={styles.notice}>
            {t("Email je potvrđen. Nakon odobrenja možeš se prijaviti.")}
          </p>
        )}
        {verificationError && (
          <p className={styles.notice}>
            {t("Link za potvrdu nije važeći. Zatraži novu potvrdu pri prijavi.")}
          </p>
        )}
        {mode === "reset-password" && !token && (
          <p className={styles.notice}>
            {t("Link nije važeći.")}{" "}
            <Link href="/zaboravljena-lozinka">{t("Zatraži novi link.")}</Link>
          </p>
        )}
        {complete ? (
          <div className={styles.done} role="status">
            <Icon name="check" />
            <h2>
              {mode === "reset-password"
                ? t("Lozinka je promijenjena.")
                : t("Provjeri svoj email.")}
            </h2>
            <p>
              {mode === "sign-up"
                ? t(
                    "Otvori link koji smo ti poslali na email. Zatim nalog pregleda administrator, a kad bude odobren, javimo ti emailom.",
                  )
                : mode === "reset-request"
                  ? t("Ako nalog postoji, stići će ti link za novu lozinku.")
                  : t("Sada se možeš prijaviti.")}
            </p>
            {mode === "sign-up" && verificationFeedback}
            <Link href={links.login} className={styles.submit} data-design="auth-submit">
              {t("Na prijavu")}
            </Link>
          </div>
        ) : (
          <form method="post" action={endpoints[mode]} onSubmit={submit}>
            {mode === "sign-up" && (
              <label>
                {t("Ime i prezime")}
                <input
                  name="name"
                  autoComplete="name"
                  enterKeyHint="next"
                  required
                  minLength={2}
                  maxLength={80}
                  disabled={!available || busy}
                />
              </label>
            )}
            {mode !== "reset-password" && (
              <label>
                {t("Email")}
                <input
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  enterKeyHint={mode === "reset-request" ? "send" : "next"}
                  required
                  maxLength={254}
                  disabled={!available || busy}
                />
              </label>
            )}
            {hasPassword && (
              <label>
                {t("Lozinka")}
                <span className={styles.password}>
                  <input
                    name="password"
                    ref={passwordField}
                    type={visible ? "text" : "password"}
                    autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                    enterKeyHint={mode === "sign-up" ? "next" : "go"}
                    required
                    minLength={mode === "sign-in" ? 1 : 12}
                    maxLength={128}
                    disabled={!available || busy}
                  />
                  <button
                    type="button"
                    aria-pressed={visible}
                    onClick={() => setVisible(!visible)}
                    disabled={!available || busy}
                  >
                    {visible ? t("Sakrij") : t("Prikaži")}
                  </button>
                </span>
                {mode !== "sign-in" && <small>{t("Najmanje 12 znakova.")}</small>}
              </label>
            )}
            {(mode === "sign-up" || (mode === "reset-password" && token)) && (
              <button
                type="button"
                className={styles.suggestion}
                onClick={suggestPassword}
                disabled={!ready || !available || busy}
              >
                {t("Predloži jaku lozinku")}
              </button>
            )}
            {mode === "sign-in" && (
              <div className={styles.options}>
                <label className={styles.remember}>
                  <input
                    name="remember"
                    type="checkbox"
                    defaultChecked
                    disabled={!available || busy}
                  />
                  {t("Zapamti prijavu")}
                </label>
                <Link href="/zaboravljena-lozinka">{t("Zaboravljena lozinka")}</Link>
              </div>
            )}
            {verificationFeedback}
            {mode === "sign-up" && (
              <label className={styles.remember}>
                <input name="terms" type="checkbox" required disabled={!available || busy} />
                <span>
                  {rich(t("Imam najmanje 18 godina i prihvatam {rules} i {privacy}."), {
                    rules: <Link href="/pravila-zajednice">{t("pravila zajednice")}</Link>,
                    privacy: <Link href="/privatnost">{t("privatnost na AhiBizzu")}</Link>,
                  })}
                </span>
              </label>
            )}
            <button
              className={styles.submit}
              data-design="auth-submit"
              disabled={!ready || !available || busy || (mode === "reset-password" && !token)}
              type="submit"
            >
              {busy ? t("Trenutak…") : t(copy.action)}
            </button>
          </form>
        )}
        {!complete && (
          <p className={styles.switch}>
            {mode === "sign-in" ? (
              <>
                {t("Nemaš nalog?")} <Link href={links.registration}>{t("Registruj se")}</Link>
              </>
            ) : (
              <Link href={links.login}>{t("Već imaš nalog? Prijavi se")}</Link>
            )}
          </p>
        )}
      </section>
      <aside className={styles.story} aria-hidden="true">
        <span>{rich(t("Posao počinje\ndobrim vezama."))}</span>
        <i>ahibizz.</i>
      </aside>
    </main>
  );
}
