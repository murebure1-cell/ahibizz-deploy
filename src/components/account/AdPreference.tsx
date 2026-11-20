"use client";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { IS_PLAY_EDITION } from "../../lib/distribution";
import styles from "./account.module.css";

type Gender = "women" | "men" | null;
export function AdPreference({ accountId }: { accountId: string }) {
  const [open, setOpen] = useState(false),
    [saved, setSaved] = useState<Gender>(null),
    [draft, setDraft] = useState<Gender>(null),
    [ready, setReady] = useState(false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const working = useRef(false);
  useEffect(() => {
    if (!open) return;
    const a = new AbortController();
    setReady(false);
    setMessage("");
    fetch("/api/account/ad-preference", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { "X-AhiBizz-Account-ID": accountId },
      signal: a.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const d = await r.json();
        if (!a.signal.aborted) {
          setSaved(d.gender);
          setDraft(d.gender);
          setReady(true);
        }
      })
      .catch(() => {
        if (!a.signal.aborted) setMessage("Postavka se trenutno ne može učitati.");
      });
    return () => a.abort();
  }, [accountId, open]);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!ready || working.current) return;
    working.current = true;
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/account/ad-preference", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AhiBizz-Account-ID": accountId },
        body: JSON.stringify({ gender: draft, expected: saved, consent: draft !== null }),
      });
      if (!r.ok) throw new Error();
      setSaved(draft);
      setMessage("Postavka je sačuvana.");
    } catch {
      setReady(false);
      setMessage("Ponovo otvori postavku i provjeri trenutno stanje.");
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  if (IS_PLAY_EDITION) return null;
  return (
    <details className={styles.settingsCard} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Privatnost oglasa</summary>
      <form onSubmit={save}>
        <label>
          Publika za personalizovane oglase
          <select
            value={draft ?? ""}
            disabled={!ready || busy}
            onChange={(e) =>
              setDraft(
                e.target.value === "women" ? "women" : e.target.value === "men" ? "men" : null,
              )
            }
          >
            <option value="">Isključeno</option>
            <option value="women">Žene</option>
            <option value="men">Muškarci</option>
          </select>
        </label>
        <p>
          Izbor je dobrovoljan i privatan. Kada ga sačuvaš, dozvoljavaš AhiBizzu da bira oglase za
          tu publiku. Izborom „Isključeno“ briše se ova postavka.
        </p>
        <button type="submit" disabled={!ready || busy || draft === saved}>
          Sačuvaj izbor
        </button>
        {message && <p role="status">{message}</p>}
      </form>
    </details>
  );
}
