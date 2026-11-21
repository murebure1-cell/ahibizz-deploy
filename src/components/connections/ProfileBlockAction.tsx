"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type BlockState, blockRequestMessage, blocksRequest } from "../../lib/account-blocks";
import styles from "./connections.module.css";

export function ProfileBlockAction({
  accountId,
  personId,
  disabled,
  onContact,
}: {
  accountId: string;
  personId: string;
  disabled?: boolean;
  onContact(value: BlockState): void;
}) {
  const [state, setState] = useState<BlockState | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef<AbortController | null>(null);
  const path = `/${encodeURIComponent(personId)}`;
  const read = useCallback(async () => {
    running.current?.abort();
    const controller = new AbortController();
    running.current = controller;
    try {
      const value = await blocksRequest<BlockState>(accountId, path, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setState(value);
      onContact(value);
    } catch (failure) {
      if (!controller.signal.aborted) setError(blockRequestMessage(failure));
    }
  }, [accountId, path, onContact]);
  useEffect(() => {
    void read();
    return () => running.current?.abort();
  }, [read]);

  async function change() {
    if (!state || busy || disabled) return;
    running.current?.abort();
    const controller = new AbortController();
    running.current = controller;
    setBusy(true);
    setError("");
    setNotice("");
    const blocked = !state.blockedByMe;
    try {
      const next = await blocksRequest<BlockState>(accountId, path, {
        method: "PATCH",
        body: JSON.stringify({ blocked, expectedVersion: state.version }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setState(next);
      onContact(next);
      setNotice(blocked ? "Korisnik je blokiran." : "Korisnik je odblokiran.");
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(blockRequestMessage(failure));
        void read();
      }
    } finally {
      if (!controller.signal.aborted || running.current !== controller) {
        setBusy(false);
        setConfirm(false);
      }
    }
  }
  return (
    <div className={styles.blockControls}>
      {state &&
        (!confirm ? (
          <button
            type="button"
            className={styles.quietButton}
            disabled={disabled || busy}
            onClick={() => setConfirm(true)}
          >
            {state.blockedByMe ? "Odblokiraj korisnika" : "Blokiraj korisnika"}
          </button>
        ) : (
          <>
            <span>
              {state.blockedByMe
                ? "Želiš li ukloniti svoju blokadu?"
                : "Nove poruke i zahtjevi za prijateljstvo bit će zaustavljeni."}
            </span>
            <button
              type="button"
              className={styles.dangerButton}
              disabled={disabled || busy}
              onClick={() => void change()}
            >
              {state.blockedByMe ? "Potvrdi odblokiranje" : "Potvrdi blokiranje"}
            </button>
            <button
              type="button"
              className={styles.quietButton}
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              Odustani
            </button>
          </>
        ))}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert">
          {error}{" "}
          <button
            type="button"
            className={styles.quietButton}
            onClick={() => {
              setError("");
              void read();
            }}
          >
            Osvježi
          </button>
        </p>
      )}
    </div>
  );
}
