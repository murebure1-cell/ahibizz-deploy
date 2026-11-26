"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";
import { Icon } from "../Icon";
import styles from "./sheet.module.css";

/**
 * A sheet that comes up from the foot of the screen over the page it belongs to: a handle, a
 * title, a way to close it, then its content. On a wide screen it is a card in the middle.
 * A press beside it and Escape close it.
 */
export function Sheet({
  open,
  onClose,
  title,
  closeLabel,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  closeLabel: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const closing = useRef(onClose);
  closing.current = onClose;
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  // A press beside the sheet closes it: the dialog itself is only hit beside its content, on
  // its backdrop. Escape is the dialog's own way out for a keyboard.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const pressed = (event: MouseEvent) => {
      if (event.target === element) closing.current();
    };
    element.addEventListener("click", pressed);
    return () => element.removeEventListener("click", pressed);
  }, []);
  return (
    <dialog ref={dialog} className={styles.sheet} aria-labelledby={heading} onClose={onClose}>
      <div className={styles.body}>
        <span className={styles.handle} aria-hidden="true" />
        <div className={styles.head}>
          <h2 id={heading}>{title}</h2>
          <button type="button" className={styles.close} aria-label={closeLabel} onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
