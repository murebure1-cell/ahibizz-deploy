"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { blockedPeoplePath } from "../../lib/account-blocks";
import {
  AccountSettingsError,
  accountSettingsActorRequest,
  accountSettingsError,
  accountSettingsRequest,
  appearanceUpdate,
  readAccountSettings,
} from "../../lib/account-settings";
import type { Appearance } from "../../lib/appearance";
import type { SafeAccountProfile } from "../../server/auth/accounts";
import { useAppAppearance } from "../appearance/AppAppearance";
import { Icon } from "../Icon";
import { DevicePush } from "../pwa/DevicePush";
import permissionStyles from "../pwa/permissions.module.css";
import { AccountPassword } from "./AccountPassword";
import styles from "./account.module.css";

const choices = [
  { value: "system", label: "Prema uređaju", symbol: "◐" },
  { value: "light", label: "Svijetlo", symbol: "☀" },
  { value: "dark", label: "Tamno", symbol: "☾" },
] as const;

type Props = {
  initial: SafeAccountProfile;
  active?: boolean;
  focusNotifications?: boolean;
  request?: typeof accountSettingsRequest;
  onConfirmed?: (account: SafeAccountProfile) => void;
};

export function AccountSettings(props: Props) {
  return <SettingsWorkspace key={props.initial.id} {...props} />;
}

function SettingsWorkspace({
  initial,
  active = true,
  focusNotifications = false,
  request = accountSettingsRequest,
  onConfirmed,
}: Props) {
  const { setAppearance, resetAppearance } = useAppAppearance();
  const [account, setAccount] = useState(initial);
  const scopedRequest = useMemo(
    () => accountSettingsActorRequest(initial.id, request),
    [initial.id, request],
  );
  const [confirmed, setConfirmed] = useState<Appearance>(initial.appearance),
    [draft, setDraft] = useState<Appearance>(initial.appearance),
    [loaded, setLoaded] = useState(false),
    [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false),
    [blocked, setBlocked] = useState(false),
    [accessLost, setAccessLost] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const deviceNotifications = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!active || !focusNotifications) return;
    const frame = window.requestAnimationFrame(() => {
      deviceNotifications.current?.focus({ preventScroll: true });
      deviceNotifications.current?.scrollIntoView({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active, focusNotifications]);
  const live = useRef(false),
    attempted = useRef(false),
    writing = useRef(false),
    revision = useRef(0),
    controller = useRef<AbortController | null>(null),
    boundary = useRef(scopedRequest),
    changed = useRef(onConfirmed);
  boundary.current = scopedRequest;
  changed.current = onConfirmed;
  // biome-ignore lint/correctness/useExhaustiveDependencies: A changed transport starts a new authority epoch and invalidates its pending acknowledgements.
  useEffect(() => {
    live.current = true;
    attempted.current = false;
    writing.current = false;
    setLoaded(false);
    setBlocked(false);
    setSaving(false);
    setError("");
    setNotice("");
    setAccessLost(false);
    return () => {
      live.current = false;
      revision.current++;
      controller.current?.abort();
      // React's mount effect replay must start a fresh read after aborting the first one.
      attempted.current = false;
    };
  }, [scopedRequest]);

  const denied = useCallback(
    (failure: unknown) => {
      if (
        failure instanceof AccountSettingsError &&
        (failure.status === 401 || failure.status === 403)
      ) {
        setAccessLost(true);
        setLoaded(false);
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
      const account = readAccountSettings(
        await scopedRequest({ signal: abort.signal }),
        initial.id,
      );
      if (!live.current || boundary.current !== scopedRequest || current !== revision.current)
        return;
      if (abort.signal.aborted) throw new AccountSettingsError(408, "ACCOUNT_UNAVAILABLE");
      setConfirmed(account.appearance);
      setDraft(account.appearance);
      setLoaded(true);
      setBlocked(false);
      setAccessLost(false);
      setAppearance(account.appearance);
      setAccount(account);
      changed.current?.(account);
    } catch (failure) {
      if (!live.current || boundary.current !== scopedRequest || current !== revision.current)
        return;
      setBlocked(true);
      setError(accountSettingsError(failure));
      denied(failure);
    } finally {
      window.clearTimeout(timeout);
      if (live.current && boundary.current === scopedRequest && current === revision.current)
        setLoading(false);
    }
  }, [initial.id, scopedRequest, setAppearance, denied]);
  useEffect(() => {
    if (!active) {
      attempted.current = false;
      return;
    }
    if (!attempted.current) void load();
  }, [active, load]);

  async function save() {
    if (!active || writing.current || loading || !loaded || blocked || draft === confirmed) return;
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
        await scopedRequest({ method: "PATCH", body, signal: abort.signal }),
        initial.id,
        draft,
      );
      if (!live.current || boundary.current !== scopedRequest || current !== revision.current)
        return;
      if (abort.signal.aborted) throw new AccountSettingsError(408, "ACCOUNT_UNAVAILABLE");
      setConfirmed(account.appearance);
      setDraft(account.appearance);
      setAppearance(account.appearance);
      setAccount(account);
      changed.current?.(account);
      setNotice("Postavke su sačuvane.");
    } catch (failure) {
      if (!live.current || boundary.current !== scopedRequest || current !== revision.current)
        return;
      // A network failure may happen after COMMIT. Read the saved value before a new intent.
      setBlocked(true);
      setError(accountSettingsError(failure));
      denied(failure);
    } finally {
      window.clearTimeout(timeout);
      if (live.current && boundary.current === scopedRequest && current === revision.current) {
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
      {active && !accessLost && request === accountSettingsRequest && (
        <>
          <section className={styles.settingsCard} aria-labelledby="identity-heading">
            <h2 id="identity-heading">Korisničke informacije</h2>
            <dl className={styles.settingsIdentity}>
              <div>
                <dt>Ime i prezime</dt>
                <dd>{account.name}</dd>
              </div>
              <div>
                <dt>Email za prijavu</dt>
                <dd>{account.email}</dd>
              </div>
              <div>
                <dt>Verifikacija emaila</dt>
                <dd>
                  {account.emailVerified ? (
                    <>
                      <Icon name="check" /> Potvrđen
                    </>
                  ) : (
                    "Čeka potvrdu"
                  )}
                </dd>
              </div>
            </dl>
            <div className={styles.settingsLinks}>
              <Link href="/nalog?odjeljak=profil">
                <Icon name="user" /> Uredi lične podatke
              </Link>
              <Link href="/nalog?odjeljak=djelatnosti">
                <Icon name="shop" /> Moje djelatnosti
              </Link>
            </div>
          </section>
          <AccountPassword accountId={account.id} email={account.email} />
        </>
      )}
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
      {active && !accessLost && request === accountSettingsRequest && (
        <section
          aria-label="Obavijesti na uređaju"
          className={styles.settingsCard}
          ref={deviceNotifications}
          tabIndex={-1}
        >
          <div className={permissionStyles.permissions}>
            <DevicePush actor={initial.id} />
          </div>
        </section>
      )}
      <section className={styles.settingsCard} aria-labelledby="privacy-heading">
        <h2 id="privacy-heading">Privatnost i podaci</h2>
        <div className={styles.settingsLinks}>
          <Link href={blockedPeoplePath}>
            <Icon name="user" /> Blokirani korisnici
          </Link>
          <Link href="/privatnost">
            <Icon name="info" /> Pravila privatnosti
          </Link>
          <Link href="/pomoc?tema=sigurnost#kontakt">
            <Icon name="mail" /> Zatraži pristup podacima
          </Link>
          <Link href="/brisanje-naloga">
            <Icon name="shield" /> Zatraži brisanje naloga
          </Link>
        </div>
      </section>
    </div>
  );
}
