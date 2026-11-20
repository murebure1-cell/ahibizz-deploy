"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { accountReturnPath } from "../../lib/account-return";
import { authReturnLinks } from "../../lib/auth-return";
import { IS_PLAY_EDITION } from "../../lib/distribution";
import { Icon } from "../Icon";
import styles from "./auth.module.css";

export type AuthMode = "sign-in" | "sign-up" | "reset-request" | "reset-password";
const text = {
  "sign-in": {
    title: "Dobro došao nazad.",
    intro: "Prijavi se u svoj AhiBizz.",
    action: "Prijavi se",
  },
  "sign-up": {
    title: "Tvoj prostor za dobar posao.",
    intro: "Napravi svoj AhiBizz nalog.",
    action: "Napravi nalog",
  },
  "reset-request": {
    title: "Zaboravljena lozinka?",
    intro: "Poslat ćemo ti link za novu lozinku.",
    action: "Pošalji link",
  },
  "reset-password": {
    title: "Postavi novu lozinku.",
    intro: "Izaberi lozinku koju koristiš samo ovdje.",
    action: "Sačuvaj lozinku",
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
    return "Tvoj nalog čeka odobrenje.";
  if (code === "ACCOUNT_SUSPENDED") return "Nalog trenutno nije aktivan. Obrati se podršci.";
  if (code === "EMAIL_NOT_VERIFIED") return "Prvo potvrdi email putem linka koji smo ti poslali.";
  if (code === "INVALID_EMAIL_OR_PASSWORD") return "Email ili lozinka nisu ispravni.";
  if (code === "INVALID_TOKEN" || code === "TOKEN_EXPIRED")
    return "Link više nije važeći. Zatraži novi.";
  if (code === "RATE_LIMITED") return "Pokušaj ponovo za nekoliko minuta.";
  return "Zahtjev nije uspio. Pokušaj ponovo.";
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
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const [visible, setVisible] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState("");
  const [verificationSent, setVerificationSent] = useState(false);
  const hasPassword = mode === "sign-in" || mode === "sign-up" || mode === "reset-password";
  const copy = text[mode];
  const links = authReturnLinks(returnTo);
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
            ? "Prijave trenutno nisu dostupne. Pokušaj kasnije."
            : errorText(response.status === 429 ? "RATE_LIMITED" : result.code),
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
      setError("Nema veze sa serverom. Provjeri internet i pokušaj ponovo.");
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
        setError(errorText(response.status === 429 ? "RATE_LIMITED" : result.code));
        return;
      }
      setVerificationSent(true);
      setVerificationEmail("");
    } catch {
      setError("Poruka nije poslana. Pokušaj ponovo.");
    } finally {
      setBusy(false);
    }
  }
  const verificationFeedback = (
    <>
      {verificationSent && (
        <p role="status" className={styles.notice}>
          Provjeri email za novi link potvrde.
        </p>
      )}
      {verificationEmail && (
        <button
          type="button"
          className={styles.resend}
          disabled={busy}
          onClick={resendVerification}
        >
          Pošalji novu potvrdu emaila
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
          Početna
        </Link>
        <span className={styles.eyebrow}>AHIBIZZ</span>
        <h1 id="auth-heading">{copy.title}</h1>
        <p className={styles.intro}>{copy.intro}</p>
        {!available && <p className={styles.notice}>Prijave još nisu otvorene.</p>}
        {verified && (
          <p className={styles.notice}>Email je potvrđen. Nakon odobrenja možeš se prijaviti.</p>
        )}
        {verificationError && (
          <p className={styles.notice}>
            Link za potvrdu nije važeći. Zatraži novu potvrdu pri prijavi.
          </p>
        )}
        {mode === "reset-password" && !token && (
          <p className={styles.notice}>
            Link nije važeći. <Link href="/zaboravljena-lozinka">Zatraži novi link.</Link>
          </p>
        )}
        {complete ? (
          <div className={styles.done} role="status">
            <Icon name="check" />
            <h2>
              {mode === "reset-password" ? "Lozinka je promijenjena." : "Provjeri svoj email."}
            </h2>
            <p>
              {mode === "sign-up"
                ? "Potvrdi email. Nakon odobrenja možeš se prijaviti."
                : mode === "reset-request"
                  ? "Ako nalog postoji, stići će ti link za novu lozinku."
                  : "Sada se možeš prijaviti."}
            </p>
            {mode === "sign-up" && verificationFeedback}
            <Link href={links.login} className={styles.submit} data-design="auth-submit">
              Na prijavu
            </Link>
          </div>
        ) : (
          <form method="post" action={endpoints[mode]} onSubmit={submit}>
            {mode === "sign-up" && (
              <label>
                Ime i prezime
                <input
                  name="name"
                  autoComplete="name"
                  required
                  minLength={2}
                  maxLength={80}
                  disabled={!available || busy}
                />
              </label>
            )}
            {mode !== "reset-password" && (
              <label>
                Email
                <input
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  required
                  maxLength={254}
                  disabled={!available || busy}
                />
              </label>
            )}
            {hasPassword && (
              <label>
                Lozinka
                <span className={styles.password}>
                  <input
                    name="password"
                    type={visible ? "text" : "password"}
                    autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
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
                    {visible ? "Sakrij" : "Prikaži"}
                  </button>
                </span>
                {mode !== "sign-in" && <small>Najmanje 12 znakova.</small>}
              </label>
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
                  Zapamti prijavu
                </label>
                <Link href="/zaboravljena-lozinka">Zaboravljena lozinka</Link>
              </div>
            )}
            {verificationFeedback}
            {mode === "sign-up" && <Link href="/privatnost">Privatnost na AhiBizzu</Link>}
            {mode === "sign-up" && IS_PLAY_EDITION && (
              <Link href="/pravila-zajednice">Pravila zajednice</Link>
            )}
            <button
              className={styles.submit}
              data-design="auth-submit"
              disabled={!ready || !available || busy || (mode === "reset-password" && !token)}
              type="submit"
            >
              {busy ? "Trenutak…" : copy.action}
            </button>
          </form>
        )}
        {!complete && (
          <p className={styles.switch}>
            {mode === "sign-in" ? (
              <>
                Nemaš nalog? <Link href={links.registration}>Registruj se</Link>
              </>
            ) : (
              <Link href={links.login}>Već imaš nalog? Prijavi se</Link>
            )}
          </p>
        )}
      </section>
      <aside className={styles.story} aria-hidden="true">
        <span>
          Posao počinje
          <br />
          dobrim vezama.
        </span>
        <i>ahibizz.</i>
      </aside>
    </main>
  );
}
