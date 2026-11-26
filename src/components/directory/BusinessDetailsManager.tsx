"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  type BusinessAmenityId,
  type BusinessDetails,
  businessAmenities,
  businessTimeLabel,
  businessWeekdays,
  readBusinessDetails,
} from "../../lib/business-details";
import {
  type BusinessDetailsRequest,
  businessDetailsRequest,
} from "../../lib/business-details-client";
import {
  type HoursSpan,
  hoursNow,
  spanLabel,
  spanOfTimes,
  spanTimes,
  weekPause,
  weekSpans,
  weekWindows,
  withoutPause,
  withPause,
} from "../../lib/business-hours";
import { directoryAccessDenied } from "../../lib/directory-client";
import { DirectoryRequestError } from "../../lib/directory-create-submission";
import type { DirectoryBusiness } from "../../server/directory/types";
import { Icon } from "../Icon";
import { useT } from "../i18n/LocaleProvider";
import { RowPill } from "../ui/Rows";
import { Switch } from "../ui/Switch";
import { AmenityIcon } from "./BusinessDetails";
import styles from "./business-details.module.css";
import shared from "./directory.module.css";

type DraftSpan = { id: string; start: string; end: string };
type DraftDay = { open: boolean; spans: DraftSpan[] };
type Draft = {
  enabled: boolean;
  timezone: string;
  /** Seven days from Monday. A closed day keeps its times, so opening it again restores them. */
  days: DraftDay[];
  pause: { start: string; end: string };
  amenities: BusinessAmenityId[];
};

function draftSpans(spans: readonly HoursSpan[]): DraftSpan[] {
  return spans.map((span) => ({ id: crypto.randomUUID(), ...spanTimes(span) }));
}
/** The day's stretches, or null while one of its times is not a time. */
function daySpans(day: DraftDay): HoursSpan[] | null {
  const spans = day.spans.flatMap((span) => {
    const read = spanOfTimes(span.start, span.end);
    return read ? [read] : [];
  });
  return spans.length === day.spans.length ? spans : null;
}
function draft(details: BusinessDetails | null | undefined): Draft {
  const week = details?.hours?.length === 7 ? weekSpans(details.hours) : null;
  const pause = week ? weekPause(week) : null;
  return {
    enabled: Boolean(details?.hours),
    timezone: details?.timezone ?? "Europe/Sarajevo",
    days: Array.from({ length: 7 }, (_, index) => {
      const spans = week?.[index] ?? [];
      return spans.length
        ? { open: true, spans: draftSpans(spans) }
        : {
            // A week entered for the first time starts as working days from eight to four.
            open: !week && index < 5,
            spans: [{ id: crypto.randomUUID(), start: "08:00", end: "16:00" }],
          };
    }),
    pause: pause
      ? { start: businessTimeLabel(pause.startMinute), end: businessTimeLabel(pause.endMinute) }
      : { start: "12:00", end: "13:00" },
    amenities: [...(details?.amenities ?? [])],
  };
}
function detailsFromDraft(value: Draft): BusinessDetails {
  if (!value.enabled)
    return readBusinessDetails({ timezone: null, hours: null, amenities: value.amenities });
  const week = value.days.map((day) => {
    if (!day.open) return [];
    const spans = daySpans(day);
    if (!spans) throw new Error("INVALID_BUSINESS_DETAILS");
    return spans;
  });
  return readBusinessDetails({
    timezone: value.timezone.trim(),
    hours: weekWindows(week),
    amenities: value.amenities,
  });
}

export function BusinessDetailsManager({
  businessId,
  businessTitle,
  administrator = false,
  active,
  expectedAccountId,
  request = businessDetailsRequest,
  onChanged,
  onAccessDenied,
  onBack,
}: {
  businessId: string;
  businessTitle: string;
  administrator?: boolean;
  active: boolean;
  expectedAccountId?: string;
  request?: BusinessDetailsRequest;
  onChanged: (business: DirectoryBusiness) => void;
  onAccessDenied: (error: unknown) => boolean;
  onBack: () => void;
}) {
  const t = useT();
  const [business, setBusiness] = useState<DirectoryBusiness | null>(null);
  const [value, setValue] = useState(() => draft(null));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pauseNote, setPauseNote] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState<Date | null>(null);
  const operation = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  const id = useId();
  const denied = useRef(onAccessDenied),
    changed = useRef(onChanged);
  denied.current = onAccessDenied;
  changed.current = onChanged;
  useEffect(() => setNow(new Date()), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh explicitly requests a fresh authoritative snapshot.
  useEffect(() => {
    const generation = ++epoch.current;
    operation.current?.abort();
    setBusiness(null);
    setError("");
    setNotice("");
    setBusy(false);
    if (!active || !expectedAccountId) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    operation.current = controller;
    setLoading(true);
    request(businessId, expectedAccountId, { signal: controller.signal })
      .then((row) => {
        if (controller.signal.aborted || epoch.current !== generation) return;
        setBusiness(row);
        changed.current(row);
        setValue(draft((!administrator && row.editorialRevision?.details) || row.details));
        setUncertain(false);
      })
      .catch((failure) => {
        if (controller.signal.aborted || epoch.current !== generation) return;
        if (directoryAccessDenied(failure)) {
          denied.current(failure);
          return;
        }
        setError(t("Podaci nisu dostupni. Pokušaj ponovo."));
      })
      .finally(() => {
        if (epoch.current === generation && !controller.signal.aborted) {
          setLoading(false);
          operation.current = null;
        }
      });
    return () => {
      controller.abort();
      epoch.current++;
      operation.current?.abort();
    };
  }, [active, administrator, businessId, expectedAccountId, request, refresh]);
  async function save() {
    if (
      !business ||
      operation.current ||
      busy ||
      loading ||
      !active ||
      !expectedAccountId ||
      uncertain
    )
      return;
    let details: BusinessDetails;
    try {
      details = detailsFromDraft(value);
    } catch {
      setError(t("Provjeri vremensku zonu i satnice. Intervali se ne smiju preklapati."));
      return;
    }
    const controller = new AbortController(),
      generation = epoch.current;
    operation.current = controller;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const after = await request(businessId, expectedAccountId, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: business.version, details }),
        signal: controller.signal,
      });
      if (controller.signal.aborted || epoch.current !== generation) return;
      setBusiness(after);
      setValue(draft((!administrator && after.editorialRevision?.details) || after.details));
      changed.current(after);
      setNotice(
        after.status === "pending" || after.editorialRevision?.details
          ? t("Sačuvano i poslano na pregled.")
          : t("Promjene su sačuvane."),
      );
    } catch (failure) {
      if (controller.signal.aborted || epoch.current !== generation) return;
      if (directoryAccessDenied(failure)) {
        denied.current(failure);
        return;
      }
      if (failure instanceof DirectoryRequestError && failure.code === "REVIEW_REQUIRED") {
        setError(t("Prvo odobri ili odbij predložene izmjene u spisku djelatnosti."));
      } else if (failure instanceof DirectoryRequestError && failure.status === 400) {
        setError(t("Provjeri unesene podatke."));
      } else {
        setUncertain(true);
        setError(
          failure instanceof DirectoryRequestError && failure.code === "VERSION_CONFLICT"
            ? t("Djelatnost je izmijenjena. Učitaj sačuvane podatke prije nastavka.")
            : t("Odgovor nije potvrđen. Učitaj sačuvane podatke prije nastavka."),
        );
      }
    } finally {
      if (epoch.current === generation && !controller.signal.aborted) {
        setBusy(false);
        operation.current = null;
      }
    }
  }
  function dayChange(index: number, change: (day: DraftDay) => DraftDay) {
    setValue((current) => ({
      ...current,
      days: current.days.map((day, at) => (at === index ? change(day) : day)),
    }));
  }
  function spanChange(index: number, spanId: string, part: Partial<DraftSpan>) {
    dayChange(index, (day) => ({
      ...day,
      spans: day.spans.map((span) => (span.id === spanId ? { ...span, ...part } : span)),
    }));
  }
  /** Monday's hours on Tuesday to Friday, each with marks of its own. */
  function copyMonday() {
    setValue((current) => {
      const [monday] = current.days;
      if (!monday) return current;
      return {
        ...current,
        days: current.days.map((day, index) =>
          index >= 1 && index <= 4
            ? {
                open: monday.open,
                spans: monday.spans.map((span) => ({ ...span, id: crypto.randomUUID() })),
              }
            : day,
        ),
      };
    });
  }
  const paused = value.days.some((day) => day.open && day.spans.length > 1);
  /** The pause goes into every open day it fits into, or out of all of them. */
  function setPaused(on: boolean) {
    const pause = spanOfTimes(value.pause.start, value.pause.end);
    let fitted = false;
    const days = value.days.map((day) => {
      const spans = day.open ? daySpans(day) : null;
      if (!spans) return day;
      const [next] = on
        ? pause && !pause.nextDay
          ? withPause([spans], pause)
          : [spans]
        : withoutPause([spans]);
      if (!next || next === spans) return day;
      fitted = true;
      return { ...day, spans: draftSpans(next) };
    });
    setPauseNote(on && !fitted);
    setValue({ ...value, days });
  }
  /** New times of the pause move it in the days that have exactly that pause. */
  function pauseChange(next: Draft["pause"]) {
    const before = spanOfTimes(value.pause.start, value.pause.end);
    const after = spanOfTimes(next.start, next.end);
    const days =
      !before || !after || after.nextDay
        ? value.days
        : value.days.map((day) => {
            const spans = day.open ? daySpans(day) : null;
            const gap = spans?.length === 2 ? weekPause([spans]) : null;
            if (
              !spans ||
              !gap ||
              gap.startMinute !== before.startMinute ||
              gap.endMinute !== before.endMinute
            )
              return day;
            const [whole] = withoutPause([spans]);
            const [split] = withPause([whole ?? spans], after);
            return { ...day, spans: draftSpans(split ?? spans) };
          });
    setPauseNote(false);
    setValue({ ...value, pause: next, days });
  }

  const disabled = loading || busy || !business || business.status === "archived" || uncertain;
  // What the page will say with these hours, so a change shows before it is saved.
  let preview: BusinessDetails | null = null;
  try {
    preview = value.enabled ? detailsFromDraft(value) : null;
  } catch {
    preview = null;
  }
  const state = preview && now ? hoursNow(preview, now) : null;
  const today = state && preview?.hours ? weekSpans(preview.hours)[state.weekday - 1] : null;
  return (
    <form
      className={styles.editor}
      aria-label={t("Radno vrijeme i sadržaji")}
      aria-busy={loading || busy}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className={styles.editorBar}>
        <button
          type="button"
          className={styles.editorBack}
          onClick={onBack}
          disabled={busy}
          aria-label={t("Nazad")}
        >
          <Icon name="chevron" />
        </button>
        <h2>{t("Radno vrijeme")}</h2>
      </div>
      <p className={styles.editorNow}>
        {state && (
          <RowPill kind={state.open ? "ok" : "off"}>
            {state.open ? t("Otvoreno") : t("Zatvoreno")}
          </RowPill>
        )}
        <span>
          <bdi>{businessTitle}</bdi>
          {today &&
            ` · ${
              today.length
                ? t("danas {hours}", { hours: today.map(spanLabel).join(", ") })
                : t("danas zatvoreno")
            }`}
        </span>
      </p>
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
      {(!business || uncertain) && !loading && (
        <button
          type="button"
          className={styles.editorMinor}
          onClick={() => setRefresh((current) => current + 1)}
        >
          {t("Učitaj sačuvane podatke")}
        </button>
      )}

      <fieldset className={styles.editorCard} disabled={disabled}>
        <legend className={styles.srOnly}>{t("Radno vrijeme")}</legend>
        <div className={styles.editorRow}>
          <span className={styles.editorRowText}>
            <strong className={styles.editorRowTitle}>{t("Prikaži radno vrijeme")}</strong>
            {!value.enabled && <span>{t("Radno vrijeme se neće prikazivati.")}</span>}
          </span>
          <Switch
            checked={value.enabled}
            disabled={disabled}
            label={t("Prikaži radno vrijeme")}
            onChange={(enabled) => setValue({ ...value, enabled })}
          />
        </div>
        {value.enabled &&
          value.days.map((day, index) => {
            const name = t(businessWeekdays[index] ?? "");
            return (
              <div
                className={styles.day}
                key={businessWeekdays[index]}
                data-many={(day.open && day.spans.length > 1) || undefined}
              >
                <span className={styles.dayName}>{name}</span>
                {day.open ? (
                  <div className={styles.daySpans}>
                    {day.spans.map((span) => (
                      <div className={styles.daySpan} key={span.id}>
                        <input
                          type="time"
                          className={styles.time}
                          aria-label={t("{day}, od", { day: name })}
                          value={span.start}
                          required
                          onChange={(event) =>
                            spanChange(index, span.id, { start: event.target.value })
                          }
                        />
                        <span aria-hidden="true">–</span>
                        <input
                          type="time"
                          className={styles.time}
                          aria-label={t("{day}, do", { day: name })}
                          value={span.end}
                          required
                          onChange={(event) =>
                            spanChange(index, span.id, { end: event.target.value })
                          }
                        />
                        {day.spans.length > 1 && (
                          <button
                            type="button"
                            className={styles.spanRemove}
                            aria-label={t("Ukloni vrijeme")}
                            onClick={() =>
                              dayChange(index, (current) => ({
                                ...current,
                                spans: current.spans.filter((entry) => entry.id !== span.id),
                              }))
                            }
                          >
                            <Icon name="close" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className={styles.dayClosed}>{t("Zatvoreno")}</span>
                )}
                <Switch
                  checked={day.open}
                  disabled={disabled}
                  label={name}
                  onChange={(open) => dayChange(index, (current) => ({ ...current, open }))}
                />
              </div>
            );
          })}
      </fieldset>

      {value.enabled && (
        <>
          <button
            type="button"
            className={styles.editorMinor}
            disabled={disabled}
            onClick={copyMonday}
          >
            <Icon name="layers" />
            {t("Kopiraj ponedjeljak na radne dane")}
          </button>
          <p className={styles.editorHint}>
            {t("Ako zatvaraš poslije ponoći, upiši to vrijeme: 18:00–02:00.")}
          </p>

          <section className={styles.editorGroup}>
            <h3>{t("Pauza i vremenska zona")}</h3>
            <fieldset className={styles.editorCard} disabled={disabled}>
              <legend className={styles.srOnly}>{t("Pauza i vremenska zona")}</legend>
              <div className={styles.editorRow}>
                <Icon name="clock" />
                <span className={styles.editorRowText}>
                  <strong className={styles.editorRowTitle}>{t("Pauza u toku dana")}</strong>
                  {paused ? (
                    <span className={styles.daySpan}>
                      <input
                        type="time"
                        className={styles.time}
                        aria-label={t("Pauza od")}
                        value={value.pause.start}
                        onChange={(event) =>
                          pauseChange({ ...value.pause, start: event.target.value })
                        }
                      />
                      <span aria-hidden="true">–</span>
                      <input
                        type="time"
                        className={styles.time}
                        aria-label={t("Pauza do")}
                        value={value.pause.end}
                        onChange={(event) =>
                          pauseChange({ ...value.pause, end: event.target.value })
                        }
                      />
                    </span>
                  ) : (
                    <span>
                      {pauseNote
                        ? t("Pauza mora biti unutar radnog vremena.")
                        : t("Na primjer 12:00–13:00")}
                    </span>
                  )}
                </span>
                <Switch
                  checked={paused}
                  disabled={disabled}
                  label={t("Pauza u toku dana")}
                  onChange={setPaused}
                />
              </div>
              <label className={styles.editorRow} htmlFor={`${id}-zone`}>
                <Icon name="globe" />
                <span className={styles.editorRowText}>
                  <strong className={styles.editorRowTitle}>{t("Vremenska zona")}</strong>
                  <input
                    id={`${id}-zone`}
                    className={styles.zone}
                    value={value.timezone}
                    list={`${id}-zones`}
                    required
                    maxLength={64}
                    onChange={(event) => setValue({ ...value, timezone: event.target.value })}
                  />
                </span>
                <datalist id={`${id}-zones`}>
                  <option value="Europe/Sarajevo" />
                  <option value="Europe/Belgrade" />
                  <option value="Europe/Zagreb" />
                  <option value="Europe/Vienna" />
                  <option value="Europe/Berlin" />
                  <option value="Europe/Istanbul" />
                </datalist>
              </label>
            </fieldset>
          </section>
        </>
      )}

      <section className={styles.editorGroup}>
        <h3>{t("Sadržaji i pogodnosti")}</h3>
        <fieldset className={styles.editorCard} disabled={disabled}>
          <legend className={styles.srOnly}>{t("Sadržaji i pogodnosti")}</legend>
          {businessAmenities.map((entry) => (
            <div className={styles.editorRow} key={entry.id}>
              <AmenityIcon id={entry.id} />
              <span className={styles.editorRowText}>
                <strong className={styles.editorRowTitle}>{t(entry.label)}</strong>
              </span>
              <Switch
                checked={value.amenities.includes(entry.id)}
                disabled={disabled}
                label={t(entry.label)}
                onChange={(on) =>
                  setValue({
                    ...value,
                    amenities: on
                      ? [...value.amenities, entry.id]
                      : value.amenities.filter((item) => item !== entry.id),
                  })
                }
              />
            </div>
          ))}
        </fieldset>
      </section>

      <button type="submit" className={styles.editorSave} disabled={disabled}>
        {t("Sačuvaj")}
      </button>
    </form>
  );
}
