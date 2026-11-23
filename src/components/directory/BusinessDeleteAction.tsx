"use client";

import { useId, useRef, useState } from "react";
import { directoryActorRequest } from "../../lib/directory-client";
import { DirectoryRequestError } from "../../lib/directory-create-submission";
import type { DirectoryBusiness } from "../../server/directory/types";
import styles from "./business-delete.module.css";

function deleteError(error: unknown) {
  const code = error instanceof DirectoryRequestError ? error.code : "";
  switch (code) {
    case "BUSINESS_HAS_BOOKINGS":
      return "Prvo riješi otvorene termine za ovu djelatnost.";
    case "BUSINESS_HAS_PAYMENTS":
      return "Prvo provjeri aktivno isticanje i status uplata za ovu djelatnost.";
    case "VERSION_CONFLICT":
      return "Djelatnost je izmijenjena. Osvježi spisak prije brisanja.";
    case "ACCOUNT_IDENTITY_CHANGED":
    case "AUTHENTICATION_REQUIRED":
      return "Prijavi se ponovo svojim nalogom.";
    default:
      return "Ne mogu potvrditi brisanje. Osvježi spisak i provjeri djelatnost.";
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
      setError(deleteError(cause));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={styles.trigger} onClick={open} disabled={disabled}>
        Izbriši djelatnost
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
        <h2 id={label}>Izbriši djelatnost?</h2>
        <p id={description}>
          Djelatnost <strong>„{business.title}“</strong> će biti trajno uklonjena s profila i iz
          imenika.
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
            Odustani
          </button>
          <button type="button" onClick={confirm} disabled={busy || disabled}>
            {busy ? "Brišem…" : "Izbriši"}
          </button>
        </div>
      </dialog>
    </>
  );
}
