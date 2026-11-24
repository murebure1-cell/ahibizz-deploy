"use client";

import { type ReactNode, useId, useRef } from "react";
import styles from "./confirm-button.module.css";
import { useT } from "./i18n/LocaleProvider";

/**
 * A button that asks for confirmation in the app's own dialog instead of `window.confirm`,
 * which some embedded browsers (Play/TWA shells, in-app browsers) suppress or style poorly.
 * The caller keeps its own busy and error handling inside `onConfirm`.
 */
export function ConfirmButton({
  children,
  title,
  description,
  confirmLabel,
  onConfirm,
  disabled = false,
  className,
}: {
  children: ReactNode;
  title: string;
  description?: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const label = useId();
  const details = useId();
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={disabled}
        onClick={() => {
          dialog.current?.showModal();
          cancel.current?.focus();
        }}
      >
        {children}
      </button>
      <dialog
        ref={dialog}
        className={styles.dialog}
        aria-labelledby={label}
        aria-describedby={description ? details : undefined}
      >
        <h2 id={label}>{title}</h2>
        {description && <p id={details}>{description}</p>}
        <div className={styles.actions}>
          <button ref={cancel} type="button" onClick={() => dialog.current?.close()}>
            {t("Odustani")}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              dialog.current?.close();
              onConfirm();
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </dialog>
    </>
  );
}
