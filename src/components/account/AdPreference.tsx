"use client";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  type AdPreferenceGender,
  createAdPreferenceEpoch,
  readAdPreference,
} from "../../lib/ad-preference";
import { IS_PLAY_EDITION } from "../../lib/distribution";
import styles from "./account.module.css";

export function AdPreference({ accountId }: { accountId: string }) {
  return <PreferencePanel key={accountId} accountId={accountId} />;
}

function PreferencePanel({ accountId }: { accountId: string }) {
  const [open, setOpen] = useState(false),
    [saved, setSaved] = useState<AdPreferenceGender>(null),
    [draft, setDraft] = useState<AdPreferenceGender>(null),
    [ready, setReady] = useState(false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [epoch] = useState(createAdPreferenceEpoch);
  const live = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      epoch.clear();
    };
  }, [epoch]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh reads the final state after a save, including a reopened panel.
  useEffect(() => {
    if (!open || IS_PLAY_EDITION) return;
    const token = epoch.read();
    if (token === null) return;
    const a = new AbortController();
    setReady(false);
    fetch("/api/account/ad-preference", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { "X-AhiBizz-Account-ID": accountId },
      signal: AbortSignal.any([a.signal, AbortSignal.timeout(20000)]),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const gender = readAdPreference(await r.json());
        if (live.current && !a.signal.aborted && epoch.acceptsRead(token)) {
          setSaved(gender);
          setDraft(gender);
          setReady(true);
        }
      })
      .catch(() => {
        if (live.current && !a.signal.aborted && epoch.acceptsRead(token))
          setMessage("Postavka se trenutno ne može učitati. Ponovo otvori ovaj odjeljak.");
      });
    return () => {
      a.abort();
      epoch.endRead(token);
    };
  }, [accountId, open, refresh, epoch]);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    const token = epoch.write();
    if (token === null) return;
    const desired = draft;
    setReady(false);
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/account/ad-preference", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AhiBizz-Account-ID": accountId },
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({ gender: desired, expected: saved, consent: desired !== null }),
      });
      if (!r.ok) throw new Error();
      const confirmed = readAdPreference(await r.json());
      if (confirmed !== desired) throw new Error("AD_PREFERENCE_CHANGED");
      if (!live.current || !epoch.acceptsWrite(token)) return;
      setSaved(confirmed);
      setDraft(confirmed);
      setMessage("Postavka je sačuvana.");
    } catch {
      if (!live.current || !epoch.acceptsWrite(token)) return;
      setReady(false);
      setMessage("Promjena nije potvrđena. Provjeri trenutno stanje prije novog pokušaja.");
    } finally {
      if (epoch.endWrite(token) && live.current) {
        setBusy(false);
        setRefresh((value) => value + 1);
      }
    }
  }
  if (IS_PLAY_EDITION) return null;
  return (
    <details
      className={styles.settingsCard}
      onToggle={(e) => {
        setOpen(e.currentTarget.open);
        if (e.currentTarget.open) {
          setReady(false);
          setMessage("");
        }
      }}
    >
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
