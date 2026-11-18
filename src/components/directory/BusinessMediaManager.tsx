"use client";

import Image from "next/image";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  type BusinessMediaAsset,
  type BusinessMediaKind,
  type BusinessMediaManifest,
  type BusinessMediaReceipt,
  businessMediaUrl,
  readBusinessMediaManifest,
  readBusinessMediaReceipt,
} from "../../lib/business-media";
import {
  BusinessMediaRequestError,
  businessMediaAccessDenied,
  businessMediaActorRequest,
  businessMediaError,
  businessMediaNeedsRecovery,
  businessMediaRequest,
} from "../../lib/business-media-client";
import { Icon } from "../Icon";
import { BusinessLogo } from "./BusinessLogo";
import styles from "./business-media.module.css";

type ImageUrl = (
  businessId: string,
  asset: BusinessMediaAsset,
  area: "mine" | "public",
) => string | null;
type PendingMedia = {
  businessId: string;
  kind: BusinessMediaKind;
  slot: number;
  expectedVersion: number;
  key: string;
  method: "PUT" | "DELETE";
  file: File | null;
  uncertain?: boolean;
  receipt?: BusinessMediaReceipt;
};
const statuses = {
  draft: "Nacrt",
  pending: "Na pregledu",
  published: "Objavljeno",
  archived: "Arhivirano",
};
function safeImage(value: string | null): string | null {
  if (!value || value.includes("\\") || [...value].some((char) => char.charCodeAt(0) <= 32))
    return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  if (value.startsWith("blob:") && typeof window !== "undefined") {
    try {
      if (new URL(value).origin === window.location.origin) return value;
    } catch {
      return null;
    }
  }
  return null;
}
function UploadButton({
  label,
  disabled,
  onFile,
}: {
  label: string;
  disabled: boolean;
  onFile: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null),
    id = useId();
  return (
    <>
      <input
        ref={input}
        id={id}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        disabled={disabled}
        hidden
        aria-label={label}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) onFile(file);
        }}
      />
      <button
        type="button"
        className={styles.secondary}
        disabled={disabled}
        aria-controls={id}
        onClick={() => input.current?.click()}
      >
        {label}
      </button>
    </>
  );
}

export function BusinessMediaManager({
  businessId,
  businessTitle,
  active = true,
  preview = false,
  request = businessMediaRequest,
  imageUrl = businessMediaUrl,
  onChanged,
  onBack,
  expectedAccountId,
  onAccessDenied,
}: {
  businessId: string;
  businessTitle: string;
  active?: boolean;
  preview?: boolean;
  request?: typeof businessMediaRequest;
  imageUrl?: ImageUrl;
  onChanged?: (manifest: BusinessMediaManifest) => void;
  onBack?: () => void;
  expectedAccountId?: string;
  onAccessDenied?: (failure: unknown) => void;
}) {
  const [manifest, setManifest] = useState<BusinessMediaManifest | null>(null),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [pending, setPending] = useState<PendingMedia | null>(null),
    [loginRequired, setLoginRequired] = useState(false);
  const scopedRequest = useMemo(
    () => businessMediaActorRequest(expectedAccountId, request),
    [expectedAccountId, request],
  );
  const api = useRef(scopedRequest),
    changed = useRef(onChanged),
    deniedCallback = useRef(onAccessDenied),
    actor = useRef(expectedAccountId),
    accessEpoch = useRef(0),
    pendingRef = useRef<PendingMedia | null>(null),
    currentId = useRef(businessId),
    read = useRef<AbortController | null>(null),
    revision = useRef(0),
    writing = useRef(false),
    writeToken = useRef(0),
    live = useRef(false);
  api.current = scopedRequest;
  changed.current = onChanged;
  deniedCallback.current = onAccessDenied;
  actor.current = expectedAccountId;
  currentId.current = businessId;
  const clearDeniedAccess = useCallback((failure: unknown) => {
    if (!businessMediaAccessDenied(failure)) return false;
    const command = pendingRef.current;
    const recovery =
      command && (command.uncertain || command.receipt || writing.current)
        ? { ...command, uncertain: true }
        : null;
    accessEpoch.current++;
    revision.current++;
    writeToken.current++;
    read.current?.abort();
    writing.current = false;
    pendingRef.current = recovery;
    setManifest(null);
    setPending(recovery);
    setBusy(false);
    setLoading(false);
    setNotice("");
    setLoginRequired(true);
    setError(businessMediaError(failure));
    deniedCallback.current?.(failure);
    return true;
  }, []);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      accessEpoch.current++;
      revision.current++;
      read.current?.abort();
    };
  }, []);
  const load = useCallback(async () => {
    if (writing.current) return;
    if (preview && request === businessMediaRequest) {
      setError("Fotografije nisu dostupne u ovom prikazu.");
      return;
    }
    read.current?.abort();
    const controller = new AbortController(),
      current = ++revision.current,
      access = accessEpoch.current,
      expectedActor = expectedAccountId,
      transport = api.current;
    read.current = controller;
    setLoading(true);
    setError("");
    try {
      const result = await transport(`mine/${encodeURIComponent(businessId)}`, {
        signal: controller.signal,
      });
      const next = readBusinessMediaManifest(result.manifest);
      if (next.businessId !== businessId) throw new Error("invalid_media_business");
      if (
        !live.current ||
        api.current !== transport ||
        actor.current !== expectedActor ||
        access !== accessEpoch.current ||
        controller.signal.aborted ||
        current !== revision.current
      )
        return;
      setManifest(next);
      setLoginRequired(false);
      changed.current?.(next);
      return next;
    } catch (failure) {
      if (
        !live.current ||
        api.current !== transport ||
        actor.current !== expectedActor ||
        access !== accessEpoch.current
      )
        return;
      if (clearDeniedAccess(failure)) return;
      if (live.current && !controller.signal.aborted && current === revision.current) {
        if (
          failure instanceof BusinessMediaRequestError &&
          [401, 403, 404].includes(failure.status)
        )
          setManifest(null);
        setError(businessMediaError(failure));
      }
    } finally {
      if (
        live.current &&
        api.current === transport &&
        actor.current === expectedActor &&
        access === accessEpoch.current &&
        current === revision.current
      )
        setLoading(false);
    }
  }, [businessId, preview, request, expectedAccountId, clearDeniedAccess]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A different business or preview boundary discards that workspace's local view.
  useEffect(() => {
    setManifest(null);
    setPending(null);
    pendingRef.current = null;
    setNotice("");
    setError("");
    setBusy(false);
    setLoginRequired(false);
    accessEpoch.current++;
    writeToken.current++;
    writing.current = false;
    return () => {
      revision.current++;
      read.current?.abort();
    };
  }, [businessId, preview, scopedRequest]);
  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  async function send(intent: PendingMedia) {
    if (
      writing.current ||
      !active ||
      intent.businessId !== businessId ||
      (preview && request === businessMediaRequest)
    )
      return;
    writing.current = true;
    const token = ++writeToken.current,
      access = accessEpoch.current,
      expectedActor = expectedAccountId,
      transport = api.current;
    read.current?.abort();
    revision.current++;
    setBusy(true);
    setError("");
    setNotice("");
    setPending(intent);
    pendingRef.current = intent;
    let refreshConflict = false;
    try {
      const receipt =
        intent.receipt ??
        readBusinessMediaReceipt(
          (
            await transport(
              `mine/${encodeURIComponent(intent.businessId)}/${intent.kind}/${intent.slot}`,
              {
                method: intent.method,
                headers: {
                  "If-Match": `"${intent.expectedVersion}"`,
                  "Idempotency-Key": intent.key,
                  ...(intent.file ? { "Content-Type": intent.file.type } : {}),
                },
                ...(intent.file ? { body: intent.file } : {}),
              },
            )
          ).receipt,
        );
      if (
        receipt.businessId !== intent.businessId ||
        receipt.kind !== intent.kind ||
        receipt.slot !== intent.slot ||
        receipt.businessVersion !== intent.expectedVersion + 1 ||
        (intent.method === "PUT"
          ? receipt.mediaVersion !== receipt.businessVersion
          : receipt.mediaVersion !== null)
      )
        throw new Error("unconfirmed_media_write");
      if (
        !live.current ||
        api.current !== transport ||
        actor.current !== expectedActor ||
        access !== accessEpoch.current ||
        token !== writeToken.current
      )
        return;
      const acknowledged = { ...intent, receipt };
      pendingRef.current = acknowledged;
      setPending(acknowledged);
      // The idempotent receipt proves the command, never the current publication state.
      const fresh = readBusinessMediaManifest(
        (await transport(`mine/${encodeURIComponent(intent.businessId)}`)).manifest,
      );
      if (fresh.businessId !== intent.businessId || fresh.businessVersion < receipt.businessVersion)
        throw new Error("unconfirmed_current_media");
      if (
        live.current &&
        api.current === transport &&
        actor.current === expectedActor &&
        access === accessEpoch.current &&
        token === writeToken.current &&
        currentId.current === intent.businessId
      ) {
        setManifest(fresh);
        changed.current?.(fresh);
        setPending(null);
        pendingRef.current = null;
        setLoginRequired(false);
        setNotice(
          fresh.status === "pending" || fresh.pendingMedia
            ? "Izmjene su poslane na pregled."
            : "Fotografije su ažurirane.",
        );
      }
    } catch (failure) {
      if (
        live.current &&
        api.current === transport &&
        actor.current === expectedActor &&
        access === accessEpoch.current &&
        token === writeToken.current &&
        currentId.current === intent.businessId
      ) {
        const command = pendingRef.current?.key === intent.key ? pendingRef.current : intent;
        const recover = businessMediaNeedsRecovery(command, failure);
        const recovery = recover ? { ...command, uncertain: true } : null;
        pendingRef.current = recovery;
        setPending(recovery);
        if (clearDeniedAccess(failure)) return;
        setError(businessMediaError(failure));
        if (
          failure instanceof BusinessMediaRequestError &&
          failure.status >= 400 &&
          failure.status < 500 &&
          !recover
        ) {
          setPending(null);
          if ([401, 403, 404].includes(failure.status)) setManifest(null);
          refreshConflict = failure.status === 409;
        }
      }
    } finally {
      if (
        api.current === transport &&
        actor.current === expectedActor &&
        access === accessEpoch.current &&
        token === writeToken.current
      ) {
        writing.current = false;
        if (live.current && currentId.current === intent.businessId) setBusy(false);
        if (refreshConflict && live.current && currentId.current === intent.businessId) void load();
      }
    }
  }
  function act(kind: BusinessMediaKind, slot: number, file: File | null) {
    if (!manifest || writing.current || pending || !active || manifest.status === "archived")
      return;
    if (
      file &&
      (!file.size ||
        file.size > 4 * 1024 * 1024 ||
        !["image/jpeg", "image/png", "image/webp"].includes(file.type))
    ) {
      setError(
        file.size > 4 * 1024 * 1024
          ? "Izaberi fotografiju do 4 MB."
          : "Izaberi ispravnu JPG, PNG ili WebP fotografiju.",
      );
      return;
    }
    void send({
      businessId,
      kind,
      slot,
      expectedVersion: manifest.businessVersion,
      key: crypto.randomUUID(),
      method: file ? "PUT" : "DELETE",
      file,
    });
  }
  const disabled =
    !active || busy || loading || pending !== null || !manifest || manifest.status === "archived";
  const source = (asset: BusinessMediaAsset | null) =>
    asset ? safeImage(imageUrl(businessId, asset, "mine")) : null;
  const nextSlot = Array.from({ length: 8 }, (_, index) => index + 1).find(
    (slot) => !manifest?.gallery.some((asset) => asset.slot === slot),
  );
  const initials = businessTitle
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? "")
    .join("")
    .toLocaleUpperCase("bs");
  return (
    <section
      className={styles.workspace}
      aria-label={loginRequired ? "Fotografije" : `Fotografije: ${businessTitle}`}
    >
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>FOTOGRAFIJE</p>
          <h2>{loginRequired ? "Fotografije" : businessTitle}</h2>
        </div>
        {onBack && (
          <button
            type="button"
            className={styles.secondary}
            disabled={busy || pending !== null}
            onClick={onBack}
          >
            <Icon name="arrow" />
            Nazad
          </button>
        )}
      </header>
      {manifest && (
        <p className={styles.status}>
          Status profila: <strong>{statuses[manifest.status]}</strong>
          {manifest.pendingMedia && " · Fotografije na pregledu"}
        </p>
      )}
      {manifest?.status === "archived" && (
        <p className={styles.notice}>Prvo vrati djelatnost iz arhive.</p>
      )}
      {error && (
        <div role="alert" className={styles.error}>
          <p>{error}</p>
          {!pending && (
            <button
              type="button"
              className={styles.secondary}
              disabled={busy || loading || !active}
              onClick={() => void load()}
            >
              Učitaj trenutno stanje
            </button>
          )}
        </div>
      )}
      {pending && !busy && (
        <div role="status" className={styles.notice}>
          <p>Prethodna izmjena još nije potvrđena.</p>
          <button
            type="button"
            className={styles.secondary}
            disabled={!active}
            onClick={() => void send(pending)}
          >
            Ponovi isti zahtjev
          </button>
        </div>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {!manifest && loading && (
        <p role="status" className={styles.empty}>
          Otvaram fotografije…
        </p>
      )}
      {manifest && (
        <>
          <div className={styles.brandGrid}>
            <section className={styles.card} aria-label="Logotip djelatnosti">
              <h3>Logotip</h3>
              <div className={styles.logo}>
                {source(manifest.logo) ? (
                  <BusinessLogo
                    src={source(manifest.logo) as string}
                    alt={`Logotip: ${businessTitle}`}
                    monogram={initials}
                    sizes="132px"
                  />
                ) : (
                  <span aria-hidden="true">{initials}</span>
                )}
              </div>
              <div className={styles.actions}>
                <UploadButton
                  label={manifest.logo ? "Promijeni logotip" : "Odaberi logotip"}
                  disabled={disabled}
                  onFile={(file) => act("logo", 0, file)}
                />
                {manifest.logo && (
                  <button
                    type="button"
                    className={styles.remove}
                    disabled={disabled}
                    onClick={() => act("logo", 0, null)}
                  >
                    Ukloni logotip
                  </button>
                )}
              </div>
            </section>
            <section className={styles.card} aria-label="Naslovna fotografija">
              <h3>Naslovna fotografija</h3>
              <div className={styles.cover}>
                {source(manifest.cover) ? (
                  <Image
                    src={source(manifest.cover) as string}
                    alt={`Naslovna fotografija: ${businessTitle}`}
                    width={1600}
                    height={600}
                    unoptimized
                  />
                ) : (
                  <Image
                    src="/brand/ahi-logo-white.svg"
                    alt="AhiBizz"
                    width={150}
                    height={40}
                    unoptimized
                  />
                )}
              </div>
              <div className={styles.actions}>
                <UploadButton
                  label={manifest.cover ? "Promijeni naslovnu" : "Odaberi naslovnu"}
                  disabled={disabled}
                  onFile={(file) => act("cover", 0, file)}
                />
                {manifest.cover && (
                  <button
                    type="button"
                    className={styles.remove}
                    disabled={disabled}
                    onClick={() => act("cover", 0, null)}
                  >
                    Ukloni naslovnu
                  </button>
                )}
              </div>
            </section>
          </div>
          <section className={styles.card} aria-label="Galerija djelatnosti">
            <div className={styles.galleryHeading}>
              <h3>Galerija</h3>
              <p>Do 8 fotografija · JPG, PNG ili WebP · do 4 MB</p>
            </div>
            <div className={styles.gallery}>
              {manifest.gallery.map((asset) => (
                <figure key={asset.slot} className={styles.galleryItem}>
                  {source(asset) && (
                    <Image
                      src={source(asset) as string}
                      alt={`Fotografija ${asset.slot}: ${businessTitle}`}
                      width={asset.width}
                      height={asset.height}
                      unoptimized
                    />
                  )}
                  <figcaption>Fotografija {asset.slot}</figcaption>
                  <div className={styles.actions}>
                    <UploadButton
                      label={`Zamijeni fotografiju ${asset.slot}`}
                      disabled={disabled}
                      onFile={(file) => act("gallery", asset.slot, file)}
                    />
                    <button
                      type="button"
                      className={styles.remove}
                      disabled={disabled}
                      onClick={() => act("gallery", asset.slot, null)}
                    >
                      Ukloni fotografiju {asset.slot}
                    </button>
                  </div>
                </figure>
              ))}
              {nextSlot && (
                <div className={styles.addPhoto}>
                  <Icon name="shop" />
                  <UploadButton
                    label="Dodaj fotografiju"
                    disabled={disabled}
                    onFile={(file) => act("gallery", nextSlot, file)}
                  />
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </section>
  );
}
