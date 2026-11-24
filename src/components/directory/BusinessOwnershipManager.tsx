"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { OwnershipLookup, OwnershipSnapshot } from "../../lib/business-ownership";
import {
  type BusinessOwnershipApi,
  businessOwnershipApi,
} from "../../lib/business-ownership-client";
import {
  forgetOwnershipIntent,
  type OwnershipIntent,
  ownershipIntentState,
  ownershipReceiptMatches,
  readOwnershipIntent,
  retainOwnershipIntent,
} from "../../lib/business-ownership-recovery";
import { directoryAccessDenied } from "../../lib/directory-client";
import { DirectoryRequestError } from "../../lib/directory-create-submission";
import { msg } from "../../lib/i18n/translate";
import type { DirectoryBusiness } from "../../server/directory/types";
import { Icon } from "../Icon";
import { useT } from "../i18n/LocaleProvider";
import styles from "./business-ownership.module.css";
import shared from "./directory.module.css";

function message(error: unknown): string {
  const code = error instanceof DirectoryRequestError ? error.code : "";
  if (code === "TARGET_ACCOUNT_NOT_FOUND")
    return msg("Nema potvrđenog i odobrenog naloga s tim emailom.");
  if (code === "TARGET_ACCOUNT_NOT_ELIGIBLE")
    return msg("Novi vlasnik prvo treba potvrditi email i dobiti odobren pristup.");
  if (code === "TARGET_ACCOUNT_CHANGED")
    return msg("Podaci naloga su promijenjeni. Ponovo pronađi vlasnika po emailu.");
  if (code === "BUSINESS_OWNER_UNCHANGED") return msg("Ovaj nalog već vodi djelatnost.");
  if (code === "BUSINESS_LIMIT_REACHED")
    return msg("Ovaj nalog je dosegao dozvoljeni broj djelatnosti.");
  if (code === "VERSION_CONFLICT" || code === "IDEMPOTENCY_CONFLICT")
    return msg("Djelatnost je izmijenjena. Provjeri trenutnog vlasnika prije nove dodjele.");
  if (code === "INVALID_OWNERSHIP_INPUT") return msg("Provjeri email i odabrani nalog.");
  return msg("Zahtjev nije potvrđen. Provjeri trenutno stanje.");
}
export function BusinessOwnershipManager({
  businessId,
  active,
  expectedAccountId,
  api = businessOwnershipApi,
  onChanged,
  onAccessDenied,
  onBack,
}: {
  businessId: string;
  active: boolean;
  expectedAccountId?: string;
  api?: BusinessOwnershipApi;
  onChanged: (business: DirectoryBusiness) => void;
  onAccessDenied: (error: unknown) => boolean;
  onBack: () => void;
}) {
  const t = useT();
  const [snapshot, setSnapshot] = useState<OwnershipSnapshot | null>(null);
  const [candidate, setCandidate] = useState<OwnershipLookup["candidate"] | null>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const epoch = useRef(0);
  const reads = useRef<AbortController | null>(null);
  const writing = useRef(false);
  const pending = useRef<OwnershipIntent | null>(null);
  const live = useRef(false);
  const currentProps = useRef({ active, businessId, expectedAccountId, api });
  currentProps.current = { active, businessId, expectedAccountId, api };
  const callbacks = useRef({ onChanged, onAccessDenied });
  callbacks.current = { onChanged, onAccessDenied };
  const current = useCallback(
    (generation: number) => {
      const value = currentProps.current;
      return (
        live.current &&
        value.active &&
        value.businessId === businessId &&
        value.expectedAccountId === expectedAccountId &&
        value.api === api &&
        epoch.current === generation
      );
    },
    [businessId, expectedAccountId, api],
  );
  const refresh = useCallback(async () => {
    const generation = ++epoch.current;
    reads.current?.abort();
    if (!active || !expectedAccountId) return;
    const controller = new AbortController();
    reads.current = controller;
    setLoading(true);
    setError("");
    setCandidate(null);
    try {
      const intent =
        pending.current ?? readOwnershipIntent(localStorage, expectedAccountId, businessId);
      pending.current = intent;
      const value = await api.read(
        businessId,
        expectedAccountId,
        intent?.command.idempotencyKey,
        controller.signal,
      );
      if (!current(generation) || controller.signal.aborted) return;
      if (intent) {
        const state = ownershipIntentState(intent, value);
        if (state === "invalid") throw new Error("invalid_ownership_receipt");
        if (state === "confirmed" || state === "superseded") {
          forgetOwnershipIntent(localStorage, expectedAccountId, businessId, intent);
          pending.current = null;
          setUncertain(false);
          setNotice(
            state === "superseded"
              ? t("Djelatnost je u međuvremenu izmijenjena. Prikazan je trenutni vlasnik.")
              : value.business.ownerId === intent.command.targetAccountId
                ? t("Djelatnost je dodijeljena novom vlasniku.")
                : t("Dodjela je izvršena. Prikazan je trenutni vlasnik djelatnosti."),
          );
        } else {
          setUncertain(true);
          setError(t("Ishod prethodne dodjele još nije potvrđen."));
        }
      } else setUncertain(false);
      setSnapshot(value);
      callbacks.current.onChanged(value.business);
    } catch (failure) {
      if (!current(generation) || controller.signal.aborted) return;
      setSnapshot(null);
      if (directoryAccessDenied(failure)) {
        callbacks.current.onAccessDenied(failure);
        return;
      }
      setError(t(message(failure)));
    } finally {
      if (current(generation) && !controller.signal.aborted) setLoading(false);
      if (reads.current === controller) reads.current = null;
    }
  }, [active, expectedAccountId, businessId, api, current, t]);
  useLayoutEffect(() => {
    live.current = active;
    function conceal() {
      epoch.current++;
      reads.current?.abort();
      reads.current = null;
      flushSync(() => {
        setSnapshot(null);
        setCandidate(null);
        setLoading(false);
        setError("");
        setNotice("");
      });
    }
    function resume() {
      conceal();
      if (active && document.visibilityState !== "hidden") void refresh();
    }
    const visibility = () => {
      if (document.visibilityState === "hidden") conceal();
      else resume();
    };
    setSnapshot(null);
    setCandidate(null);
    setNotice("");
    if (active) void refresh();
    window.addEventListener("blur", conceal);
    window.addEventListener("pagehide", conceal);
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      live.current = false;
      epoch.current++;
      reads.current?.abort();
      window.removeEventListener("blur", conceal);
      window.removeEventListener("pagehide", conceal);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [active, refresh]);
  async function lookup() {
    if (!expectedAccountId || !snapshot || loading || writing.current || pending.current) return;
    const normalized = email.trim().toLocaleLowerCase("en");
    const generation = ++epoch.current;
    const controller = new AbortController();
    reads.current?.abort();
    reads.current = controller;
    setCandidate(null);
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const value = await api.lookup(businessId, normalized, expectedAccountId, controller.signal);
      if (!current(generation) || controller.signal.aborted) return;
      setSnapshot(value);
      setCandidate(value.candidate);
      callbacks.current.onChanged(value.business);
    } catch (failure) {
      if (!current(generation) || controller.signal.aborted) return;
      if (directoryAccessDenied(failure)) {
        setSnapshot(null);
        callbacks.current.onAccessDenied(failure);
        return;
      }
      setError(t(message(failure)));
    } finally {
      if (current(generation) && !controller.signal.aborted) setLoading(false);
      if (reads.current === controller) reads.current = null;
    }
  }
  async function assign(replay?: OwnershipIntent) {
    if (
      !expectedAccountId ||
      !snapshot ||
      loading ||
      writing.current ||
      (!replay && (!candidate || pending.current || candidate.id === snapshot.currentOwner.id)) ||
      (replay &&
        (replay !== pending.current || ownershipIntentState(replay, snapshot) !== "unchanged"))
    )
      return;
    const intent: OwnershipIntent = replay ?? {
      previousOwnerId: snapshot.currentOwner.id,
      command: {
        expectedVersion: snapshot.business.version,
        targetAccountId: candidate?.id ?? "",
        targetEmail: candidate?.email ?? "",
        idempotencyKey: crypto.randomUUID(),
      },
    };
    try {
      retainOwnershipIntent(localStorage, expectedAccountId, businessId, intent);
    } catch {
      setError(t("Evidencija dodjele nije dostupna. Osvježi stanje prije nastavka."));
      return;
    }
    pending.current = intent;
    const generation = ++epoch.current;
    reads.current?.abort();
    writing.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const value = await api.assign(businessId, intent.command, expectedAccountId);
      if (!current(generation)) return;
      if (!value.receipt || !ownershipReceiptMatches(intent, value.receipt))
        throw new Error("invalid_ownership_acknowledgement");
      forgetOwnershipIntent(localStorage, expectedAccountId, businessId, intent);
      pending.current = null;
      setUncertain(false);
      setSnapshot(value);
      setCandidate(null);
      setEmail("");
      callbacks.current.onChanged(value.business);
      setNotice(
        value.business.ownerId === intent.command.targetAccountId
          ? t("Djelatnost je dodijeljena novom vlasniku.")
          : t("Dodjela je izvršena. Prikazan je trenutni vlasnik djelatnosti."),
      );
    } catch (failure) {
      if (!current(generation)) return;
      const definitive =
        !replay &&
        failure instanceof DirectoryRequestError &&
        [400, 401, 403, 404, 409, 413, 415, 422].includes(failure.status ?? 0);
      if (definitive) {
        try {
          forgetOwnershipIntent(localStorage, expectedAccountId, businessId, intent);
        } catch {
          /* Retain a safe read-only recovery gate if local storage fails. */
        }
        pending.current = null;
      } else setUncertain(true);
      setCandidate(null);
      if (directoryAccessDenied(failure)) {
        setSnapshot(null);
        callbacks.current.onAccessDenied(failure);
        return;
      }
      setError(t(message(failure)));
    } finally {
      writing.current = false;
      if (live.current) setBusy(false);
    }
  }
  if (!active) return null;
  return (
    <section className={styles.workspace} aria-label={t("Dodjela vlasnika djelatnosti")}>
      <header className={styles.header}>
        <h2>{t("Dodijeli vlasnika")}</h2>
        <button type="button" className={shared.secondary} onClick={onBack} disabled={busy}>
          <Icon name="arrow" style={{ transform: "rotate(180deg)" }} /> Nazad
        </button>
      </header>
      {notice && (
        <p className={shared.notice} role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className={shared.error} role="alert">
          {error}
        </p>
      )}
      {snapshot && (
        <div className={styles.panel}>
          <h3>{snapshot.business.title}</h3>
          <p className={styles.label}>{t("Trenutni vlasnik")}</p>
          <strong>{snapshot.currentOwner.name}</strong>
          <p className={styles.email}>{snapshot.currentOwner.email}</p>
          {!uncertain && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void lookup();
              }}
            >
              <label>
                {t("Email novog vlasnika")}
                <input
                  type="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setCandidate(null);
                  }}
                  autoComplete="off"
                  maxLength={254}
                  required
                  disabled={busy || loading}
                  placeholder="ime@primjer.ba"
                />
              </label>
              <button
                type="submit"
                className={shared.secondary}
                disabled={busy || loading || !email.trim()}
              >
                {t("Pronađi nalog")}
              </button>
            </form>
          )}
          {candidate && (
            <div className={styles.candidate}>
              <p className={styles.label}>{t("Novi vlasnik")}</p>
              <strong>{candidate.name}</strong>
              <p className={styles.email}>{candidate.email}</p>
              {candidate.id === snapshot.currentOwner.id ? (
                <p>{t("Ovaj nalog već vodi djelatnost.")}</p>
              ) : (
                <button
                  type="button"
                  className={shared.primary}
                  onClick={() => void assign()}
                  disabled={busy || loading}
                >
                  {busy ? t("Dodjela…") : t("Dodijeli djelatnost")}
                </button>
              )}
            </div>
          )}
        </div>
      )}
      <button
        type="button"
        className={shared.secondary}
        onClick={() => void refresh()}
        disabled={busy || loading}
      >
        {loading
          ? t("Provjera…")
          : uncertain
            ? t("Provjeri prethodnu dodjelu")
            : t("Osvježi stanje")}
      </button>
      {uncertain &&
        snapshot &&
        pending.current &&
        ownershipIntentState(pending.current, snapshot) === "unchanged" && (
          <button
            type="button"
            className={shared.secondary}
            disabled={busy || loading}
            onClick={() => {
              if (pending.current) void assign(pending.current);
            }}
          >
            {t("Ponovi istu dodjelu")}
          </button>
        )}
    </section>
  );
}
