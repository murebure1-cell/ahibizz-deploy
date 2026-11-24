"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import type { SavedSearch } from "../../lib/saved-search";
import { Icon } from "../Icon";
import { useT } from "../i18n/LocaleProvider";
import styles from "./saved-searches.module.css";

type Change =
  | { action: "save"; filters: string; label: string }
  | { action: "remove"; filters: string };
async function changeSearch(accountId: string, change: Change) {
  const result = await fetch("/api/account/saved-searches", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-AhiBizz-Account-ID": accountId },
    body: JSON.stringify(change),
  });
  const data = await result.json();
  if (!result.ok || data.accountId !== accountId || !Array.isArray(data.searches))
    throw new Error(data.code === "SEARCH_LIMIT" ? "limit" : "unavailable");
  return data.searches as SavedSearch[];
}
export function SaveSearchButton(props: SavedSearch) {
  const t = useT();
  const [status, setStatus] = useState<"idle" | "busy" | "saved" | "guest" | "error" | "limit">(
    "idle",
  );
  const pending = useRef(false);
  async function save() {
    if (pending.current) return;
    pending.current = true;
    setStatus("busy");
    try {
      const response = await fetch("/api/account/saved-searches", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (response.status === 401 || response.status === 403) {
        setStatus("guest");
        return;
      }
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (typeof data.accountId !== "string") throw new Error();
      await changeSearch(data.accountId, { action: "save", ...props });
      setStatus("saved");
    } catch (error) {
      setStatus(error instanceof Error && error.message === "limit" ? "limit" : "error");
    } finally {
      pending.current = false;
    }
  }
  return (
    <span className={styles.save}>
      <button
        type="button"
        onClick={() => void save()}
        disabled={status === "busy" || status === "saved"}
      >
        <Icon name={status === "saved" ? "check" : "heart"} />
        {status === "saved" ? t("Pretraga sačuvana") : t("Sačuvaj pretragu")}
      </button>
      {status === "guest" && (
        <Link href={`/prijava?nastavi=${encodeURIComponent(`/pretraga${props.filters}`)}`}>
          {t("Prijavi se za čuvanje")}
        </Link>
      )}
      {status === "limit" && <span role="status">{t("Dostignut je limit od 30 pretraga.")}</span>}
      {status === "error" && (
        <span role="status">{t("Pretraga se trenutno ne može sačuvati.")}</span>
      )}
    </span>
  );
}
export function SavedSearchList({
  accountId,
  initial,
}: {
  accountId: string;
  initial: SavedSearch[];
}) {
  const t = useT();
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function remove(filters: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      setItems(await changeSearch(accountId, { action: "remove", filters }));
    } catch {
      setError(t("Uklanjanje nije uspjelo. Pokušaj ponovo."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.list}>
      {error && <p role="alert">{error}</p>}
      {!!items.length && (
        <ul>
          {items.map((item) => (
            <li key={item.filters}>
              <Link href={`/pretraga${item.filters}`}>
                <Icon name="search" />
                <span dir="auto">{item.label}</span>
                <Icon name="chevron" />
              </Link>
              <button
                type="button"
                aria-label={`Ukloni pretragu ${item.label}`}
                disabled={busy}
                onClick={() => void remove(item.filters)}
              >
                {t("Ukloni")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!items.length && <p>{t("Sačuvane pretrage će se pojaviti ovdje.")}</p>}
    </div>
  );
}
