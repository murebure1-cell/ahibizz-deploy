"use client";

import Link from "next/link";
import { type FormEvent, useRef, useState } from "react";
import { msg } from "../../lib/i18n/translate";
import { Icon } from "../Icon";
import { useT } from "../i18n/LocaleProvider";
import { rowStyles } from "../ui/Rows";
import styles from "./settings.module.css";

const errors: Record<string, string> = {
  INVALID_CURRENT_PASSWORD: msg("Trenutna lozinka nije tačna."),
  INVALID_PASSWORD_LENGTH: msg("Nova lozinka treba imati od 12 do 128 znakova."),
  PASSWORD_UNCHANGED: msg("Izaberi lozinku koja se razlikuje od trenutne."),
  TOO_MANY_REQUESTS: msg("Previše pokušaja. Pokušaj ponovo za minutu."),
};

export function AccountPassword({ accountId, email }: { accountId: string; email: string }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const submitting = useRef(false);
  const details = useRef<HTMLDetailsElement>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const currentPassword = fields.get("currentPassword");
    const newPassword = fields.get("newPassword");
    setNotice("");
    setError("");
    if (newPassword !== fields.get("confirmPassword")) {
      setError(t("Unesene nove lozinke se razlikuju."));
      const confirm = form.elements.namedItem("confirmPassword");
      if (confirm instanceof HTMLInputElement) confirm.focus();
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      const response = await fetch("/api/account/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-AhiBizz-Account-ID": accountId },
        credentials: "same-origin",
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const result = await response.json();
      if (!response.ok || result?.ok !== true) {
        setError(
          response.status === 401 || response.status === 403
            ? t("Za promjenu lozinke prijavi se ponovo.")
            : t(errors[result?.code] ?? msg("Promjena nije potvrđena. Pokušaj kasnije.")),
        );
        return;
      }
      form.reset();
      if (details.current) details.current.open = false;
      setNotice(t("Lozinka je promijenjena. Na drugim uređajima prijavi se novom lozinkom."));
    } catch {
      setError(t("Promjena nije potvrđena. Provjeri vezu ili zatraži link za novu lozinku."));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <details ref={details} className={styles.password}>
        <summary className={rowStyles.row}>
          <Icon name="key" className={rowStyles.icon} />
          <span className={rowStyles.text}>
            <span className={rowStyles.title}>{t("Lozinka")}</span>
          </span>
          <span className={rowStyles.value}>{t("Promijeni lozinku")}</span>
          <Icon name="chevron" className={rowStyles.chevron} />
        </summary>
        <form method="post" action="/api/account/password" onSubmit={submit} aria-busy={busy}>
          <input type="hidden" name="username" autoComplete="username" value={email} />
          <label>
            {t("Trenutna lozinka")}
            <input
              type="password"
              name="currentPassword"
              autoComplete="current-password"
              required
              maxLength={128}
              disabled={busy}
            />
          </label>
          <label>
            {t("Nova lozinka")}
            <input
              type="password"
              name="newPassword"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              aria-describedby="password-length"
              disabled={busy}
            />
          </label>
          <small id="password-length">{t("Najmanje 12 znakova.")}</small>
          <label>
            {t("Potvrdi novu lozinku")}
            <input
              type="password"
              name="confirmPassword"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              disabled={busy}
            />
          </label>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <button type="submit" disabled={busy}>
              {busy ? t("Spremam…") : t("Sačuvaj novu lozinku")}
            </button>
          </div>
          <Link href="/zaboravljena-lozinka" className={styles.forgot}>
            {t("Zaboravljena lozinka")}
          </Link>
        </form>
      </details>
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
    </>
  );
}
