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
import { directoryAccessDenied } from "../../lib/directory-client";
import { DirectoryRequestError } from "../../lib/directory-create-submission";
import type { DirectoryBusiness } from "../../server/directory/types";
import { Icon } from "../Icon";
import styles from "./business-details.module.css";
import shared from "./directory.module.css";

type Draft = {
  enabled: boolean;
  timezone: string;
  days: { id: string; start: string; end: string }[][];
  amenities: BusinessAmenityId[];
};
function draft(details: BusinessDetails | null | undefined): Draft {
  return {
    enabled: Boolean(details?.hours),
    timezone: details?.timezone ?? "Europe/Sarajevo",
    days: Array.from(
      { length: 7 },
      (_, index) =>
        details?.hours?.[index]?.windows.map((window) => ({
          start: businessTimeLabel(window.startMinute),
          end: businessTimeLabel(window.endMinute),
          id: crypto.randomUUID(),
        })) ?? [],
    ),
    amenities: [...(details?.amenities ?? [])],
  };
}
function minutes(value: string): number {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) && value !== "24:00") return -1;
  const [hour, minute] = value.split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}
function detailsFromDraft(value: Draft): BusinessDetails {
  return readBusinessDetails({
    timezone: value.enabled ? value.timezone.trim() : null,
    hours: value.enabled
      ? value.days.map((windows, index) => ({
          weekday: index + 1,
          windows: windows
            .map((window) => ({
              startMinute: minutes(window.start),
              endMinute: minutes(window.end),
            }))
            .sort((a, b) => a.startMinute - b.startMinute),
        }))
      : null,
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
  const [business, setBusiness] = useState<DirectoryBusiness | null>(null);
  const [value, setValue] = useState(() => draft(null));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const operation = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  const id = useId();
  const denied = useRef(onAccessDenied),
    changed = useRef(onChanged);
  denied.current = onAccessDenied;
  changed.current = onChanged;
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
        setError("Podaci nisu dostupni. Pokušaj ponovo.");
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
      setError("Provjeri vremensku zonu i satnice. Intervali se ne smiju preklapati.");
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
          ? "Sačuvano i poslano na pregled."
          : "Promjene su sačuvane.",
      );
    } catch (failure) {
      if (controller.signal.aborted || epoch.current !== generation) return;
      if (directoryAccessDenied(failure)) {
        denied.current(failure);
        return;
      }
      if (failure instanceof DirectoryRequestError && failure.code === "REVIEW_REQUIRED") {
        setError("Prvo odobri ili odbij predložene izmjene u spisku djelatnosti.");
      } else if (failure instanceof DirectoryRequestError && failure.status === 400) {
        setError("Provjeri unesene podatke.");
      } else {
        setUncertain(true);
        setError(
          failure instanceof DirectoryRequestError && failure.code === "VERSION_CONFLICT"
            ? "Djelatnost je izmijenjena. Učitaj sačuvane podatke prije nastavka."
            : "Odgovor nije potvrđen. Učitaj sačuvane podatke prije nastavka.",
        );
      }
    } finally {
      if (epoch.current === generation && !controller.signal.aborted) {
        setBusy(false);
        operation.current = null;
      }
    }
  }
  function dayChange(day: number, windows: Draft["days"][number]) {
    setValue((current) => ({
      ...current,
      days: current.days.map((entry, index) => (index === day ? windows : entry)),
    }));
  }
  const disabled = loading || busy || !business || business.status === "archived" || uncertain;
  return (
    <form
      className={styles.editor}
      aria-label="Radno vrijeme i sadržaji"
      aria-busy={loading || busy}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className={styles.editorHeader}>
        <div>
          <h2>Radno vrijeme i sadržaji</h2>
          <p>{businessTitle}</p>
        </div>
        <button type="button" className={shared.secondary} onClick={onBack} disabled={busy}>
          Nazad
        </button>
      </div>
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
          className={shared.secondary}
          onClick={() => setRefresh((current) => current + 1)}
        >
          Učitaj sačuvane podatke
        </button>
      )}
      <fieldset className={styles.panel} disabled={disabled}>
        <legend>Radno vrijeme</legend>
        <label className={styles.switch}>
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(event) => setValue({ ...value, enabled: event.target.checked })}
          />
          Prikaži radno vrijeme
        </label>
        {value.enabled ? (
          <>
            <label className={styles.timezone} htmlFor={`${id}-zone`}>
              Vremenska zona
              <input
                id={`${id}-zone`}
                value={value.timezone}
                list={`${id}-zones`}
                required
                maxLength={64}
                onChange={(event) => setValue({ ...value, timezone: event.target.value })}
              />
              <datalist id={`${id}-zones`}>
                <option value="Europe/Sarajevo" />
                <option value="Europe/Belgrade" />
                <option value="Europe/Zagreb" />
                <option value="Europe/Vienna" />
                <option value="Europe/Berlin" />
                <option value="Europe/Istanbul" />
              </datalist>
            </label>
            <p className={styles.hint}>
              Za rad preko ponoći dodaj vrijeme u oba dana, npr. do 24:00 i od 00:00.
            </p>
            <div className={styles.week}>
              {value.days.map((windows, day) => (
                <div className={styles.day} key={businessWeekdays[day]}>
                  <strong>{businessWeekdays[day]}</strong>
                  <div className={styles.dayBody}>
                    {!windows.length && <small>Zatvoreno</small>}
                    {windows.map((window, index) => (
                      <div className={styles.window} key={window.id}>
                        <input
                          aria-label={`${businessWeekdays[day]}, interval ${index + 1}, od`}
                          value={window.start}
                          maxLength={5}
                          placeholder="09:00"
                          required
                          onChange={(event) =>
                            dayChange(
                              day,
                              windows.map((entry, slot) =>
                                slot === index ? { ...entry, start: event.target.value } : entry,
                              ),
                            )
                          }
                        />
                        <span>–</span>
                        <input
                          aria-label={`${businessWeekdays[day]}, interval ${index + 1}, do`}
                          value={window.end}
                          maxLength={5}
                          placeholder="17:00"
                          required
                          onChange={(event) =>
                            dayChange(
                              day,
                              windows.map((entry, slot) =>
                                slot === index ? { ...entry, end: event.target.value } : entry,
                              ),
                            )
                          }
                        />
                        <button
                          type="button"
                          aria-label={`Ukloni interval ${index + 1}, ${businessWeekdays[day]}`}
                          onClick={() =>
                            dayChange(
                              day,
                              windows.filter((_, slot) => slot !== index),
                            )
                          }
                        >
                          <Icon name="close" />
                        </button>
                      </div>
                    ))}
                    {windows.length < 4 && (
                      <button
                        type="button"
                        className={styles.addWindow}
                        onClick={() =>
                          dayChange(day, [
                            ...windows,
                            { id: crypto.randomUUID(), start: "09:00", end: "17:00" },
                          ])
                        }
                      >
                        + Dodaj vrijeme
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className={styles.hint}>Radno vrijeme se neće prikazivati.</p>
        )}
      </fieldset>
      <fieldset className={styles.panel} disabled={disabled}>
        <legend>Sadržaji i pogodnosti</legend>
        <div className={styles.choices}>
          {businessAmenities.map((entry) => (
            <label key={entry.id} className={styles.amenityChoice}>
              <input
                type="checkbox"
                checked={value.amenities.includes(entry.id)}
                onChange={(event) =>
                  setValue({
                    ...value,
                    amenities: event.target.checked
                      ? [...value.amenities, entry.id]
                      : value.amenities.filter((id) => id !== entry.id),
                  })
                }
              />
              {entry.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className={styles.actions}>
        <button type="submit" className={shared.primary} disabled={disabled}>
          Sačuvaj promjene
        </button>
      </div>
    </form>
  );
}
