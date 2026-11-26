"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { adminMailPath, adminSectionPath, contentPaths } from "../../lib/admin-navigation";
import { type AdminTodayRow, readAdminToday } from "../../lib/admin-today";
import { clearBrowserMessagingRecovery } from "../../lib/messaging-recovery-storage";
import { AccountSwitch } from "../account/AccountSwitch";
import { useAppAppearance } from "../appearance/AppAppearance";
import { Icon, type IconName } from "../Icon";
import { useI18n } from "../i18n/LocaleProvider";
import { Row, RowGroup, RowPill, rowStyles } from "../ui/Rows";
import styles from "./admin-home.module.css";
import { adminActorRequest, responseData } from "./responses";

const days = ["Nedjelja", "Ponedjeljak", "Utorak", "Srijeda", "Četvrtak", "Petak", "Subota"];

/** "Srijeda, 25. 11." in Sarajevo, without relying on Bosnian data in Intl. */
function today() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Sarajevo",
      weekday: "short",
      day: "numeric",
      month: "numeric",
    })
      .formatToParts(new Date())
      .map((part) => [part.type, part.value]),
  );
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday ?? "");
  return `${days[weekday] ?? ""}, ${parts.day}. ${parts.month}.`;
}

type Tile = {
  id: string;
  icon: IconName;
  label: string;
  href: string;
  kind: "wait" | "bad" | "ok";
};

/**
 * The administration's home as drawn (AdminPocetna): who is signed in and how much waits, the
 * queues as tiles, what to publish, and every part of the administration as rows.
 */
export function AdminHome({ accountId, name }: { accountId: string; name: string }) {
  const { t } = useI18n();
  const { resetAppearance } = useAppAppearance();
  const [rows, setRows] = useState<AdminTodayRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [date, setDate] = useState("");
  useEffect(() => setDate(today()), []);
  useEffect(() => {
    const controller = new AbortController();
    adminActorRequest(accountId)("/api/admin/today", { signal: controller.signal })
      .then(responseData)
      .then((data) => {
        if (!controller.signal.aborted) setRows(readAdminToday(data.queues));
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [accountId]);
  const count = (id: AdminTodayRow["id"]) => rows?.find((row) => row.id === id)?.count;
  const waiting = rows?.reduce((sum, row) => sum + row.count, 0);
  const tiles: Tile[] = [
    {
      id: "accounts",
      icon: "user",
      label: "Nalozi",
      href: adminSectionPath("approvalQueue"),
      kind: "wait",
    },
    {
      id: "businesses",
      icon: "shop",
      label: "Djelatnosti",
      href: adminSectionPath("businessQueue"),
      kind: "wait",
    },
    {
      id: "reports",
      icon: "shield",
      label: "Prijave sadržaja",
      href: "/administracija/zahtjevi",
      kind: "bad",
    },
    { id: "reels", icon: "play", label: "Reelsi", href: "/administracija/reels", kind: "ok" },
  ];
  async function signOut() {
    if (leaving) return;
    setLeaving(true);
    try {
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) throw new Error("sign-out");
      clearBrowserMessagingRecovery(accountId);
      resetAppearance();
      window.location.assign("/prijava");
    } catch {
      setLeaving(false);
    }
  }
  return (
    <main id="glavni-sadrzaj" className={`${rowStyles.screen} ${styles.home}`}>
      <header className={styles.head}>
        <span className={styles.mark} aria-hidden="true">
          <Icon name="shield" />
        </span>
        <span className={styles.who}>
          <h1>{name}</h1>
          <span>
            {date}
            {waiting !== undefined && ` · ${t("čeka odluku: {count}", { count: waiting })}`}
          </span>
        </span>
        <AccountSwitch currentId={accountId} circleClassName={styles.circle} />
      </header>

      <section className={styles.block} aria-labelledby="admin-waiting">
        <h2 id="admin-waiting">{t("Čeka odluku")}</h2>
        <div className={styles.tiles}>
          {tiles.map((tile) => {
            const value = tile.id === "reels" ? undefined : count(tile.id as AdminTodayRow["id"]);
            return (
              <Link key={tile.id} href={tile.href} className={styles.tile} prefetch={false}>
                <span className={styles.tileTop}>
                  <span className={styles.tileIcon} data-kind={tile.kind} aria-hidden="true">
                    <Icon name={tile.icon} />
                  </span>
                  <b>
                    {tile.id === "reels" ? (
                      <Icon name="chevron" />
                    ) : value === undefined ? (
                      failed ? (
                        "–"
                      ) : (
                        "…"
                      )
                    ) : (
                      value
                    )}
                  </b>
                </span>
                <span className={styles.tileName}>{t(tile.label)}</span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className={styles.block} aria-labelledby="admin-publish">
        <h2 id="admin-publish">{t("Objavi")}</h2>
        <div className={styles.publish}>
          <Link href={contentPaths.articles} className={styles.outline} prefetch={false}>
            <Icon name="doc" />
            {t("Blog članak")}
          </Link>
          <span className={styles.outline} aria-disabled="true">
            <Icon name="bell" />
            {t("Obavještenje")}
            <small>{t("Uskoro")}</small>
          </span>
        </div>
      </section>

      <div className={styles.rows}>
        <RowGroup title={t("Upravljanje")}>
          <Row icon="user" title={t("Nalozi i paketi")} href={adminSectionPath("accounts")} />
          <Row
            icon="shop"
            title={t("Djelatnosti i kategorije")}
            href={adminSectionPath("businesses")}
          />
          <Row icon="star" title={t("Recenzije")} href={adminSectionPath("reviews")} />
          <Row icon="play" title={t("Pregled Reelsa")} href="/administracija/reels" />
          <Row icon="book" title={t("Blog i sadržaj")} href={contentPaths.home} />
          <Row icon="mail" title={t("Mailovi")} href={adminMailPath} />
          <Row icon="message" title={t("Zahtjevi i prijave")} href="/administracija/zahtjevi" />
          <Row icon="swap" title={t("Odvojena administracija")} href="/administracija/odvojena" />
          <Row
            icon="layers"
            title={t("Sponzorisano")}
            end={<RowPill kind="off">{t("Uskoro")}</RowPill>}
          />
        </RowGroup>
      </div>

      <p className={styles.note}>
        <Icon name="info" aria-hidden="true" />
        <span>
          {t("Prijavljen si kao administracija. Objave i odluke nose ovo ime, ne tvoje lično.")}
        </span>
        <button type="button" disabled={leaving} onClick={() => void signOut()}>
          {t("Odjava")}
        </button>
      </p>
    </main>
  );
}
