"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AccountSettingsError,
  accountSettingsError,
  accountSettingsRequest,
  appearanceUpdate,
  readAccountSettings,
} from "../../lib/account-settings";
import type { Appearance } from "../../lib/appearance";
import type { SafeAccountProfile } from "../../server/auth/accounts";
import { useAppAppearance } from "../appearance/AppAppearance";
import { Icon } from "../Icon";
import styles from "./account.module.css";

const choices = [
  { value: "system", label: "Prema uređaju", symbol: "◐" },
  { value: "light", label: "Svijetlo", symbol: "☀" },
  { value: "dark", label: "Tamno", symbol: "☾" },
] as const;

export function AccountSettings({
  initial,
  active = true,
  request = accountSettingsRequest,
  onConfirmed,
}: {
  initial: SafeAccountProfile;
  active?: boolean;
  request?: typeof accountSettingsRequest;
  onConfirmed?: (account: SafeAccountProfile) => void;
}) {
  const { setAppearance, resetAppearance } = useAppAppearance();
  const [confirmed, setConfirmed] = useState<Appearance>(initial.appearance),
    [draft, setDraft] = useState<Appearance>(initial.appearance),
    [loaded, setLoaded] = useState(false),
    [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false),
    [blocked, setBlocked] = useState(false),
    [accessLost, setAccessLost] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const live = useRef(false),
    attempted = useRef(false),
    writing = useRef(false),
    revision = useRef(0),
    controller = useRef<AbortController | null>(null),
    api = useRef(request),
    changed = useRef(onConfirmed);
  api.current = request;
  changed.current = onConfirmed;
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      revision.current++;
      controller.current?.abort();
      // React's mount effect replay must start a fresh read after aborting the first one.
      attempted.current = false;
    };
  }, []);

  const denied = useCallback(
    (failure: unknown) => {
      if (
        failure instanceof AccountSettingsError &&
        (failure.status === 401 || failure.status === 403)
      ) {
        setAccessLost(true);
        resetAppearance();
      }
    },
    [resetAppearance],
  );
  const load = useCallback(async () => {
    if (writing.current) return;
    attempted.current = true;
    controller.current?.abort();
    const current = ++revision.current,
      abort = new AbortController();
    controller.current = abort;
    const timeout = window.setTimeout(() => abort.abort(), 20000);
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const account = readAccountSettings(await api.current({ signal: abort.signal }), initial.id);
      if (!live.current || current !== revision.current) return;
      if (abort.signal.aborted) throw new AccountSettingsError(408, "ACCOUNT_UNAVAILABLE");
      setConfirmed(account.appearance);
      setDraft(account.appearance);
      setLoaded(true);
      setBlocked(false);
      setAccessLost(false);
      setAppearance(account.appearance);
      changed.current?.(account);
    } catch (failure) {
      if (!live.current || current !== revision.current) return;
      setBlocked(true);
      setError(accountSettingsError(failure));
      denied(failure);
    } finally {
      window.clearTimeout(timeout);
      if (live.current && current === revision.current) setLoading(false);
    }
  }, [initial.id, setAppearance, denied]);
  useEffect(() => {
    if (active && !attempted.current) void load();
  }, [active, load]);

  async function save() {
    if (writing.current || loading || !loaded || blocked || draft === confirmed) return;
    writing.current = true;
    controller.current?.abort();
    const current = ++revision.current,
      abort = new AbortController(),
      body = JSON.stringify(appearanceUpdate(draft, confirmed));
    controller.current = abort;
    const timeout = window.setTimeout(() => abort.abort(), 20000);
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const account = readAccountSettings(
        await api.current({ method: "PATCH", body, signal: abort.signal }),
        initial.id,
        draft,
      );
      if (!live.current || current !== revision.current) return;
      if (abort.signal.aborted) throw new AccountSettingsError(408, "ACCOUNT_UNAVAILABLE");
      setConfirmed(account.appearance);
      setDraft(account.appearance);
      setAppearance(account.appearance);
      changed.current?.(account);
      setNotice("Postavke su sačuvane.");
    } catch (failure) {
      if (!live.current || current !== revision.current) return;
      // A network failure may happen after COMMIT. Read the saved value before a new intent.
      setBlocked(true);
      setError(accountSettingsError(failure));
      denied(failure);
    } finally {
      window.clearTimeout(timeout);
      if (live.current && current === revision.current) {
        writing.current = false;
        setSaving(false);
      }
    }
  }

  return (
    <div className={styles.settings} aria-busy={loading || saving}>
      <header className={styles.settingsHeading}>
        <div>
          <span className={styles.settingsEyebrow}>Moj nalog</span>
          <h1>Postavke</h1>
        </div>
        <span className={styles.settingsMark} aria-hidden="true">
          <Icon name="sliders" />
        </span>
      </header>
      <section className={styles.settingsCard} aria-labelledby="appearance-heading">
        <h2 id="appearance-heading">Izgled</h2>
        <fieldset
          className={styles.appearanceChoices}
          disabled={loading || saving || !loaded || blocked}
        >
          <legend className={styles.srOnly}>Tema aplikacije</legend>
          {choices.map((choice) => (
            <label key={choice.value} data-selected={draft === choice.value}>
              <input
                type="radio"
                name="appearance"
                value={choice.value}
                checked={draft === choice.value}
                onChange={() => {
                  setDraft(choice.value);
                  setNotice("");
                }}
              />
              <span className={styles.themePreview} data-preview={choice.value} aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              <span className={styles.themeLabel}>
                <span aria-hidden="true">{choice.symbol}</span>
                {choice.label}
                {draft === choice.value && <Icon name="check" />}
              </span>
            </label>
          ))}
        </fieldset>
        <div className={styles.settingsActions}>
          <button
            type="button"
            disabled={loading || saving || !loaded || blocked || draft === confirmed}
            onClick={() => void save()}
          >
            {saving ? "Spremam…" : "Sačuvaj"}
          </button>
          <button
            type="button"
            className={styles.settingsRefresh}
            disabled={loading || saving}
            onClick={() => void load()}
          >
            Osvježi postavke
          </button>
        </div>
        {error && (
          <p role="alert" className={styles.settingsError}>
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className={styles.settingsNotice}>
            {notice}
          </p>
        )}
        {accessLost && (
          <Link
            className={styles.settingsLogin}
            href="/prijava?nastavi=%2Fnalog%3Fodjeljak%3Dpostavke"
          >
            Prijavi se ponovo
          </Link>
        )}
      </section>
    </div>
  );
}
