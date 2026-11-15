"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "../Icon";
import styles from "./support.module.css";

type CopyStatus = "idle" | "copying" | "copied" | "manual";

export function CopyPaymentDetails({ text }: { text: string }) {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const fallback = useRef<HTMLTextAreaElement>(null);
  const currentText = useRef(text);
  currentText.current = text;
  const fallbackId = useId();

  useEffect(() => {
    if (status !== "manual") return;
    fallback.current?.focus();
    fallback.current?.select();
  }, [status]);

  async function copy() {
    if (status === "copying") return;
    const value = text;
    setStatus("copying");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard_unavailable");
      await navigator.clipboard.writeText(value);
      if (currentText.current === value) setStatus("copied");
    } catch {
      if (currentText.current === value) setStatus("manual");
    }
  }

  return (
    <div className={styles.copy}>
      <button
        className={styles.copyButton}
        type="button"
        disabled={status === "copying"}
        onClick={() => void copy()}
      >
        {status === "copying" ? "Kopiram…" : status === "copied" ? "Kopirano" : "Kopiraj podatke"}
        {status === "copied" && <Icon name="check" />}
      </button>
      <p className={styles.copyStatus} role="status">
        {status === "copied"
          ? "Podaci za uplatu su kopirani."
          : status === "manual"
            ? "Možeš ručno kopirati podatke ispod."
            : ""}
      </p>
      {status === "manual" && (
        <div className={styles.manualCopy}>
          <label htmlFor={fallbackId}>Podaci za uplatu</label>
          <textarea
            ref={fallback}
            id={fallbackId}
            readOnly
            rows={Math.min(10, text.split("\n").length)}
            value={text}
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
      )}
    </div>
  );
}
