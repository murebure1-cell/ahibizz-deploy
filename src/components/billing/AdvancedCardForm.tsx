"use client";

import { useEffect, useRef, useState } from "react";
import { checkoutEuro } from "../../lib/paypal-card-flow";
import type {
  AdvancedSession,
  CardFieldType,
  HostedField,
  HostedFieldState,
} from "../../lib/paypal-card-sdk";
import { Icon } from "../Icon";
import styles from "./advanced-card.module.css";

const fields = [
  { type: "number", label: "Broj kartice", hint: "1234 5678 9012 3456" },
  { type: "expiry", label: "Datum isteka", hint: "MM/GG" },
  { type: "cvv", label: "Sigurnosni kod", hint: "CVV" },
] as const;
type Props = {
  amountMinor: number;
  newSession: () => AdvancedSession;
  submit: (session: AdvancedSession) => Promise<void>;
  onUnavailable: () => void;
};
export function AdvancedCardForm({ amountMinor, newSession, submit, onUnavailable }: Props) {
  const hosts = useRef<Partial<Record<CardFieldType, HTMLDivElement | null>>>({});
  const session = useRef<AdvancedSession | null>(null);
  const [valid, setValid] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    const documentRoot = document.documentElement;
    let disposed = false;
    let hasInput = false;
    let fieldTheme = "";
    let generation = 0;
    let hostedFields: HostedField[] = [];
    async function clear() {
      const previous = session.current;
      session.current = null;
      const oldFields = hostedFields;
      hostedFields = [];
      await Promise.allSettled(
        oldFields.map(async (element) => {
          try {
            await element.destroy?.();
          } finally {
            element.remove();
          }
        }),
      );
      if (previous) {
        try {
          await previous.destroy();
        } catch {
          /* Already disconnected. */
        }
      }
    }
    async function render() {
      if (disposed) return;
      const theme = documentRoot.dataset.theme === "dark" ? "dark" : "light";
      if (fieldTheme === theme || hasInput || busy.current) return;
      const attempt = ++generation;
      fieldTheme = theme;
      try {
        await clear();
        if (disposed || attempt !== generation) return;
        const owner = newSession();
        session.current = owner;
        const dark = theme === "dark";
        const color = dark ? "#f0f5fa" : "#172d41";
        const background = dark ? "#172b3a" : "#ffffff";
        const style = {
          input: {
            color,
            background,
            fontFamily: "system-ui, sans-serif",
            fontSize: "16px",
            lineHeight: "24px",
            height: "44px",
            padding: "0 12px",
            border: "none",
          },
          "input::placeholder": { color: dark ? "#a9bac7" : "#637689" },
          ".invalid": { color: dark ? "#ffb3a9" : "#a6322b" },
        };
        const validity: Partial<Record<CardFieldType, HostedFieldState>> = {};
        const changed = (event: { data: Partial<Record<CardFieldType, HostedFieldState>> }) => {
          if (disposed || session.current !== owner) return;
          for (const { type } of fields) if (event.data?.[type]) validity[type] = event.data[type];
          hasInput = fields.some(({ type }) => validity[type]?.isEmpty === false);
          setValid(fields.every(({ type }) => validity[type]?.isValid));
          if (!hasInput) queueMicrotask(render);
        };
        for (const event of ["change", "validitychange", "notempty", "empty"] as const)
          owner.on(event, changed);
        for (const field of fields) {
          const host = hosts.current[field.type];
          if (!host) throw new Error("CARD_FIELD_HOST_MISSING");
          host.style.backgroundColor = background;
          const element = owner.createCardFieldsComponent({
            type: field.type,
            placeholder: field.hint,
            ariaLabel: field.label,
            ariaInvalidErrorMessage: "Provjeri unos.",
            style,
          });
          hostedFields.push(element);
          host.append(element);
        }
        setValid(false);
      } catch {
        await clear();
        if (!disposed && attempt === generation) onUnavailable();
      }
    }
    void render();
    // Updating a PayPal field's style requires rendering it again. Keep a populated
    // field in its original palette until cleared, so editing the app theme cannot erase it.
    const themes = new MutationObserver(render);
    themes.observe(documentRoot, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      disposed = true;
      themes.disconnect();
      void clear();
    };
  }, [newSession, onUnavailable]);
  return (
    <form
      className={styles.form}
      aria-label="Plaćanje karticom"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid || busy.current || !session.current) return;
        busy.current = true;
        setSubmitting(true);
        try {
          await submit(session.current);
        } finally {
          busy.current = false;
          setSubmitting(false);
        }
      }}
    >
      <div className={styles.fields}>
        {fields.map(({ type, label }) => (
          <div key={type} className={styles.field} data-card-field={type}>
            <span aria-hidden="true">{label}</span>
            <div
              className={styles.input}
              ref={(el) => {
                hosts.current[type] = el;
              }}
            />
          </div>
        ))}
      </div>
      <button className={styles.submit} type="submit" disabled={!valid || submitting}>
        <Icon name="card" width={18} height={18} />
        {submitting ? "Obrada uplate…" : `Plati ${checkoutEuro(amountMinor)}`}
      </button>
    </form>
  );
}
