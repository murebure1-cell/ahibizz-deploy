"use client";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  type AdAsset,
  adAssetMaxBytes,
  adAssetPath,
  adAssetTypes,
  isAdAssetType,
} from "../../lib/ad-asset";
import { AdCampaignAsset } from "./AdCampaignAsset";
import styles from "./marketing.module.css";
export function AdCreativeManager({
  accountId,
  orderId,
  editable,
  assetVersion,
  onChange,
}: {
  accountId: string;
  orderId: string;
  editable: boolean;
  assetVersion?: number;
  onChange?: () => void;
}) {
  const [open, setOpen] = useState(false),
    [asset, setAsset] = useState<AdAsset | null>(null),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [preview, setPreview] = useState<{ url: string; version: number } | null>(null),
    [attempt, setAttempt] = useState(0);
  const running = useRef(false);
  const base = "/api/marketing/creative/" + orderId;
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh on retry or a version changed in another browser.
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    setLoaded(false);
    setMessage("");
    fetch(base, {
      headers: { "X-AhiBizz-Account-ID": accountId },
      cache: "no-store",
      signal: abort.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const item = await r.json();
        if (!abort.signal.aborted) {
          setAsset(item.asset);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) setMessage("Materijal trenutno nije dostupan.");
      });
    return () => abort.abort();
  }, [base, accountId, open, assetVersion, attempt]);
  useEffect(() => {
    if (!open || !asset) return;
    const abort = new AbortController();
    let url: string | undefined;
    fetch(adAssetPath(orderId, asset.version), {
      headers: { "X-AhiBizz-Account-ID": accountId },
      signal: abort.signal,
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const blob = await r.blob();
        if (!abort.signal.aborted) {
          url = URL.createObjectURL(blob);
          setPreview({ url, version: asset.version });
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) setMessage("Pregled materijala nije dostupan.");
      });
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [accountId, orderId, asset, open]);
  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!loaded || running.current) return;
    const form = e.currentTarget,
      item = new FormData(form).get("file");
    if (
      !(item instanceof File) ||
      !item.size ||
      item.size > adAssetMaxBytes ||
      !isAdAssetType(item.type)
    ) {
      setMessage("Odaberi JPG, PNG, WebP, GIF, MP4 ili HTML5 do 1.000 KB.");
      return;
    }
    running.current = true;
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch(base, {
        method: "PUT",
        headers: {
          "X-AhiBizz-Account-ID": accountId,
          "X-Asset-Version": String(asset?.version ?? 0),
          "Content-Type": item.type,
        },
        body: item,
      });
      if (r.status === 409) {
        setMessage("Kampanja je izmijenjena. Osvježi zahtjev.");
        return;
      }
      if (!r.ok) throw new Error();
      setAsset((await r.json()).asset);
      form.reset();
      setMessage("Materijal je sačuvan za pregled.");
      onChange?.();
    } catch {
      setMessage("Materijal nije sačuvan. Provjeri format i pokušaj ponovo.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Materijal kampanje{assetVersion ? " · priložena datoteka" : ""}</summary>
      {open && (
        <>
          <p>{loaded && !asset ? "Kampanja koristi fotografiju profila djelatnosti." : ""}</p>
          {loaded && asset && preview?.version === asset.version && (
            <div style={{ height: "12rem" }}>
              <AdCampaignAsset asset={asset} campaignId={orderId} privateUrl={preview.url} />
            </div>
          )}
          {editable && loaded && (
            <form className={styles.form} onSubmit={upload}>
              <label>
                Datoteka do 1.000 KB
                <input name="file" required type="file" accept={adAssetTypes.join(",")} />
              </label>
              <button type="submit" disabled={busy}>
                Sačuvaj materijal
              </button>
            </form>
          )}
          {message && (
            <p role="status">
              {message}{" "}
              <button type="button" onClick={() => setAttempt((n) => n + 1)}>
                Osvježi
              </button>
            </p>
          )}
        </>
      )}
    </details>
  );
}
