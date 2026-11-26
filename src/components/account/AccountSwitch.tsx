"use client";

import Link from "next/link";
import { useState } from "react";
import { clearBrowserMessagingRecovery } from "../../lib/messaging-recovery-storage";
import { useAppAppearance } from "../appearance/AppAppearance";
import { Icon } from "../Icon";
import { useI18n } from "../i18n/LocaleProvider";
import { profileInitials } from "../people/PersonalProfileCard";
import { Row } from "../ui/Rows";
import { Sheet } from "../ui/Sheet";
import styles from "./account-switch.module.css";

type DeviceAccount = { id: string; name: string; role: "member" | "owner"; active: boolean };

/** How many accounts the server lets one device keep (deviceAccountLimit). */
const limit = 3;
const addHref = "/prijava?dodaj=1&nastavi=%2Fmeni";

function readAccounts(value: unknown): DeviceAccount[] | null {
  const list = (value as { accounts?: unknown } | null)?.accounts;
  if (!Array.isArray(list)) return null;
  return list.filter(
    (item): item is DeviceAccount =>
      typeof item?.id === "string" &&
      typeof item.name === "string" &&
      (item.role === "member" || item.role === "owner") &&
      typeof item.active === "boolean",
  );
}

/**
 * "Prebaci nalog": every account signed in on this device, the active one marked. Choosing
 * another makes it active and opens its own start (administration for the owner account), so
 * each account shows only what is its own. "Dodaj nalog" signs another in beside these.
 */
export function AccountSwitch({
  currentId,
  circleClassName,
}: {
  currentId: string;
  /** Open from a round icon button (the administration's header) instead of a menu row. */
  circleClassName?: string;
}) {
  const { t } = useI18n();
  const { resetAppearance } = useAppAppearance();
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<DeviceAccount[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function show() {
    setOpen(true);
    setError("");
    try {
      const response = await fetch("/api/account/accounts", { cache: "no-store" });
      const list = response.ok ? readAccounts(await response.json()) : null;
      if (!list) throw new Error("accounts");
      setAccounts(list);
    } catch {
      setError(t("Naloge na ovom uređaju trenutno nije moguće učitati."));
    }
  }
  async function choose(account: DeviceAccount) {
    if (busy) return;
    if (account.active) {
      setOpen(false);
      return;
    }
    setBusy(account.id);
    setError("");
    try {
      const response = await fetch("/api/account/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: account.id }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok !== true) throw new Error(String(result.code ?? "switch"));
      // Nothing of the account being left stays in this browser's memory.
      clearBrowserMessagingRecovery(currentId);
      resetAppearance();
      window.location.assign(result.next === "/administracija" ? "/administracija" : "/nalog");
    } catch {
      setError(t("Prebacivanje nije uspjelo. Prijavi se ponovo na taj nalog."));
      setBusy(null);
      setAccounts((list) => list?.filter((item) => item.id !== account.id) ?? null);
    }
  }
  return (
    <>
      {circleClassName ? (
        <button
          type="button"
          className={circleClassName}
          aria-label={t("Prebaci nalog")}
          onClick={() => void show()}
        >
          <Icon name="swap" />
        </button>
      ) : (
        <Row icon="swap" title={t("Prebaci nalog")} onClick={() => void show()} />
      )}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t("Prebaci nalog")}
        closeLabel={t("Zatvori")}
      >
        <div className={styles.list}>
          {accounts === null && !error && (
            <p className={styles.loading} role="status">
              {t("Učitavanje…")}
            </p>
          )}
          {accounts?.map((account) => (
            <button
              key={account.id}
              type="button"
              className={styles.account}
              aria-current={account.active ? "true" : undefined}
              disabled={busy !== null}
              onClick={() => void choose(account)}
            >
              {account.role === "owner" ? (
                <span className={styles.admin} aria-hidden="true">
                  <Icon name="shield" />
                </span>
              ) : (
                <span className={styles.avatar} aria-hidden="true">
                  {profileInitials(account.name)}
                </span>
              )}
              <span className={styles.text}>
                <strong dir="auto">{account.name}</strong>
                <span>
                  {account.role === "owner"
                    ? t("Administracija: odobravanje, objave i odluke")
                    : t("Lični profil")}
                </span>
              </span>
              {account.active ? (
                <span className={styles.on}>
                  <Icon name="check" />
                  <span className={styles.hidden}>{t("Aktivan")}</span>
                </span>
              ) : busy === account.id ? (
                <span className={styles.wait} role="status">
                  {t("Trenutak…")}
                </span>
              ) : null}
            </button>
          ))}
          {accounts && accounts.length < limit && (
            <Link href={addHref} className={styles.add} prefetch={false}>
              <span aria-hidden="true">
                <Icon name="plus" />
              </span>
              {t("Dodaj nalog")}
            </Link>
          )}
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <p className={styles.note}>
            <Icon name="info" aria-hidden="true" />
            {t(
              "Nalozi ostaju prijavljeni na ovom uređaju. Svaki vidi samo svoje: poruke, obavijesti, objave i postavke se ne miješaju. Odjava odjavljuje sve naloge na uređaju.",
            )}
          </p>
        </div>
      </Sheet>
    </>
  );
}
