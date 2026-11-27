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
import { languagePath, menuPath } from "../../lib/app-menu";
import type { Appearance } from "../../lib/appearance";
import { localeNames } from "../../lib/i18n/locales";
import { msg } from "../../lib/i18n/translate";
import type { SafeAccountProfile } from "../../server/auth/accounts";
import { useAppAppearance } from "../appearance/AppAppearance";
import { Icon } from "../Icon";
import { useI18n } from "../i18n/LocaleProvider";
import { DevicePush } from "../pwa/DevicePush";
import { Row, RowGroup, RowPill, rowStyles } from "../ui/Rows";
import styles from "./settings.module.css";

const choices = [
  { value: "system", label: msg("Uređaj") },
  { value: "light", label: msg("Svijetla") },
  { value: "dark", label: msg("Tamna") },
] as const;

type Props = {
  initial: SafeAccountProfile;
  active?: boolean;
  focusNotifications?: boolean;
  /** As drawn, Postavke end with Odjava. */
  onLogout?: () => void;
  /** Whether the personal profile carries the verification badge; null while that is unknown. */
  verified?: boolean | null;
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
  onLogout,
  verified = null,
  request = accountSettingsRequest,
  onConfirmed,
}: Props) {
  const { t, locale } = useI18n();
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
      setError(t(accountSettingsError(failure)));
      denied(failure);
    } finally {
      window.clearTimeout(timeout);
      if (live.current && boundary.current === scopedRequest && current === revision.current)
        setLoading(false);
    }
  }, [initial.id, scopedRequest, setAppearance, denied, t]);
  useEffect(() => {
    if (!active) {
      attempted.current = false;
      return;
    }
    if (!attempted.current) void load();
  }, [active, load]);

  /** The theme is saved the moment it is chosen; `next` is that choice. */
  async function save(next: Appearance = draft) {
    if (!active || writing.current || loading || !loaded || blocked || next === confirmed) return;
    writing.current = true;
    controller.current?.abort();
    const current = ++revision.current,
      abort = new AbortController(),
      body = JSON.stringify(appearanceUpdate(next, confirmed));
    controller.current = abort;
    const timeout = window.setTimeout(() => abort.abort(), 20000);
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const account = readAccountSettings(
        await scopedRequest({ method: "PATCH", body, signal: abort.signal }),
        initial.id,
        next,
      );
      if (!live.current || boundary.current !== scopedRequest || current !== revision.current)
        return;
      if (abort.signal.aborted) throw new AccountSettingsError(408, "ACCOUNT_UNAVAILABLE");
      setConfirmed(account.appearance);
      setDraft(account.appearance);
      setAppearance(account.appearance);
      setAccount(account);
      changed.current?.(account);
      setNotice(t("Postavke su sačuvane."));
    } catch (failure) {
      if (!live.current || boundary.current !== scopedRequest || current !== revision.current)
        return;
      // A network failure may happen after COMMIT. Read the saved value before a new intent.
      setBlocked(true);
      setError(t(accountSettingsError(failure)));
      denied(failure);
    } finally {
      window.clearTimeout(timeout);
      if (live.current && boundary.current === scopedRequest && current === revision.current) {
        writing.current = false;
        setSaving(false);
      }
    }
  }

  const own = active && !accessLost && request === accountSettingsRequest;
  const manual = t("Ručna provjera. Ne dolazi s paketom.");
  return (
    <div className={styles.settings} aria-busy={loading || saving}>
      <header className={rowStyles.bar}>
        <Link
          href={menuPath}
          className={`${rowStyles.back} ${styles.back}`}
          aria-label={t("Nazad")}
          prefetch={false}
        >
          <Icon name="chevron" />
        </Link>
        <h1>{t("Postavke")}</h1>
      </header>
      {own && (
        <>
          <RowGroup title={t("Nalog")}>
            <Row
              icon="user"
              title={t("Podaci naloga")}
              sub={`${account.name} · ${account.email}`}
              href="/nalog?odjeljak=profil"
              end={
                account.emailVerified ? undefined : (
                  <RowPill kind="wait">{t("Čeka potvrdu")}</RowPill>
                )
              }
            />
            <Row
              icon="key"
              title={t("Lozinka")}
              value={t("Promijeni lozinku")}
              href="/nalog/lozinka"
            />
            <Row icon="globe" title={t("Google nalog")} href="/nalog/google" />
          </RowGroup>
          <RowGroup title={t("Verifikacija")}>
            {verified === false ? (
              <Row
                icon="shield"
                title={t("Verifikacija profila")}
                sub={manual}
                value={t("Zatraži verifikaciju")}
                href="/nalog/verifikacija"
              />
            ) : (
              <Row
                icon="shield"
                title={t("Verifikacija profila")}
                sub={manual}
                href="/nalog/verifikacija"
                end={verified ? <RowPill kind="ok">{t("Verifikovan")}</RowPill> : undefined}
              />
            )}
          </RowGroup>
        </>
      )}
      <RowGroup title={t("Jezik i izgled")}>
        <Row icon="globe" title={t("Jezik")} value={localeNames[locale]} href={languagePath} />
        <div className={styles.theme}>
          <span className={styles.themeName} aria-hidden="true">
            <Icon name="moon" />
            {t("Tema aplikacije")}
          </span>
          <fieldset className={styles.segments} disabled={loading || saving || !loaded || blocked}>
            <legend className={styles.srOnly}>{t("Tema aplikacije")}</legend>
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
                    void save(choice.value);
                  }}
                />
                {t(choice.label)}
              </label>
            ))}
          </fieldset>
        </div>
      </RowGroup>
      <div className={styles.feedback}>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className={styles.notice}>
            {notice}
          </p>
        )}
        {blocked && !accessLost && (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.quiet}
              disabled={loading || saving}
              onClick={() => void load()}
            >
              {t("Osvježi postavke")}
            </button>
          </div>
        )}
        {accessLost && (
          <Link className={styles.login} href="/prijava?nastavi=%2Fnalog%3Fodjeljak%3Dpostavke">
            {t("Prijavi se ponovo")}
          </Link>
        )}
      </div>
      {own && (
        <RowGroup title={t("Obavijesti")}>
          <section
            className={styles.push}
            ref={deviceNotifications}
            tabIndex={-1}
            aria-label={t("Obavijesti na uređaju")}
          >
            <DevicePush actor={initial.id} />
          </section>
          <Row
            icon="bell"
            title={t("Vrste obavijesti")}
            sub={t("Poruke, termini, reels · telefon i email")}
            href="/nalog/obavijesti"
          />
        </RowGroup>
      )}
      {own && (
        <RowGroup title={t("Privatnost")}>
          <Row icon="eye" title={t("Vidljivost profila")} href="/nalog/vidljivost" />
          <Row icon="block" title={t("Blokirani korisnici")} href={blockedPeoplePath} />
          <Row icon="phone" title={t("Aktivne prijave")} href="/nalog/prijave" />
          <Row icon="download" title={t("Preuzmi svoje podatke")} href="/nalog/podaci" />
        </RowGroup>
      )}
      {onLogout && (
        <div className={styles.logoutWrap}>
          <button type="button" className={styles.logoutButton} onClick={onLogout}>
            <Icon name="logout" />
            {t("Odjava")}
          </button>
        </div>
      )}
    </div>
  );
}
