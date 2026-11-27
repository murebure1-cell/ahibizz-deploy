"use client";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import {
  type AccountAnalytics,
  type AnalyticsPeriod,
  analyticsPath,
  analyticsPeriods,
} from "../../lib/account-analytics";
import { msg } from "../../lib/i18n/translate";
import { packageName } from "../../lib/packages";
import { Icon, type IconName } from "../Icon";
import { useT } from "../i18n/LocaleProvider";
import { ScreenBar } from "../ui/Rows";
import styles from "./analytics.module.css";
import look from "./overview.module.css";

const weekdays = [
  msg("ponedjeljak"),
  msg("utorak"),
  msg("srijeda"),
  msg("četvrtak"),
  msg("petak"),
  msg("subota"),
  msg("nedjelja"),
];
const numbers = new Intl.NumberFormat("de-DE");

function change(now: number, before: number) {
  if (before === 0) return null;
  return Math.round(((now - before) / before) * 100);
}

function Locked({ from, text }: { from: "startup" | "business"; text: string }) {
  const t = useT();
  return (
    <div className={styles.locked}>
      <div className={styles.lockedSample} aria-hidden="true">
        {[40, 62, 48, 75, 58, 82, 66, 90].map((height) => (
          <span key={height} style={{ height: `${height}%` }} />
        ))}
      </div>
      <div className={styles.lockedText}>
        <span className={styles.lockIcon}>
          <Icon name="lock" />
        </span>
        <strong>{from === "startup" ? t("Od paketa Startup") : t("Od paketa Business")}</strong>
        <span>{text}</span>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/** "Analitika" as drawn: the numbers of the owner's businesses, as far as the package goes. */
export function AnalyticsScreen({
  accountId,
  business,
  days,
}: {
  accountId: string;
  business: string | null;
  days: AnalyticsPeriod;
}) {
  const t = useT();
  const router = useRouter();
  const [data, setData] = useState<AccountAnalytics | null>(null),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    const params = new URLSearchParams({ dana: String(days) });
    if (business) params.set("djelatnost", business);
    fetch(`/api/account/analytics?${params}`, {
      cache: "no-store",
      signal: controller.signal,
      headers: { "X-AhiBizz-Account-ID": accountId },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`analytics_${response.status}`);
        setData((await response.json()) as AccountAnalytics);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [accountId, business, days]);

  const full = data !== null && (data.package === null || data.package === "business");
  const detailed = full || data?.package === "startup";
  const totalSources = data?.sources ? Object.values(data.sources).reduce((a, b) => a + b, 0) : 0;
  const maxDay = data?.daily ? Math.max(1, ...data.daily.map((row) => row.views)) : 1;
  const touchesNow = data?.touches ? Object.values(data.touches).reduce((a, b) => a + b, 0) : 0;
  const csv = `/api/account/analytics?${new URLSearchParams({
    ...(business ? { djelatnost: business } : {}),
    dana: String(days),
    izvoz: "csv",
  })}`;
  const insights: { icon: IconName; text: string }[] = [];
  if (data?.peak)
    insights.push({
      icon: "clock",
      text: t("Najviše pregleda: {day}, od {from} do {to} h", {
        day: t(weekdays[data.peak.weekday - 1] ?? ""),
        from: data.peak.hour,
        to: (data.peak.hour + 1) % 24,
      }),
    });
  const touchChange = data?.previous ? change(touchesNow, data.previous.touches) : null;
  if (touchChange !== null)
    insights.push({
      icon: "chart",
      text:
        touchChange >= 0
          ? t("Dodira je {n} % više nego u prošlom periodu", { n: touchChange })
          : t("Dodira je {n} % manje nego u prošlom periodu", { n: -touchChange }),
    });

  return (
    <>
      <ScreenBar title={t("Analitika")} backHref="/nalog" backLabel={t("Moj profil")}>
        {data?.package && (
          <span className={look.package} data-package={data.package}>
            {t("Paket")} <strong>{packageName(data.package)}</strong>
          </span>
        )}
      </ScreenBar>
      <div className={styles.screen}>
        <div className={styles.pickers}>
          <label>
            <span className={styles.srOnly}>{t("Djelatnost")}</span>
            <select
              value={business ?? ""}
              onChange={(event) =>
                router.replace(analyticsPath(event.target.value || null, days), { scroll: false })
              }
            >
              <option value="">{t("Sve djelatnosti")}</option>
              {data?.businesses.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={styles.srOnly}>{t("Period")}</span>
            <select
              value={days}
              onChange={(event) =>
                router.replace(
                  analyticsPath(business, Number(event.target.value) as AnalyticsPeriod),
                  { scroll: false },
                )
              }
            >
              {analyticsPeriods.map((value) => (
                <option key={value} value={value}>
                  {t("{n} dana", { n: value })}
                </option>
              ))}
            </select>
          </label>
        </div>
        {failed && (
          <p role="alert" className={styles.failure}>
            {t("Podaci trenutno nisu dostupni.")}
          </p>
        )}
        <div className={styles.totals} aria-busy={!data}>
          {(
            [
              ["profileViews", t("Pregledi profila")],
              ["businessViews", t("Pregledi djelatnosti")],
            ] as const
          ).map(([key, label]) => {
            const value = data?.[key] ?? 0;
            const delta = data?.previous ? change(value, data.previous[key]) : null;
            return (
              <div key={key}>
                <strong>{data ? numbers.format(value) : "—"}</strong>
                <span>{label}</span>
                {delta !== null && (
                  <small data-down={delta < 0 || undefined}>
                    {delta >= 0
                      ? t("+{n} % prema prošlom periodu", { n: delta })
                      : t("−{n} % prema prošlom periodu", { n: -delta })}
                  </small>
                )}
              </div>
            );
          })}
        </div>
        {data && (
          <>
            <Section title={t("Po danima")}>
              {detailed && data.daily ? (
                <div className={styles.chart}>
                  <div className={styles.bars}>
                    {data.daily.map((row, index) => (
                      <span
                        key={row.day}
                        data-last={index < 7 || undefined}
                        style={{ height: `${Math.max(4, (row.views / maxDay) * 100)}%` }}
                        title={`${row.day}: ${row.views}`}
                      />
                    ))}
                  </div>
                  <div className={styles.axis}>
                    <span>{t("prošla sedmica")}</span>
                    <span>{t("ova sedmica")}</span>
                  </div>
                </div>
              ) : (
                <Locked
                  from="startup"
                  text={t(
                    "Pregledi po danima, dodiri na poziv, poruku i mapu, i odakle ljudi dolaze.",
                  )}
                />
              )}
            </Section>
            {detailed && data.touches && (
              <Section title={t("Dodiri")}>
                <div className={styles.touches}>
                  {(
                    [
                      ["call", "phone", t("Poziv")],
                      ["message", "message", t("Poruka")],
                      ["map", "pin", t("Mapa")],
                    ] as const
                  ).map(([key, icon, label]) => (
                    <div key={key}>
                      <Icon name={icon} />
                      <strong>{numbers.format(data.touches?.[key] ?? 0)}</strong>
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
              </Section>
            )}
            {detailed && data.sources && (
              <Section title={t("Odakle dolaze")}>
                <div className={styles.sources}>
                  {(
                    [
                      ["search", t("Pretraga")],
                      ["category", t("Kategorija")],
                      ["map", t("Mapa")],
                      ["other", t("Ostalo")],
                    ] as const
                  ).map(([key, label]) => {
                    const share = totalSources
                      ? Math.round(((data.sources?.[key] ?? 0) / totalSources) * 100)
                      : 0;
                    return (
                      <div key={key}>
                        <span>{label}</span>
                        <strong>{share} %</strong>
                        <i aria-hidden="true">
                          <b style={{ width: `${share}%` }} />
                        </i>
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}
            <Section title={t("Uvidi")}>
              {full ? (
                insights.length > 0 ? (
                  <div className={styles.insights}>
                    {insights.map((item) => (
                      <p key={item.text}>
                        <Icon name={item.icon} />
                        {item.text}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className={styles.note}>
                    {t("Uvidi se pojavljuju kad se skupi dovoljno pregleda.")}
                  </p>
                )
              ) : (
                <Locked
                  from="business"
                  text={t("Uvidi po satima, poređenje s prošlim periodom i izvoz.")}
                />
              )}
            </Section>
            {full && (
              <a className={styles.export} href={csv} download>
                <Icon name="download" />
                {t("Izvezi podatke")}
              </a>
            )}
          </>
        )}
      </div>
    </>
  );
}
