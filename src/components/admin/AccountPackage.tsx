"use client";

import { type FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { accountDate } from "../../lib/display-date";
import {
  type AccountPackageSnapshot,
  type PackageId,
  packageBusinessLimit,
  packageIds,
  packageName,
  readAccountPackage,
} from "../../lib/packages";
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

type Props = {
  actorId: string;
  id: string;
  disabled?: boolean;
  onAccessDenied?: (failure: unknown) => void;
  request?: AdminRequest;
};

/** The administrator's manual package choice for one account, until web billing sets it. */
export function AccountPackage(props: Props) {
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
        Paket
      </button>
      {open && (
        <PackageDialog
          key={`${props.actorId}/${props.id}`}
          {...props}
          close={() => setOpen(false)}
        />
      )}
    </>
  );
}

function limitLabel(id: PackageId) {
  const limit = packageBusinessLimit(id);
  return limit === 1 ? "1 djelatnost" : `do ${limit} djelatnosti`;
}

function PackageDialog({
  actorId,
  id,
  onAccessDenied,
  request = browserAdminRequest,
  close,
}: Props & { close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const api = useMemo(() => adminActorRequest(actorId, request), [actorId, request]);
  const path = `/api/admin/packages/${encodeURIComponent(id)}`;
  const [snapshot, setSnapshot] = useState<AccountPackageSnapshot | null>(null);
  const [choice, setChoice] = useState<PackageId | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const serial = useRef(0);
  const writing = useRef(false);
  const denied = useRef(onAccessDenied);
  denied.current = onAccessDenied;

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (writing.current) return;
      const generation = ++serial.current;
      setLoading(true);
      setError("");
      setSnapshot(null);
      try {
        const response = await api(path, {
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
            : AbortSignal.timeout(20000),
        });
        const next = readAccountPackage(await responseData(response), id);
        if (serial.current !== generation) return;
        setSnapshot(next);
        setChoice(null);
      } catch (failure) {
        if (serial.current !== generation || signal?.aborted) return;
        if (adminAccessDenied(failure)) denied.current?.(failure);
        setError(
          failure instanceof AdminRequestError && failure.code === "TARGET_NOT_ELIGIBLE"
            ? "Administratorski nalog nema paket ni ograničenje."
            : failure instanceof AdminRequestError
              ? errorMessage(failure)
              : "Podaci nisu učitani. Pokušaj ponovo.",
        );
      } finally {
        if (serial.current === generation) setLoading(false);
      }
    },
    [api, id, path],
  );

  useEffect(() => {
    const element = dialog.current;
    const controller = new AbortController();
    element?.showModal();
    void load(controller.signal);
    return () => {
      controller.abort();
      serial.current++;
      element?.close();
    };
  }, [load]);

  async function decide(event: FormEvent) {
    event.preventDefault();
    if (!snapshot || !choice || choice === snapshot.package || writing.current || !reason.trim())
      return;
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
          package: choice,
          expectedVersion: snapshot.version,
          reason: reason.trim(),
        }),
      });
      const next = readAccountPackage(await responseData(response), id);
      if (next.package !== choice || next.version !== snapshot.version + 1)
        throw new AdminRequestError(502);
      if (serial.current !== generation) return;
      setSnapshot(next);
      setChoice(null);
      setReason("");
      setNotice(`Nalog sada ima paket ${packageName(next.package)}.`);
    } catch (failure) {
      if (serial.current !== generation) return;
      if (adminAccessDenied(failure)) denied.current?.(failure);
      const code = failure instanceof AdminRequestError ? failure.code : "";
      if (code === "PACKAGE_BELOW_USAGE")
        setError(
          `Nalog vodi ${snapshot.businesses} djelatnosti, a ${packageName(choice)} dozvoljava ${limitLabel(choice)}. Prvo arhiviraj višak.`,
        );
      else {
        // The outcome of any other failure is unknown until the state is read again.
        setSnapshot(null);
        setError(
          failure instanceof AdminRequestError && failure.status < 500
            ? errorMessage(failure)
            : "Ishod izmjene nije potvrđen. Provjeri trenutno stanje.",
        );
      }
    } finally {
      writing.current = false;
      setSaving(false);
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
        <h2 id={heading}>Paket naloga</h2>
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
              <small>{snapshot.identity}</small>
            </div>
            <span>
              {packageName(snapshot.package)} · {snapshot.businesses} od {snapshot.businessLimit}
            </span>
          </div>
          {snapshot.lastDecision && (
            <details className={styles.history}>
              <summary>Posljednja izmjena</summary>
              <p>
                {packageName(snapshot.lastDecision.previousPackage)} →{" "}
                {packageName(snapshot.lastDecision.package)} ·{" "}
                {accountDate(snapshot.lastDecision.at)}
              </p>
              {snapshot.lastDecision.actorName && <p>{snapshot.lastDecision.actorName}</p>}
              <p>{snapshot.lastDecision.reason}</p>
            </details>
          )}
          <form onSubmit={decide}>
            <fieldset className={styles.choices} disabled={saving}>
              <legend>Novi paket</legend>
              {packageIds.map((option) => (
                <label key={option} className={styles.confirm}>
                  <input
                    type="radio"
                    name={`${heading}-package`}
                    value={option}
                    checked={(choice ?? snapshot.package) === option}
                    onChange={() => setChoice(option)}
                  />
                  <span>
                    <strong>{packageName(option)}</strong> · {limitLabel(option)}
                  </span>
                </label>
              ))}
            </fieldset>
            <label className={styles.note}>
              Razlog izmjene (privatno)
              <textarea
                value={reason}
                maxLength={500}
                rows={3}
                disabled={saving}
                required
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <button
              type="submit"
              className={shared.primary}
              disabled={saving || !choice || choice === snapshot.package || !reason.trim()}
            >
              {saving ? "Spremanje…" : "Promijeni paket"}
            </button>
          </form>
        </>
      )}
    </dialog>
  );
}
