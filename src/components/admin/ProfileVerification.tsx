"use client";

import {
  type FormEvent,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { accountDate } from "../../lib/display-date";
import type { VerificationKind, VerificationSnapshot } from "../../lib/verification";
import { Icon } from "../Icon";
import shared from "./admin.module.css";
import styles from "./profile-verification.module.css";
import {
  type AdminRequest,
  AdminRequestError,
  adminAccessDenied,
  adminActorRequest,
  browserAdminRequest,
  errorMessage,
  responseData,
} from "./responses";
import { readVerification } from "./verification-response";

type Props = {
  actorId: string;
  kind: VerificationKind;
  id: string;
  disabled?: boolean;
  canGrant?: boolean;
  onAccessDenied?: (failure: unknown) => void;
  request?: AdminRequest;
};

export function ProfileVerification(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className={shared.secondary}
        type="button"
        aria-haspopup="dialog"
        disabled={props.disabled}
        onClick={() => setOpen(true)}
      >
        Verifikacija profila
      </button>
      {open && (
        <DecisionDialog
          key={`${props.actorId}/${props.kind}/${props.id}`}
          {...props}
          close={() => setOpen(false)}
        />
      )}
    </>
  );
}

function DecisionDialog({
  actorId,
  kind,
  id,
  canGrant = true,
  onAccessDenied,
  request = browserAdminRequest,
  close,
}: Props & { close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const api = useMemo(() => adminActorRequest(actorId, request), [actorId, request]);
  const path = `/api/admin/verification/${kind}/${encodeURIComponent(id)}`;
  const [snapshot, setSnapshot] = useState<VerificationSnapshot | null>(null);
  const [reason, setReason] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const serial = useRef(0);
  const active = useRef(false);
  const reading = useRef<AbortController | null>(null);
  const writing = useRef(false);
  const draftVersion = useRef<number | null>(null);
  const denied = useRef(onAccessDenied);
  denied.current = onAccessDenied;

  const load = useCallback(async () => {
    if (!active.current || writing.current) return;
    const generation = ++serial.current;
    reading.current?.abort();
    const controller = new AbortController();
    reading.current = controller;
    setLoading(true);
    setSaving(false);
    setError("");
    setSnapshot(null);
    setReviewed(false);
    try {
      const response = await api(path, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
      });
      const next = readVerification(await responseData(response), kind, id);
      if (serial.current !== generation) return;
      if (draftVersion.current !== next.version) setReason("");
      draftVersion.current = next.version;
      setSnapshot(next);
    } catch (failure) {
      if (serial.current !== generation) return;
      if (adminAccessDenied(failure)) {
        setReason("");
        denied.current?.(failure);
      }
      setError(errorMessage(failure));
    } finally {
      if (serial.current === generation) setLoading(false);
    }
  }, [api, id, kind, path]);

  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    const conceal = () => {
      active.current = false;
      serial.current++;
      reading.current?.abort();
      if (element) element.inert = true;
      setSnapshot(null);
      setError("");
      setNotice("");
      setReviewed(false);
    };
    const resume = () => {
      if (document.visibilityState === "hidden") return;
      active.current = true;
      if (element) element.inert = false;
      void load();
    };
    const visibility = () => (document.visibilityState === "hidden" ? conceal() : resume());
    resume();
    window.addEventListener("blur", conceal);
    window.addEventListener("focus", resume);
    window.addEventListener("pagehide", conceal);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      active.current = false;
      serial.current++;
      reading.current?.abort();
      window.removeEventListener("blur", conceal);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pagehide", conceal);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", visibility);
      element?.close();
    };
  }, [load]);

  async function decide(event: FormEvent) {
    event.preventDefault();
    if (
      !snapshot ||
      !active.current ||
      writing.current ||
      !reviewed ||
      !reason.trim() ||
      (!snapshot.verified && !canGrant)
    )
      return;
    const verified = !snapshot.verified;
    const generation = ++serial.current;
    writing.current = true;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await api(path, {
        method: "PUT",
        signal: AbortSignal.timeout(20000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verified,
          expectedVersion: snapshot.version,
          reason: reason.trim(),
        }),
      });
      const next = readVerification(await responseData(response), kind, id);
      if (next.verified !== verified || next.version !== snapshot.version + 1)
        throw new AdminRequestError(502);
      if (serial.current !== generation) return;
      draftVersion.current = next.version;
      setSnapshot(next);
      setReason("");
      setNotice(verified ? "Oznaka je dodijeljena." : "Oznaka je povučena.");
    } catch (failure) {
      if (serial.current !== generation) return;
      setSnapshot(null);
      if (adminAccessDenied(failure)) {
        setReason("");
        denied.current?.(failure);
      }
      setError(
        failure instanceof AdminRequestError && failure.code === "TARGET_NOT_ELIGIBLE"
          ? "Ovaj profil trenutno ne ispunjava uslove za oznaku."
          : failure instanceof AdminRequestError && failure.status < 500
            ? errorMessage(failure)
            : "Ishod odluke nije potvrđen. Provjeri trenutno stanje.",
      );
    } finally {
      writing.current = false;
      if (active.current) {
        setSaving(false);
        setReviewed(false);
        if (serial.current !== generation) void load();
      }
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={heading}
      className={styles.dialog}
      onCancel={(event) => {
        event.preventDefault();
        if (!writing.current) close();
      }}
    >
      <header>
        <h2 id={heading}>Verifikacija profila</h2>
        <button
          type="button"
          onClick={close}
          disabled={saving}
          aria-label="Zatvori"
          className={styles.close}
        >
          <Icon name="close" />
        </button>
      </header>
      {error && (
        <p className={shared.error} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={shared.notice} role="status">
          {notice}
        </p>
      )}
      {!snapshot &&
        (loading || saving ? (
          <p role="status">Provjera stanja…</p>
        ) : (
          <button className={shared.secondary} type="button" onClick={() => void load()}>
            Provjeri stanje
          </button>
        ))}
      {snapshot && (
        <>
          <div className={styles.identity}>
            <div>
              <strong>{snapshot.subjectLabel}</strong>
              {kind === "person" ? (
                <small>{snapshot.identity}</small>
              ) : (
                <a
                  href={`/ljudi/${encodeURIComponent(snapshot.identity)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Profil vlasnika <Icon name="external" />
                </a>
              )}
            </div>
            <span>{snapshot.verified ? "Verifikovan profil" : "Bez oznake"}</span>
          </div>
          {snapshot.lastDecision && (
            <details className={styles.history}>
              <summary>Posljednja odluka</summary>
              <p>
                {snapshot.lastDecision.verified ? "Oznaka dodijeljena" : "Oznaka povučena"} ·{" "}
                {accountDate(snapshot.lastDecision.at)}
              </p>
              {snapshot.lastDecision.actorName && <p>{snapshot.lastDecision.actorName}</p>}
              {snapshot.lastDecision.reason && <p>{snapshot.lastDecision.reason}</p>}
            </details>
          )}
          {!snapshot.verified && !canGrant ? (
            <p>Profil trenutno ne ispunjava uslove za oznaku.</p>
          ) : (
            <form onSubmit={decide}>
              <label className={styles.note}>
                Razlog odluke (privatno)
                <textarea
                  value={reason}
                  maxLength={500}
                  rows={3}
                  disabled={saving}
                  required
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <label className={styles.confirm}>
                <input
                  type="checkbox"
                  checked={reviewed}
                  disabled={saving}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                {snapshot.verified
                  ? "Potvrđujem povlačenje oznake"
                  : kind === "person"
                    ? "Identitet je provjeren"
                    : "Vlasništvo je provjereno"}
              </label>
              <button
                type="submit"
                className={snapshot.verified ? shared.secondary : shared.primary}
                disabled={saving || !reviewed || !reason.trim()}
              >
                {saving ? "Spremanje…" : snapshot.verified ? "Povuci oznaku" : "Dodijeli oznaku"}
              </button>
            </form>
          )}
        </>
      )}
    </dialog>
  );
}
