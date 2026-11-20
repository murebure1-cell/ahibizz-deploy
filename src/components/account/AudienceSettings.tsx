"use client";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  type AudienceChoice,
  audienceHint,
  audienceRegions,
  isAudienceChoice,
} from "../../lib/ad-audience-sample";
import { IS_PLAY_EDITION } from "../../lib/distribution";
import styles from "./account.module.css";

function syncHint(account: string, choice: AudienceChoice) {
  try {
    if (choice === "off") localStorage.removeItem(audienceHint);
    else localStorage.setItem(audienceHint, account);
  } catch {}
}
export function AudienceSettings({ accountId }: { accountId: string }) {
  const [open, setOpen] = useState(false),
    [saved, setSaved] = useState<AudienceChoice | null>(null),
    [draft, setDraft] = useState<AudienceChoice>("off"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const working = useRef(false);
  useEffect(() => {
    if (!open || IS_PLAY_EDITION) return;
    const a = new AbortController();
    setSaved(null);
    setMessage("");
    fetch("/api/account/audience-sample", {
      cache: "no-store",
      headers: { "X-AhiBizz-Account-ID": accountId },
      signal: a.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const { choice } = await r.json();
        if (!a.signal.aborted && isAudienceChoice(choice)) {
          setSaved(choice);
          setDraft(choice);
          syncHint(accountId, choice);
        }
      })
      .catch(() => {
        if (!a.signal.aborted) setMessage("Postavka se trenutno ne može učitati.");
      });
    return () => a.abort();
  }, [open, accountId]);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (working.current || saved === null) return;
    working.current = true;
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/account/audience-sample", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AhiBizz-Account-ID": accountId },
        body: JSON.stringify({ choice: draft, expected: saved }),
      });
      if (!r.ok) throw new Error();
      setSaved(draft);
      syncHint(accountId, draft);
      setMessage("Postavka je sačuvana.");
    } catch {
      setSaved(null);
      setMessage("Ponovo otvori postavku i provjeri izbor.");
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  if (IS_PLAY_EDITION) return null;
  return (
    <details className={styles.settingsCard} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Mjerenje publike</summary>
      <form onSubmit={save}>
        <label>
          Učešće u statistici AhiBizza
          <select
            value={draft}
            disabled={saved === null || busy}
            onChange={(e) => {
              if (isAudienceChoice(e.target.value)) setDraft(e.target.value);
            }}
          >
            <option value="off">Isključeno</option>
            <option value="general">Učestvujem bez regije</option>
            {Object.entries(audienceRegions).map(([key, text]) => (
              <option key={key} value={key}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <p>
          Ako pristaneš, na ovom uređaju brojimo posjete i preglede stranica. Regiju biraš po želji.
          Izborom „Isključeno“ brišeš svoje podatke iz ovog mjerenja.
        </p>
        <button type="submit" disabled={saved === null || busy || draft === saved}>
          Sačuvaj izbor
        </button>
        {message && <p role="status">{message}</p>}
      </form>
    </details>
  );
}
