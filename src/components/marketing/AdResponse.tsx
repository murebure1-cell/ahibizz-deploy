"use client";
import Link from "next/link";
import { type FormEvent, useRef, useState } from "react";
import { monthlyLoanPayment } from "../../lib/ad-response";
import { authReturnLinks } from "../../lib/auth-return";
import { billingMoney } from "../../lib/billing";
import { messageLink } from "../../lib/messaging";
import styles from "./ad-response.module.css";

export function AdResponse({
  formatId,
  businessId,
  campaignId,
  principalMinor,
  onOpen,
}: {
  formatId: string;
  businessId: string;
  campaignId: string;
  principalMinor?: number | null;
  onOpen?: () => void;
}) {
  if (formatId !== "loan_calculator" && formatId !== "lead_form") return null;
  return (
    <AdInquiry
      key={campaignId}
      loan={formatId === "loan_calculator"}
      businessId={businessId}
      campaignId={campaignId}
      principalMinor={principalMinor}
      onOpen={onOpen}
    />
  );
}
function AdInquiry({
  loan,
  businessId,
  campaignId,
  principalMinor,
  onOpen,
}: {
  loan: boolean;
  businessId: string;
  campaignId: string;
  principalMinor?: number | null;
  onOpen?: () => void;
}) {
  const [p, setP] = useState(principalMinor ? String(principalMinor / 100) : ""),
    [apr, setApr] = useState(""),
    [months, setMonths] = useState("12");
  const estimate =
    p && apr.trim() !== "" ? monthlyLoanPayment(Number(p), Number(apr), Number(months)) : null;
  const [message, setMessage] = useState(""),
    [guest, setGuest] = useState(false),
    [sent, setSent] = useState(false),
    [busy, setBusy] = useState(false);
  const running = useRef(false),
    attempt = useRef<{ body: string; actor: string; key: string } | null>(null);
  const thread = messageLink({ kind: "business", targetId: businessId });
  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (running.current || sent) return;
    const data = new FormData(e.currentTarget),
      comment = String(data.get("comment") ?? "").trim(),
      phone = String(data.get("phone") ?? "").trim(),
      email = String(data.get("email") ?? "").trim();
    const body = [
      loan ? "Upit o finansiranju" : "Upit putem oglasa",
      loan && estimate !== null
        ? `Iznos ${p} KM, ${months} mj., godišnja kamata ${apr}%, procijenjena rata ${billingMoney(Math.round(estimate * 100))}.`
        : "",
      comment,
      phone && "Telefon: " + phone,
      email && "Email: " + email,
    ]
      .filter(Boolean)
      .join("\n");
    running.current = true;
    setBusy(true);
    setMessage("");
    setGuest(false);
    try {
      const profile = await fetch("/api/account", {
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
      });
      if (profile.status === 401) {
        setGuest(true);
        return;
      }
      if (!profile.ok) throw new Error();
      const actor = (await profile.json()).account?.id;
      if (typeof actor !== "string") throw new Error();
      if (!attempt.current || attempt.current.body !== body || attempt.current.actor !== actor)
        attempt.current = { body, actor, key: crypto.randomUUID() };
      const result = await fetch("/api/marketing/inquiry", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-AhiBizz-Account-ID": actor },
        body: JSON.stringify({ businessId, campaignId, body, id: attempt.current.key }),
      });
      if (result.status === 401) {
        setGuest(true);
        return;
      }
      if (result.status === 410) {
        setMessage("Ova kampanja je završena.");
        return;
      }
      if (result.status === 429) {
        setMessage("Pokušaj poslati upit malo kasnije.");
        return;
      }
      if (!result.ok) throw new Error();
      setSent(true);
      setMessage("Upit je poslan djelatnosti.");
    } catch {
      setMessage("Upit nije potvrđen. Pokušaj ponovo.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return (
    <details
      className={styles.response}
      onToggle={(e) => {
        if (e.currentTarget.open) onOpen?.();
      }}
    >
      <summary>{loan ? "Izračunaj ratu" : "Zatraži ponudu"}</summary>
      <form className={styles.form} onSubmit={send}>
        {loan && (
          <fieldset>
            <legend>Informativni obračun</legend>
            <label>
              Iznos (KM)
              <input
                type="number"
                min=".01"
                step=".01"
                max="10000000"
                required
                value={p}
                onChange={(e) => setP(e.target.value)}
              />
            </label>
            <label>
              Godišnja kamata (%)
              <input
                type="number"
                min="0"
                max="100"
                step=".01"
                required
                value={apr}
                onChange={(e) => setApr(e.target.value)}
              />
            </label>
            <label>
              Broj mjeseci
              <input
                type="number"
                min="1"
                max="600"
                required
                value={months}
                onChange={(e) => setMonths(e.target.value)}
              />
            </label>
            {estimate !== null && (
              <output>
                Mjesečna rata oko <strong>{billingMoney(Math.round(estimate * 100))}</strong>, bez
                naknada.
              </output>
            )}
          </fieldset>
        )}
        {!sent && (
          <>
            <label>
              Poruka
              <textarea name="comment" maxLength={1000} required={!loan} rows={2} />
            </label>
            <details>
              <summary>Dodaj kontakt za odgovor</summary>
              <label>
                Telefon
                <input type="tel" autoComplete="tel" name="phone" maxLength={36} />
              </label>
              <label>
                Email
                <input type="email" autoComplete="email" name="email" maxLength={160} />
              </label>
            </details>
            <button type="submit" disabled={busy}>
              Pošalji upit oglašivaču
            </button>
          </>
        )}
        {guest && <Link href={authReturnLinks(thread).login}>Prijavi se za slanje upita</Link>}
        {message && <p role="status">{message}</p>}
        {sent && <Link href={thread}>Otvori razgovor</Link>}
      </form>
    </details>
  );
}
