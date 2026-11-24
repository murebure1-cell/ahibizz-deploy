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

/** Codes Better Auth appends to the Google error return (?google=1&error=...). */
function googleErrorText(code: string) {
  const normalized = code.toUpperCase();
  if (["ACCOUNT_PENDING_APPROVAL", "ACCOUNT_SUSPENDED", "EMAIL_NOT_VERIFIED"].includes(normalized))
    return errorText(normalized);
  if (normalized === "ACCOUNT_NOT_LINKED")
    return msg(
      "Ovaj email već ima nalog koji još nije potvrđen. Potvrdi email preko linka, pa nastavi s Googleom.",
    );
  if (normalized === "ACCESS_DENIED") return msg("Prijava preko Googlea je prekinuta.");
  return msg("Prijava preko Googlea nije uspjela. Pokušaj ponovo.");
}

/** Google's four-colour mark, as its sign-in branding asks. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

export function AuthForm({
  mode,
  available,
  token,
  verified = false,
  verificationError = false,
  returnTo,
  google = false,
  googleError,
}: {
  mode: AuthMode;
  available: boolean;
  token?: string;
  verified?: boolean;
  verificationError?: boolean;
  returnTo?: string;
  /** Show "Nastavi s Googleom"; only when the server has a Google client configured. */
  google?: boolean;
  /** Error code from a failed Google return, shown when the page opens. */
  googleError?: string;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [error, setError] = useState(() => (googleError ? t(googleErrorText(googleError)) : ""));
  const [termsAccepted, setTermsAccepted] = useState(false);
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
  async function startGoogle() {
    if (busy || !available) return;
    setBusy(true);
    setError("");
    try {
      const back = new URLSearchParams({ google: "1" });
      if (returnTo) back.set("nastavi", returnTo);
      const response = await fetch("/api/auth/sign-in/social", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "google",
          callbackURL: accountReturnPath(returnTo),
          errorCallbackURL: `/prijava?${back}`,
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || typeof result?.url !== "string") {
        setError(t(errorText(response.status === 429 ? "RATE_LIMITED" : result?.code)));
        setBusy(false);
        return;
      }
      // Leaving for Google's own page; the button stays busy until the browser navigates.
      window.location.assign(result.url);
    } catch {
      setError(t("Prijava preko Googlea nije uspjela. Pokušaj ponovo."));
      setBusy(false);
    }
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
                <input
                  name="terms"
                  type="checkbox"
                  required
                  disabled={!available || busy}
                  checked={termsAccepted}
                  onChange={(event) => setTermsAccepted(event.target.checked)}
                />
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
        {google && !complete && (mode === "sign-in" || mode === "sign-up") && (
          <div className={styles.social}>
            <p className={styles.divider}>
              <span>{t("ili")}</span>
            </p>
            <button
              type="button"
              className={styles.google}
              onClick={startGoogle}
              disabled={!ready || !available || busy || (mode === "sign-up" && !termsAccepted)}
            >
              <GoogleMark />
              {t("Nastavi s Googleom")}
            </button>
            <p className={styles.socialNote}>
              {mode === "sign-up"
                ? termsAccepted
                  ? t("Nalog napravljen preko Googlea također čeka odobrenje administratora.")
                  : t("Za Google prvo označi da imaš najmanje 18 godina i prihvataš pravila.")
                : rich(
                    t(
                      "Nastavkom preko Googlea potvrđuješ da imaš najmanje 18 godina i prihvataš {rules} i {privacy}.",
                    ),
                    {
                      rules: <Link href="/pravila-zajednice">{t("pravila zajednice")}</Link>,
                      privacy: <Link href="/privatnost">{t("privatnost na AhiBizzu")}</Link>,
                    },
                  )}
            </p>
          </div>
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
