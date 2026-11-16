"use client";

import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type BookingAction,
  type BookingEntry,
  type BookingServiceInput,
  type BookingSettings,
  type BookingSettingsInput,
  bookingDate,
  bookingMoney,
  bookingMonth,
  bookingStatusLabels,
} from "../../lib/booking";
import {
  BookingRequestError,
  bookingAccessDenied,
  bookingActorRequest,
  bookingError,
  bookingRequest,
  bookingWrite,
} from "../../lib/booking-client";
import { addDays, dateKey, isTimeZone, localInstant } from "../../lib/booking-time";
import { Icon } from "../Icon";
import styles from "./booking.module.css";

type Props = {
  businessId: string;
  businessTitle: string;
  preview?: boolean;
  onBack?: () => void;
  request?: typeof bookingRequest;
  expectedAccountId?: string;
  active?: boolean;
  onAccessDenied?: (failure: unknown) => void;
};
type WindowDraft = { key: string; weekday: number; start: string; end: string };
type ServiceDraft = {
  key: string;
  id?: string;
  name: string;
  duration: string;
  price: string;
  active: boolean;
};
type Draft = {
  enabled: boolean;
  timezone: string;
  windows: WindowDraft[];
  services: ServiceDraft[];
};
type CreateBody = {
  kind: "manual" | "block";
  configurationVersion: number;
  serviceId?: string;
  startsAt: string;
  endsAt?: string;
  clientName?: string;
  clientPhone?: string;
};
type Intent = { id: string; body: CreateBody; uncertain: boolean };
const weekdays = ["Ponedjeljak", "Utorak", "Srijeda", "Četvrtak", "Petak", "Subota", "Nedjelja"];
const zones = [
  "Europe/Sarajevo",
  "Europe/Zagreb",
  "Europe/Belgrade",
  "Europe/Vienna",
  "Europe/Berlin",
  "Europe/Istanbul",
  "UTC",
];
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown, min: number, max: number): value is number =>
  Number.isInteger(value) && Number(value) >= min && Number(value) <= max;
const minuteText = (value: number) =>
  `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
function minuteValue(value: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(value)) return null;
  const [hour = "", minute = ""] = value.split(":");
  const h = Number(hour),
    m = Number(minute);
  return h >= 0 && h <= 24 && m >= 0 && m < 60 && (h < 24 || m === 0) ? h * 60 + m : null;
}
function minorValue(value: string): number | null {
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(value.trim())) return null;
  const [whole = "", fraction = ""] = value.trim().replace(",", ".").split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(amount) && amount >= 0 && amount <= 10000000 ? amount : null;
}
function readSettings(value: unknown): BookingSettings {
  if (
    !record(value) ||
    typeof value.enabled !== "boolean" ||
    !isTimeZone(value.timezone) ||
    !integer(value.version, 0, 2147483646) ||
    !Array.isArray(value.windows) ||
    value.windows.length > 28 ||
    !Array.isArray(value.services) ||
    value.services.length > 20
  )
    throw new Error("invalid_settings");
  for (const window of value.windows) {
    if (
      !record(window) ||
      !integer(window.weekday, 1, 7) ||
      !integer(window.startMinute, 0, 1439) ||
      !integer(window.endMinute, 1, 1440) ||
      window.endMinute <= window.startMinute
    )
      throw new Error("invalid_window");
  }
  for (const service of value.services) {
    if (
      !record(service) ||
      typeof service.id !== "string" ||
      !service.id ||
      typeof service.name !== "string" ||
      !service.name.trim() ||
      !integer(service.durationMinutes, 15, 240) ||
      service.durationMinutes % 5 !== 0 ||
      !integer(service.priceMinor, 0, 10000000) ||
      typeof service.active !== "boolean"
    )
      throw new Error("invalid_service");
  }
  if (new Set(value.services.map((item) => item.id)).size !== value.services.length)
    throw new Error("duplicate_service");
  return value as BookingSettings;
}
function readEntry(value: unknown, businessId: string): BookingEntry {
  if (
    !record(value) ||
    typeof value.id !== "string" ||
    !value.id ||
    value.businessId !== businessId ||
    typeof value.businessTitle !== "string" ||
    !["customer", "manual", "block"].includes(String(value.kind)) ||
    !["requested", "confirmed", "cancelled", "completed", "declined"].includes(
      String(value.status),
    ) ||
    !integer(value.version, 1, 2147483646) ||
    !integer(value.priceMinor, 0, 10000000) ||
    typeof value.startsAt !== "string" ||
    typeof value.endsAt !== "string" ||
    !isTimeZone(value.timezone) ||
    !Number.isFinite(Date.parse(value.startsAt)) ||
    !Number.isFinite(Date.parse(value.endsAt)) ||
    Date.parse(value.endsAt) <= Date.parse(value.startsAt)
  )
    throw new Error("invalid_entry");
  for (const key of [
    "serviceId",
    "serviceName",
    "customerId",
    "clientName",
    "clientEmail",
    "clientPhone",
  ]) {
    if (value[key] !== null && typeof value[key] !== "string") throw new Error("invalid_entry");
  }
  if (value.durationMinutes !== null && !integer(value.durationMinutes, 15, 240))
    throw new Error("invalid_entry");
  return value as BookingEntry;
}
function toDraft(settings: BookingSettings): Draft {
  return {
    enabled: settings.enabled,
    timezone: settings.timezone,
    windows: settings.windows.map((window, index) => ({
      key: `saved-window-${index}`,
      weekday: window.weekday,
      start: minuteText(window.startMinute),
      end: minuteText(window.endMinute),
    })),
    services: settings.services.map((service) => ({
      key: service.id,
      id: service.id,
      name: service.name,
      duration: String(service.durationMinutes),
      price: `${Math.floor(service.priceMinor / 100)},${String(service.priceMinor % 100).padStart(2, "0")}`,
      active: service.active,
    })),
  };
}
function settingsBody(draft: Draft, version: number): BookingSettingsInput {
  if (!isTimeZone(draft.timezone) || draft.services.length > 20 || draft.windows.length > 28)
    throw new Error("Provjeri postavke.");
  const windows = draft.windows
    .map((window) => {
      const startMinute = minuteValue(window.start),
        endMinute = minuteValue(window.end);
      if (
        startMinute === null ||
        endMinute === null ||
        startMinute >= endMinute ||
        startMinute >= 1440
      )
        throw new Error("Unesi ispravno vrijeme otvaranja i zatvaranja.");
      return { weekday: window.weekday, startMinute, endMinute };
    })
    .sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute);
  for (let index = 1; index < windows.length; index++) {
    const previous = windows[index - 1],
      next = windows[index];
    if (
      previous &&
      next &&
      previous.weekday === next.weekday &&
      next.startMinute < previous.endMinute
    )
      throw new Error("Intervali istog dana se ne smiju preklapati.");
  }
  const services: BookingServiceInput[] = draft.services.map((service) => {
    const durationMinutes = /^\d+$/.test(service.duration) ? Number(service.duration) : NaN;
    const priceMinor = minorValue(service.price);
    if (
      !service.name.trim() ||
      !integer(durationMinutes, 15, 240) ||
      durationMinutes % 5 !== 0 ||
      priceMinor === null
    )
      throw new Error("Provjeri naziv, trajanje i cijenu usluge.");
    return {
      ...(service.id ? { id: service.id } : {}),
      name: service.name.trim(),
      durationMinutes,
      priceMinor,
      active: service.active,
    };
  });
  return {
    expectedVersion: version,
    enabled: draft.enabled,
    timezone: draft.timezone,
    windows,
    services,
  };
}
function sameSettings(settings: BookingSettings, body: BookingSettingsInput) {
  if (
    settings.enabled !== body.enabled ||
    settings.timezone !== body.timezone ||
    settings.windows.length !== body.windows.length ||
    settings.services.length !== body.services.length
  )
    return false;
  const windows = (rows: BookingSettings["windows"]) =>
    rows
      .map((row) => `${row.weekday}:${row.startMinute}:${row.endMinute}`)
      .sort()
      .join("|");
  if (windows(settings.windows) !== windows(body.windows)) return false;
  const available = [...settings.services];
  for (const input of body.services) {
    const index = available.findIndex(
      (row) =>
        (!input.id || row.id === input.id) &&
        row.name === input.name &&
        row.durationMinutes === input.durationMinutes &&
        row.priceMinor === input.priceMinor &&
        row.active === input.active,
    );
    if (index < 0) return false;
    available.splice(index, 1);
  }
  return true;
}
function nextMonth(month: string, change: number) {
  const date = new Date(`${month}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + change);
  return `${date.toISOString().slice(0, 7)}-01`;
}
function covers(entry: BookingEntry, day: string, timezone: string) {
  return (
    day >= dateKey(new Date(entry.startsAt), timezone) &&
    day <= dateKey(new Date(Date.parse(entry.endsAt) - 1), timezone)
  );
}
function entryTime(entry: BookingEntry) {
  const formatter = new Intl.DateTimeFormat("en-GB-u-nu-latn", {
    timeZone: entry.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${formatter.format(new Date(entry.startsAt))} – ${formatter.format(new Date(entry.endsAt))}`;
}

export function BusinessBookingManager(props: Props) {
  return (
    <BookingWorkspace
      key={`${props.businessId}:${props.expectedAccountId ?? "unavailable"}`}
      {...props}
    />
  );
}

function BookingWorkspace({
  businessId,
  businessTitle,
  preview = false,
  onBack,
  request,
  expectedAccountId,
  active = true,
  onAccessDenied,
}: Props) {
  const api = useMemo(
    () =>
      preview && !request
        ? null
        : bookingActorRequest(expectedAccountId, request ?? bookingRequest),
    [expectedAccountId, preview, request],
  );
  const [settings, setSettings] = useState<BookingSettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsBlocked, setSettingsBlocked] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [entries, setEntries] = useState<BookingEntry[] | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarError, setCalendarError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [kind, setKind] = useState<"manual" | "block">("manual");
  const [createDate, setCreateDate] = useState("");
  const [start, setStart] = useState("");
  const [endDate, setEndDate] = useState("");
  const [end, setEnd] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [createError, setCreateError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [createSettingsBlocked, setCreateSettingsBlocked] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [requiresLogin, setRequiresLogin] = useState(false);
  const live = useRef(false),
    authority = useRef(0),
    writing = useRef(false),
    settingsEpoch = useRef(0),
    calendarEpoch = useRef(0);
  const settingsRead = useRef<AbortController | null>(null),
    calendarRead = useRef<AbortController | null>(null),
    writeController = useRef<AbortController | null>(null);
  const intent = useRef<Intent | null>(null),
    sequence = useRef(0);
  const writeEpoch = useRef(new WeakMap<AbortController, number>()),
    deniedCallback = useRef(onAccessDenied),
    settingsValue = useRef(settings),
    previousApi = useRef(api);
  deniedCallback.current = onAccessDenied;
  settingsValue.current = settings;
  const path = `mine/businesses/${encodeURIComponent(businessId)}`;
  const timezone = settings?.timezone ?? "Europe/Sarajevo";

  const clearPrivate = useCallback((failure?: unknown, preserveRecovery = true) => {
    const command = intent.current;
    const recovery =
      preserveRecovery && command && (command.uncertain || writing.current)
        ? { ...command, uncertain: true }
        : null;
    authority.current++;
    settingsEpoch.current++;
    calendarEpoch.current++;
    settingsRead.current?.abort();
    calendarRead.current?.abort();
    writeController.current?.abort();
    writeController.current = null;
    writing.current = false;
    intent.current = recovery;
    settingsValue.current = null;
    setSettings(null);
    setDraft(null);
    setEntries(null);
    setCredits(null);
    setClientName("");
    setClientPhone("");
    setServiceId("");
    setStart("");
    setEnd("");
    setNotice("");
    setBusy(null);
    setSettingsLoading(false);
    setCalendarLoading(false);
    setCalendarError("");
    setCreateError("");
    setSettingsOpen(false);
    setCreating(Boolean(recovery));
    setUncertain(Boolean(recovery));
    setRequiresLogin(Boolean(failure));
    setSettingsError(failure ? bookingError(failure) : "");
    if (failure) deniedCallback.current?.(failure);
  }, []);

  const loadSettings = useCallback(
    async (replaceDraft: boolean) => {
      if (!api) {
        setSettingsError("Probni kalendar nije povezan.");
        setSettingsLoading(false);
        return;
      }
      settingsRead.current?.abort();
      const controller = new AbortController(),
        generation = authority.current,
        epoch = ++settingsEpoch.current;
      settingsRead.current = controller;
      setSettingsLoading(true);
      try {
        const data = await api(`${path}/settings`, { signal: controller.signal });
        if (
          !live.current ||
          generation !== authority.current ||
          controller.signal.aborted ||
          epoch !== settingsEpoch.current
        )
          return;
        const value = readSettings(data.settings);
        setSettings(value);
        setRequiresLogin(false);
        setCreateSettingsBlocked(false);
        if (replaceDraft) {
          setDraft(toDraft(value));
          setSettingsBlocked(false);
          setSettingsError("");
        }
        const today = dateKey(new Date(), value.timezone);
        setMonth((current) => current || `${today.slice(0, 7)}-01`);
        setDay((current) => current || today);
      } catch (failure) {
        if (!live.current || generation !== authority.current) return;
        if (bookingAccessDenied(failure)) {
          clearPrivate(failure);
          return;
        }
        if (!controller.signal.aborted && epoch === settingsEpoch.current)
          setSettingsError(bookingError(failure));
      } finally {
        if (live.current && generation === authority.current && epoch === settingsEpoch.current)
          setSettingsLoading(false);
      }
    },
    [api, path, clearPrivate],
  );

  const loadCalendar = useCallback(
    async (message = "") => {
      if (!api || !month || !isTimeZone(timezone)) return;
      calendarRead.current?.abort();
      const controller = new AbortController(),
        generation = authority.current,
        epoch = ++calendarEpoch.current;
      calendarRead.current = controller;
      setCalendarLoading(true);
      setCalendarError(message);
      setEntries(null);
      try {
        const from = localInstant(month, 0, timezone);
        const to = localInstant(nextMonth(month, 1), 0, timezone);
        if (!from || !to) throw new Error("invalid_month_boundary");
        const data = await api(`${path}/calendar?${new URLSearchParams({ from, to })}`, {
          signal: controller.signal,
        });
        if (
          !live.current ||
          generation !== authority.current ||
          controller.signal.aborted ||
          epoch !== calendarEpoch.current
        )
          return;
        if (
          !Array.isArray(data.entries) ||
          !integer(data.earnedCredits, 0, Number.MAX_SAFE_INTEGER)
        )
          throw new Error("invalid_calendar");
        const rows = data.entries.map((row: unknown) => readEntry(row, businessId));
        if (new Set(rows.map((row: BookingEntry) => row.id)).size !== rows.length)
          throw new Error("duplicate_entry");
        setEntries(rows);
        setCredits(data.earnedCredits);
      } catch (failure) {
        if (!live.current || generation !== authority.current) return;
        if (bookingAccessDenied(failure)) {
          clearPrivate(failure);
          return;
        }
        if (!controller.signal.aborted && epoch === calendarEpoch.current)
          setCalendarError([message, bookingError(failure)].filter(Boolean).join(" "));
      } finally {
        if (live.current && generation === authority.current && epoch === calendarEpoch.current)
          setCalendarLoading(false);
      }
    },
    [api, month, timezone, path, businessId, clearPrivate],
  );

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      authority.current++;
      settingsEpoch.current++;
      calendarEpoch.current++;
      settingsRead.current?.abort();
      calendarRead.current?.abort();
      writeController.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (previousApi.current !== api) {
      previousApi.current = api;
      clearPrivate(undefined, false);
    }
  }, [api, clearPrivate]);
  useEffect(() => {
    if (active && !settingsValue.current) void loadSettings(true);
    if (!active) setSettingsLoading(false);
    return () => {
      settingsEpoch.current++;
      settingsRead.current?.abort();
    };
  }, [active, loadSettings]);
  useEffect(() => {
    if (active && settings) void loadCalendar();
    if (!active) setCalendarLoading(false);
    return () => {
      calendarEpoch.current++;
      calendarRead.current?.abort();
    };
  }, [active, loadCalendar, settings]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  function beginWrite(label: string) {
    if (writing.current || !api || requiresLogin || !active) return null;
    writing.current = true;
    calendarEpoch.current++;
    calendarRead.current?.abort();
    setCalendarLoading(false);
    const controller = new AbortController();
    writeEpoch.current.set(controller, authority.current);
    writeController.current = controller;
    setBusy(label);
    setNotice("");
    return controller;
  }
  function currentWrite(controller: AbortController) {
    return (
      live.current &&
      writeEpoch.current.get(controller) === authority.current &&
      !controller.signal.aborted
    );
  }
  function endWrite(controller: AbortController) {
    if (writeController.current !== controller) return;
    writing.current = false;
    if (live.current) setBusy(null);
  }
  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings || !draft || settingsBlocked || uncertain) return;
    let body: BookingSettingsInput;
    try {
      body = settingsBody(draft, settings.version);
    } catch (failure) {
      setSettingsError(failure instanceof Error ? failure.message : "Provjeri postavke.");
      return;
    }
    const controller = beginWrite("settings");
    if (!controller || !api) return;
    setSettingsError("");
    try {
      const data = await api(`${path}/settings`, {
        ...bookingWrite("PATCH", body),
        signal: controller.signal,
      });
      if (!currentWrite(controller)) return;
      const value = readSettings(data.settings);
      if (value.version <= body.expectedVersion || !sameSettings(value, body))
        throw new Error("invalid_settings_ack");
      setSettings(value);
      setDraft(toDraft(value));
      setNotice("Postavke termina su sačuvane.");
    } catch (failure) {
      if (!live.current || writeEpoch.current.get(controller) !== authority.current) return;
      if (bookingAccessDenied(failure)) {
        clearPrivate(failure);
        return;
      }
      if (!controller.signal.aborted) {
        const stale = failure instanceof BookingRequestError && failure.status === 409;
        setSettingsError(bookingError(failure));
        if (
          stale ||
          !(failure instanceof BookingRequestError) ||
          failure.status === 408 ||
          failure.status >= 500
        ) {
          setSettingsBlocked(true);
          await loadSettings(false);
        }
      }
    } finally {
      endWrite(controller);
    }
  }
  async function changeEntry(entry: BookingEntry, action: BookingAction) {
    if (uncertain || calendarLoading) return;
    const controller = beginWrite(entry.id);
    if (!controller || !api) return;
    let message = "";
    try {
      const data = await api(`entries/${encodeURIComponent(entry.id)}/action`, {
        ...bookingWrite("POST", { expectedVersion: entry.version, action }),
        signal: controller.signal,
      });
      if (!currentWrite(controller)) return;
      const value = readEntry(data.entry, businessId);
      const expected = {
        approve: "confirmed",
        decline: "declined",
        cancel: "cancelled",
        complete: "completed",
      }[action];
      if (value.id !== entry.id || value.status !== expected || value.version <= entry.version)
        throw new Error("invalid_entry_ack");
      setNotice(
        action === "complete"
          ? "Termin je označen kao održan."
          : action === "approve"
            ? "Termin je potvrđen."
            : action === "decline"
              ? "Zahtjev je odbijen."
              : "Termin je otkazan.",
      );
    } catch (failure) {
      if (!live.current || writeEpoch.current.get(controller) !== authority.current) return;
      if (bookingAccessDenied(failure)) {
        clearPrivate(failure);
        return;
      }
      if (!controller.signal.aborted) message = bookingError(failure);
    } finally {
      endWrite(controller);
      if (currentWrite(controller)) void loadCalendar(message);
    }
  }
  async function sendCreate(value: Intent) {
    const controller = beginWrite("create");
    if (!controller || !api) return;
    setCreateError("");
    let refresh = false;
    try {
      const data = await api(`${path}/entries`, {
        ...bookingWrite("POST", value.body, value.id),
        signal: controller.signal,
      });
      if (!currentWrite(controller)) return;
      const entry = readEntry(data.entry, businessId);
      if (
        entry.kind !== value.body.kind ||
        Date.parse(entry.startsAt) !== Date.parse(value.body.startsAt) ||
        (value.body.kind === "manual" && entry.serviceId !== value.body.serviceId) ||
        (value.body.kind === "block" &&
          Date.parse(entry.endsAt) !== Date.parse(value.body.endsAt ?? ""))
      )
        throw new Error("invalid_create_ack");
      intent.current = null;
      setUncertain(false);
      setCreating(false);
      setNotice(
        entry.status === "confirmed"
          ? entry.kind === "block"
            ? "Vrijeme je označeno kao zauzeto."
            : "Ručni termin je sačuvan."
          : `Unos je evidentiran. Aktuelni status: ${bookingStatusLabels[entry.status].toLocaleLowerCase("bs-BA")}.`,
      );
      const selected = dateKey(new Date(entry.startsAt), timezone),
        targetMonth = `${selected.slice(0, 7)}-01`;
      setDay(selected);
      setMonth(targetMonth);
      refresh = targetMonth === month;
    } catch (failure) {
      if (!live.current || writeEpoch.current.get(controller) !== authority.current) return;
      if (bookingAccessDenied(failure)) {
        // A first definite denial did not write; a denial after an unknown attempt cannot prove that.
        if (!value.uncertain) intent.current = null;
        clearPrivate(failure);
        return;
      }
      if (!controller.signal.aborted) {
        const known =
          failure instanceof BookingRequestError &&
          failure.status >= 400 &&
          failure.status < 500 &&
          failure.status !== 408 &&
          !value.uncertain;
        if (known) {
          intent.current = null;
          setUncertain(false);
          setCreateError(bookingError(failure));
          if (
            failure.code === "BOOKING_CONFIGURATION_CHANGED" ||
            failure.code === "BOOKING_SERVICE_NOT_FOUND"
          ) {
            setCreateSettingsBlocked(true);
            setSettingsBlocked(true);
            setServiceId("");
            setStart("");
            setEnd("");
            await loadSettings(false);
          }
          refresh = true;
        } else {
          value.uncertain = true;
          setUncertain(true);
          setCreateError(
            "Odgovor nije stigao. Unos može biti sačuvan. Ponovi isti unos da provjeriš rezultat.",
          );
        }
      }
    } finally {
      endWrite(controller);
      if (refresh && currentWrite(controller)) void loadCalendar();
    }
  }
  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings || writing.current || uncertain || settingsLoading || createSettingsBlocked)
      return;
    const minute = minuteValue(start),
      startsAt =
        minute !== null && minute < 1440 ? localInstant(createDate, minute, timezone) : null;
    if (!startsAt) {
      setCreateError("Izabrano lokalno vrijeme nije dostupno. Odaberi drugo vrijeme.");
      return;
    }
    if (
      Date.parse(startsAt) <= Date.now() ||
      createDate > addDays(dateKey(new Date(), timezone), 90)
    ) {
      setCreateError("Odaberi budući termin unutar narednih 90 dana.");
      return;
    }
    const body: CreateBody = { kind, startsAt, configurationVersion: settings.version };
    if (kind === "manual") {
      if (!settings.services.some((service) => service.id === serviceId && service.active)) {
        setCreateError("Izaberi dostupnu uslugu.");
        return;
      }
      body.serviceId = serviceId;
      if (clientName.trim()) body.clientName = clientName.trim();
      if (clientPhone.trim()) body.clientPhone = clientPhone.trim();
    } else {
      const endMinute = minuteValue(end);
      let endsAt: string | null = null;
      try {
        endsAt =
          endMinute === null
            ? null
            : localInstant(
                endMinute === 1440 ? addDays(endDate, 1) : endDate,
                endMinute === 1440 ? 0 : endMinute,
                timezone,
              );
      } catch {
        /* Invalid civil date stays a form error. */
      }
      if (
        !endsAt ||
        Date.parse(endsAt) <= Date.parse(startsAt) ||
        Date.parse(endsAt) - Date.parse(startsAt) > 31 * 86400000
      ) {
        setCreateError("Provjeri kraj zauzeća. Interval može trajati najviše 31 dan.");
        return;
      }
      body.endsAt = endsAt;
    }
    const value = { id: crypto.randomUUID(), body, uncertain: false };
    intent.current = value;
    void sendCreate(value);
  }

  const today = dateKey(new Date(now), timezone);
  const activeServices = settings?.services.filter((service) => service.active) ?? [];
  const ready = settings?.enabled && activeServices.length > 0 && settings.windows.length > 0;
  const selectedEntries = (entries ?? [])
    .filter((entry) => day && covers(entry, day, timezone))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const gridStart = month
    ? addDays(month, -((new Date(`${month}T12:00:00Z`).getUTCDay() + 6) % 7))
    : "";
  const dates = gridStart
    ? Array.from({ length: 42 }, (_, index) => addDays(gridStart, index))
    : [];
  const allZones = draft && !zones.includes(draft.timezone) ? [draft.timezone, ...zones] : zones;

  return (
    <section className={styles.workspace} aria-labelledby="business-booking-title">
      <header className={styles.header}>
        <div>
          {onBack && (
            <button
              className={styles.back}
              type="button"
              disabled={busy !== null || uncertain}
              onClick={onBack}
            >
              <Icon name="arrow" />
              Djelatnosti
            </button>
          )}
          {!requiresLogin && <p className={styles.eyebrow}>{businessTitle}</p>}
          <h1 id="business-booking-title">Termini</h1>
        </div>
        <button
          className={styles.secondary}
          type="button"
          disabled={requiresLogin}
          onClick={() => setSettingsOpen(!settingsOpen)}
        >
          <Icon name="sliders" />
          {settingsOpen ? "Zatvori postavke" : "Usluge i raspored"}
        </button>
      </header>
      {preview && (
        <p className={styles.previewNote}>
          Probni kalendar. Nijedan unos se ne šalje stvarnoj djelatnosti.
        </p>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {settingsError && (
        <p className={styles.error} role="alert">
          {settingsError}
        </p>
      )}
      {requiresLogin && (
        <Link
          className={styles.secondary}
          href="/prijava?nastavi=%2Fnalog%3Fodjeljak%3Ddjelatnosti"
          target={uncertain ? "_blank" : undefined}
          rel={uncertain ? "noopener" : undefined}
        >
          Prijavi se
        </Link>
      )}
      {settingsLoading && (
        <p className={styles.loading} role="status">
          Dohvaćanje postavki…
        </p>
      )}
      {!settings && !settingsLoading && (
        <button type="button" className={styles.secondary} onClick={() => void loadSettings(true)}>
          Pokušaj ponovo
        </button>
      )}
      {settings && (
        <div className={styles.summary}>
          <span className={styles.onlineState} data-enabled={Boolean(ready)}>
            <span />
            {ready
              ? "Online booking je uključen"
              : settings.enabled
                ? "Booking čeka uslugu i raspored"
                : "Online booking je isključen"}
          </span>
          <span>{timezone}</span>
          {credits !== null && (
            <span>
              Krediti kroz booking: <strong>{credits}</strong>
            </span>
          )}
        </div>
      )}

      {settingsOpen && draft && (
        <form className={styles.settings} onSubmit={saveSettings}>
          <div className={styles.cardHeading}>
            <div>
              <h2>Usluge i radno vrijeme</h2>
              <p>Booking postane dostupan nakon usluge i rasporeda.</p>
            </div>
            <label className={styles.switch}>
              <input
                type="checkbox"
                checked={draft.enabled}
                disabled={busy !== null || settingsBlocked}
                onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
              />
              <span />
              Online booking
            </label>
          </div>
          <fieldset disabled={busy !== null || settingsBlocked}>
            <label className={styles.field}>
              Vremenska zona
              <select
                value={draft.timezone}
                onChange={(event) => setDraft({ ...draft, timezone: event.target.value })}
              >
                {allZones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </label>
            <div className={styles.subheading}>
              <h3>Usluge</h3>
              <button
                className={styles.textButton}
                type="button"
                disabled={draft.services.length >= 20}
                onClick={() =>
                  setDraft({
                    ...draft,
                    services: [
                      ...draft.services,
                      {
                        key: `new-service-${++sequence.current}`,
                        name: "",
                        duration: "",
                        price: "",
                        active: true,
                      },
                    ],
                  })
                }
              >
                + Dodaj uslugu
              </button>
            </div>
            {draft.services.length === 0 && <p className={styles.help}>Još nema usluga.</p>}
            <div className={styles.services}>
              {draft.services.map((service) => (
                <div className={styles.service} key={service.key}>
                  <label className={styles.field}>
                    Naziv
                    <input
                      required
                      maxLength={120}
                      value={service.name}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          services: draft.services.map((item) =>
                            item.key === service.key ? { ...item, name: event.target.value } : item,
                          ),
                        })
                      }
                    />
                  </label>
                  <label className={styles.field}>
                    Trajanje · min
                    <input
                      type="number"
                      min={15}
                      max={240}
                      step={5}
                      required
                      value={service.duration}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          services: draft.services.map((item) =>
                            item.key === service.key
                              ? { ...item, duration: event.target.value }
                              : item,
                          ),
                        })
                      }
                    />
                  </label>
                  <label className={styles.field}>
                    Cijena · KM
                    <input
                      inputMode="decimal"
                      required
                      value={service.price}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          services: draft.services.map((item) =>
                            item.key === service.key
                              ? { ...item, price: event.target.value }
                              : item,
                          ),
                        })
                      }
                    />
                  </label>
                  <div className={styles.serviceState}>
                    <label>
                      <input
                        type="checkbox"
                        checked={service.active}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            services: draft.services.map((item) =>
                              item.key === service.key
                                ? { ...item, active: event.target.checked }
                                : item,
                            ),
                          })
                        }
                      />
                      Dostupna
                    </label>
                    {!service.id && (
                      <button
                        type="button"
                        className={styles.textButton}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            services: draft.services.filter((item) => item.key !== service.key),
                          })
                        }
                      >
                        Ukloni
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className={styles.subheading}>
              <h3>Sedmični raspored</h3>
            </div>
            <div className={styles.week}>
              {weekdays.map((label, index) => {
                const rows = draft.windows.filter((window) => window.weekday === index + 1);
                return (
                  <div className={styles.weekday} key={label}>
                    <label className={styles.daySwitch}>
                      <input
                        type="checkbox"
                        checked={rows.length > 0}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            windows: event.target.checked
                              ? [
                                  ...draft.windows,
                                  {
                                    key: `new-window-${++sequence.current}`,
                                    weekday: index + 1,
                                    start: "",
                                    end: "",
                                  },
                                ]
                              : draft.windows.filter((window) => window.weekday !== index + 1),
                          })
                        }
                      />
                      {label}
                    </label>
                    {rows.length ? (
                      <div className={styles.windows}>
                        {rows.map((window) => (
                          <div key={window.key}>
                            <input
                              aria-label={`${label} od`}
                              type="time"
                              step={60}
                              required
                              value={window.start}
                              onChange={(event) =>
                                setDraft({
                                  ...draft,
                                  windows: draft.windows.map((item) =>
                                    item.key === window.key
                                      ? { ...item, start: event.target.value }
                                      : item,
                                  ),
                                })
                              }
                            />
                            <span>–</span>
                            <input
                              aria-label={`${label} do`}
                              type="text"
                              inputMode="numeric"
                              placeholder="HH:MM"
                              pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]|24:00"
                              maxLength={5}
                              required
                              value={window.end}
                              onChange={(event) =>
                                setDraft({
                                  ...draft,
                                  windows: draft.windows.map((item) =>
                                    item.key === window.key
                                      ? { ...item, end: event.target.value }
                                      : item,
                                  ),
                                })
                              }
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className={styles.closed}>Zatvoreno</span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className={styles.formActions}>
              <button className={styles.primary} type="submit" disabled={uncertain}>
                {busy === "settings" ? "Spremanje…" : "Sačuvaj postavke"}
                <Icon name="check" />
              </button>
              <button
                type="button"
                className={styles.textButton}
                onClick={() => settings && setDraft(toDraft(settings))}
              >
                Vrati sačuvano
              </button>
            </div>
          </fieldset>
          {settingsBlocked && (
            <div className={styles.conflict}>
              <p>
                Učitaj aktuelne postavke prije novog spremanja. Tvoj unos je i dalje prikazan iznad.
              </p>
              <button
                type="button"
                className={styles.secondary}
                disabled={settingsLoading || busy !== null}
                onClick={() => void loadSettings(true)}
              >
                Učitaj sačuvane postavke
              </button>
            </div>
          )}
        </form>
      )}

      {settings && month && (
        <div className={styles.calendarLayout}>
          <section className={styles.calendar} aria-label="Mjesečni kalendar">
            <div className={styles.monthHeading}>
              <button
                type="button"
                aria-label="Prethodni mjesec"
                disabled={busy !== null}
                onClick={() => {
                  const next = nextMonth(month, -1);
                  setMonth(next);
                  setDay(next);
                }}
              >
                <Icon name="chevron" />
              </button>
              <h2>{bookingMonth(month.slice(0, 7))}</h2>
              <button
                type="button"
                aria-label="Sljedeći mjesec"
                disabled={busy !== null}
                onClick={() => {
                  const next = nextMonth(month, 1);
                  setMonth(next);
                  setDay(next);
                }}
              >
                <Icon name="chevron" />
              </button>
            </div>
            <div className={styles.dayNames} aria-hidden="true">
              {["P", "U", "S", "Č", "P", "S", "N"].map((label, index) => (
                <span key={weekdays[index]}>{label}</span>
              ))}
            </div>
            <div className={styles.days}>
              {dates.map((date) => (
                <button
                  key={date}
                  type="button"
                  disabled={busy !== null}
                  aria-label={bookingDate(`${date}T12:00:00Z`, "UTC")}
                  aria-pressed={day === date}
                  data-outside={date.slice(0, 7) !== month.slice(0, 7)}
                  data-today={date === today}
                  onClick={() => {
                    setDay(date);
                    if (date.slice(0, 7) !== month.slice(0, 7)) setMonth(`${date.slice(0, 7)}-01`);
                  }}
                >
                  {Number(date.slice(-2))}
                  {entries?.some(
                    (entry) =>
                      covers(entry, date, timezone) &&
                      !["cancelled", "declined"].includes(entry.status),
                  ) && <span className={styles.dayDot} />}
                </button>
              ))}
            </div>
            <button
              className={styles.today}
              type="button"
              disabled={busy !== null}
              onClick={() => {
                setMonth(`${today.slice(0, 7)}-01`);
                setDay(today);
              }}
            >
              Danas
            </button>
            <p className={styles.calendarLegend}>
              <span />
              Dan s unesenim terminom
            </p>
          </section>

          <section className={styles.dayPanel} aria-labelledby="booking-day-heading">
            <div className={styles.cardHeading}>
              <div>
                <span className={styles.eyebrow}>ODABRANI DAN</span>
                <h2 id="booking-day-heading">{bookingDate(`${day}T12:00:00Z`, "UTC")}</h2>
              </div>
              <div className={styles.actions}>
                <button
                  className={styles.secondary}
                  type="button"
                  disabled={busy !== null || calendarLoading}
                  onClick={() => void loadCalendar()}
                >
                  Osvježi
                </button>
                <button
                  className={styles.primary}
                  type="button"
                  disabled={busy !== null || uncertain || settingsLoading}
                  onClick={() => {
                    setCreating(!creating);
                    setCreateDate(day);
                    setEndDate(day);
                    setCreateError("");
                  }}
                >
                  + Dodaj
                </button>
              </div>
            </div>
            {calendarError && (
              <p className={styles.error} role="alert">
                {calendarError}
              </p>
            )}

            {creating && (
              <form className={styles.createForm} onSubmit={submitCreate}>
                <div className={styles.cardHeading}>
                  <h3>Novi unos</h3>
                  {!uncertain && (
                    <button
                      type="button"
                      className={styles.textButton}
                      disabled={busy !== null}
                      onClick={() => setCreating(false)}
                    >
                      Zatvori
                    </button>
                  )}
                </div>
                <fieldset
                  disabled={busy !== null || uncertain || settingsLoading || createSettingsBlocked}
                >
                  <label className={styles.field}>
                    Vrsta
                    <select
                      value={kind}
                      onChange={(event) =>
                        setKind(event.target.value === "block" ? "block" : "manual")
                      }
                    >
                      <option value="manual">Termin telefonom / ručni unos</option>
                      <option value="block">Zauzeto vrijeme</option>
                    </select>
                  </label>
                  <div className={styles.twoColumns}>
                    <label className={styles.field}>
                      Datum
                      <input
                        type="date"
                        required
                        value={createDate}
                        min={today}
                        max={addDays(today, 90)}
                        onChange={(event) => setCreateDate(event.target.value)}
                      />
                    </label>
                    <label className={styles.field}>
                      Početak
                      <input
                        type="time"
                        step={60}
                        required
                        value={start}
                        onChange={(event) => setStart(event.target.value)}
                      />
                    </label>
                  </div>
                  {kind === "manual" ? (
                    <>
                      <label className={styles.field}>
                        Usluga
                        <select
                          required
                          value={serviceId}
                          onChange={(event) => setServiceId(event.target.value)}
                        >
                          <option value="">Izaberi uslugu</option>
                          {activeServices.map((service) => (
                            <option key={service.id} value={service.id}>
                              {service.name} · {service.durationMinutes} min ·{" "}
                              {bookingMoney(service.priceMinor)}
                            </option>
                          ))}
                        </select>
                      </label>
                      {activeServices.length === 0 && (
                        <p className={styles.help}>Prvo dodaj dostupnu uslugu u postavkama.</p>
                      )}
                      <div className={styles.twoColumns}>
                        <label className={styles.field}>
                          Ime klijenta · opcionalno
                          <input
                            maxLength={120}
                            value={clientName}
                            onChange={(event) => setClientName(event.target.value)}
                          />
                        </label>
                        <label className={styles.field}>
                          Telefon · opcionalno
                          <input
                            type="tel"
                            maxLength={40}
                            value={clientPhone}
                            onChange={(event) => setClientPhone(event.target.value)}
                          />
                        </label>
                      </div>
                    </>
                  ) : (
                    <div className={styles.twoColumns}>
                      <label className={styles.field}>
                        Datum završetka
                        <input
                          type="date"
                          required
                          min={createDate || today}
                          max={addDays(today, 90)}
                          value={endDate}
                          onChange={(event) => setEndDate(event.target.value)}
                        />
                      </label>
                      <label className={styles.field}>
                        Kraj
                        <input
                          type="time"
                          step={60}
                          required
                          value={end}
                          onChange={(event) => setEnd(event.target.value)}
                        />
                      </label>
                    </div>
                  )}
                  <button
                    className={styles.primary}
                    type="submit"
                    disabled={kind === "manual" && activeServices.length === 0}
                  >
                    {busy === "create"
                      ? "Spremanje…"
                      : kind === "block"
                        ? "Označi kao zauzeto"
                        : "Sačuvaj ručni termin"}
                  </button>
                </fieldset>
                {createError && (
                  <p className={styles.error} role="alert">
                    {createError}
                  </p>
                )}
                {createSettingsBlocked && !settingsLoading && (
                  <button
                    className={styles.secondary}
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void loadSettings(false)}
                  >
                    Osvježi usluge
                  </button>
                )}
                {uncertain && (
                  <button
                    className={styles.secondary}
                    type="button"
                    disabled={busy !== null}
                    onClick={() => intent.current && void sendCreate(intent.current)}
                  >
                    Ponovi isti unos
                  </button>
                )}
                <p className={styles.help}>
                  Vrijeme: {timezone}. Ručni unosi i blokade ne donose booking kredite.
                </p>
              </form>
            )}

            {calendarLoading && (
              <p className={styles.loading} role="status">
                Dohvaćanje termina…
              </p>
            )}
            {!calendarLoading && entries && selectedEntries.length === 0 && (
              <div className={styles.empty}>
                <Icon name="calendar" />
                <h3>Nema unesenih termina.</h3>
                <p>Ručni termin ili zauzeće možeš dodati iznad.</p>
              </div>
            )}
            <div className={styles.entries}>
              {selectedEntries.map((entry) => (
                <article
                  key={entry.id}
                  data-closed={["cancelled", "declined"].includes(entry.status)}
                >
                  <div className={styles.entryTime}>
                    <Icon name={entry.kind === "block" ? "pause" : "clock"} />
                    <strong>{entryTime(entry)}</strong>
                    {entry.timezone !== timezone && <small>{entry.timezone}</small>}
                  </div>
                  <div className={styles.entryDetails}>
                    <div className={styles.entryTitle}>
                      <h3>
                        {entry.kind === "block"
                          ? "Zauzeto vrijeme"
                          : (entry.serviceName ?? "Termin")}
                      </h3>
                      <span data-status={entry.status}>{bookingStatusLabels[entry.status]}</span>
                    </div>
                    <p>
                      {entry.kind === "customer"
                        ? "Online zahtjev"
                        : entry.kind === "manual"
                          ? "Ručni termin"
                          : "Blokada kalendara"}
                      {entry.durationMinutes !== null && ` · ${entry.durationMinutes} min`}
                      {entry.kind !== "block" && ` · ${bookingMoney(entry.priceMinor)}`}
                    </p>
                    {[entry.clientName, entry.clientPhone, entry.clientEmail].some(Boolean) && (
                      <p className={styles.client}>
                        {[entry.clientName, entry.clientPhone, entry.clientEmail]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                    <div className={styles.entryActions}>
                      {entry.status === "requested" && (
                        <>
                          {Date.parse(entry.startsAt) > now && (
                            <button
                              type="button"
                              className={styles.primary}
                              disabled={busy !== null || uncertain}
                              onClick={() => void changeEntry(entry, "approve")}
                            >
                              Odobri
                            </button>
                          )}
                          <button
                            type="button"
                            className={styles.secondary}
                            disabled={busy !== null || uncertain}
                            onClick={() => void changeEntry(entry, "decline")}
                          >
                            Odbij
                          </button>
                        </>
                      )}
                      {entry.status === "confirmed" && (
                        <>
                          <button
                            type="button"
                            className={styles.secondary}
                            disabled={busy !== null || uncertain}
                            onClick={() => void changeEntry(entry, "cancel")}
                          >
                            {entry.kind === "block" ? "Ukloni blokadu" : "Otkaži"}
                          </button>
                          {entry.kind !== "block" && Date.parse(entry.endsAt) <= now && (
                            <button
                              type="button"
                              className={styles.primary}
                              disabled={busy !== null || uncertain}
                              onClick={() => void changeEntry(entry, "complete")}
                            >
                              Označi održan
                              <Icon name="check" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
