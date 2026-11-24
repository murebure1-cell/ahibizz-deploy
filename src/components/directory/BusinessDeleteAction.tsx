"use client";

import { useId, useRef, useState } from "react";
import { directoryActorRequest } from "../../lib/directory-client";
import { DirectoryRequestError } from "../../lib/directory-create-submission";
import { msg } from "../../lib/i18n/translate";
import type { DirectoryBusiness } from "../../server/directory/types";
import { useT } from "../i18n/LocaleProvider";
import { rich } from "../i18n/Rich";
import styles from "./business-delete.module.css";

function deleteError(error: unknown) {
  const code = error instanceof DirectoryRequestError ? error.code : "";
  switch (code) {
    case "BUSINESS_HAS_BOOKINGS":
      return msg(
        "Djelatnost ima buduće termine ili rezervacije. U kalendaru djelatnosti otkaži ih ili ih završi (gosti dobiju obavijest), pa ponovo izbriši.",
      );
    case "BUSINESS_HAS_PAYMENTS":
      return msg("Prvo provjeri aktivno isticanje i status uplata za ovu djelatnost.");
    case "VERSION_CONFLICT":
      return msg("Djelatnost je izmijenjena. Osvježi spisak prije brisanja.");
    case "ACCOUNT_IDENTITY_CHANGED":
    case "AUTHENTICATION_REQUIRED":
      return msg("Prijavi se ponovo svojim nalogom.");
    default:
      return msg("Ne mogu potvrditi brisanje. Osvježi spisak i provjeri djelatnost.");
  }
}

export function BusinessDeleteAction({
  business,
  accountId,
  disabled,
  onDeleted,
}: {
  business: DirectoryBusiness;
  accountId: string;
  disabled: boolean;
  onDeleted: () => void;
}) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const pending = useRef(false);
  const version = useRef(business.version);
  const label = useId();
  const description = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function open() {
    setError("");
    version.current = business.version;
    dialog.current?.showModal();
    cancel.current?.focus();
  }

  async function confirm() {
    if (pending.current || disabled || !dialog.current?.open) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await directoryActorRequest(accountId)(
        `mine/${encodeURIComponent(business.id)}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedVersion: version.current }),
          signal: AbortSignal.timeout(20000),
        },
      );
      if (result.deleted !== true) throw new Error("Unexpected deletion response");
      dialog.current?.close();
      onDeleted();
    } catch (cause) {
      setError(t(deleteError(cause)));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={styles.trigger} onClick={open} disabled={disabled}>
        {t("Izbriši djelatnost")}
      </button>
      <dialog
        ref={dialog}
        className={styles.dialog}
        aria-labelledby={label}
        aria-describedby={description}
        onCancel={(event) => {
          if (pending.current) event.preventDefault();
        }}
      >
        <h2 id={label}>{t("Izbriši djelatnost?")}</h2>
        <p id={description}>
          {rich(
            t(
              "Djelatnost {title} će biti trajno uklonjena s profila i iz imenika. Brišu se njene fotografije, opis, kontakt, adresa, lokacija i Reels. Tvoj nalog ostaje.",
            ),
            { title: <strong>„{business.title}“</strong> },
          )}
        </p>
        <p>
          {t(
            "Ostaju zapisi koji pripadaju drugima ili se moraju čuvati: prošli termini gostiju, recenzije i poruke drugih korisnika te evidencija uplata.",
          )}
        </p>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <button
            ref={cancel}
            type="button"
            onClick={() => dialog.current?.close()}
            disabled={busy}
          >
            {t("Odustani")}
          </button>
          <button type="button" onClick={confirm} disabled={busy || disabled}>
            {busy ? t("Brišem…") : t("Izbriši")}
          </button>
        </div>
      </dialog>
    </>
  );
}
