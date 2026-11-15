"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BookingSettings } from "../../lib/booking";
import {
  bookingActorRequest,
  bookingError,
  bookingRequest,
  bookingWrite,
} from "../../lib/booking-client";
import { isTimeZone } from "../../lib/booking-time";
import {
  type BusinessMediaAsset,
  type BusinessMediaManifest,
  businessMediaUrl,
} from "../../lib/business-media";
import { businessMediaRequest } from "../../lib/business-media-client";
import {
  type DirectoryRequest,
  directoryAccessDenied,
  directoryActorRequest,
  directoryRequest,
} from "../../lib/directory-client";
import {
  createDirectoryCreation,
  type DirectoryCreateIntent,
  DirectoryRequestError as RequestError,
} from "../../lib/directory-create-submission";
import type { DirectoryBusiness } from "../../server/directory/types";
import { BusinessBookingManager } from "../booking/BusinessBookingManager";
import { Icon } from "../Icon";
import { BusinessEditor, type BusinessFields, type CategoryOption } from "./BusinessEditor";
import { BusinessMediaManager } from "./BusinessMediaManager";
import mediaStyles from "./business-media.module.css";
import styles from "./directory.module.css";

const statuses = {
  draft: "Nacrt",
  pending: "Na pregledu",
  published: "Objavljeno",
  archived: "Arhivirano",
};
function errorMessage(error: unknown) {
  const code = error instanceof RequestError ? error.code : "";
  if (code === "BUSINESS_LIMIT_REACHED") return "Tvoj nalog je dosegao broj djelatnosti u paketu.";
  if (code === "VERSION_CONFLICT")
    return "Djelatnost je u međuvremenu izmijenjena. Otvori je ponovo.";
  if (code === "IDEMPOTENCY_CONFLICT")
    return "Ovaj zahtjev je već poslan. Osvježi spisak i provjeri sačuvanu djelatnost.";
  if (code === "AUTHENTICATION_REQUIRED" || code === "ACCOUNT_SUSPENDED")
    return "Prijava je istekla. Prijavi se ponovo.";
  if (code === "ACCOUNT_IDENTITY_CHANGED") return "Prijavi se ponovo svojim nalogom.";
  if (code === "INVALID_DIRECTORY_INPUT") return "Provjeri unesene podatke.";
  return "Zahtjev nije uspio. Pokušaj ponovo.";
}
function write(method: string, body: unknown, requestId?: string): RequestInit {
  return {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(requestId ? { "Idempotency-Key": requestId } : {}),
    },
    body: JSON.stringify(body),
  };
}
function readBookingSettings(value: unknown): BookingSettings {
  if (!value || typeof value !== "object") throw new Error("invalid_booking_settings");
  const row = value as BookingSettings;
  if (
    typeof row.enabled !== "boolean" ||
    !isTimeZone(row.timezone) ||
    !Number.isInteger(row.version) ||
    row.version < 0 ||
    row.version > 2147483646 ||
    !Array.isArray(row.windows) ||
    row.windows.length > 28 ||
    !Array.isArray(row.services) ||
    row.services.length > 20
  )
    throw new Error("invalid_booking_settings");
  for (const window of row.windows) {
    if (
      !window ||
      !Number.isInteger(window.weekday) ||
      window.weekday < 1 ||
      window.weekday > 7 ||
      !Number.isInteger(window.startMinute) ||
      !Number.isInteger(window.endMinute) ||
      window.startMinute < 0 ||
      window.endMinute > 1440 ||
      window.startMinute >= window.endMinute
    )
      throw new Error("invalid_booking_window");
  }
  for (const service of row.services) {
    if (
      !service ||
      typeof service.id !== "string" ||
      !service.id ||
      typeof service.name !== "string" ||
      !service.name.trim() ||
      typeof service.active !== "boolean" ||
      !Number.isInteger(service.durationMinutes) ||
      service.durationMinutes < 15 ||
      service.durationMinutes > 240 ||
      service.durationMinutes % 5 !== 0 ||
      !Number.isInteger(service.priceMinor) ||
      service.priceMinor < 0 ||
      service.priceMinor > 10000000
    )
      throw new Error("invalid_booking_service");
  }
  if (new Set(row.services.map((service) => service.id)).size !== row.services.length)
    throw new Error("duplicate_booking_service");
  return row;
}

export function BusinessManager({
  active,
  isOwner,
  initialAll = false,
  embedded = false,
  expectedAccountId,
  request: directoryApi = directoryRequest,
  bookingApi = bookingRequest,
  mediaApi = businessMediaRequest,
  mediaImageUrl = businessMediaUrl,
}: {
  active: boolean;
  isOwner: boolean;
  initialAll?: boolean;
  embedded?: boolean;
  expectedAccountId?: string;
  request?: DirectoryRequest;
  bookingApi?: typeof bookingRequest;
  mediaApi?: typeof businessMediaRequest;
  mediaImageUrl?: (id: string, asset: BusinessMediaAsset, area: "mine" | "public") => string | null;
}) {
  const [items, setItems] = useState<DirectoryBusiness[] | null>(null);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [editing, setEditing] = useState<DirectoryBusiness | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [all, setAll] = useState(initialAll && isOwner);
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [bookingBusiness, setBookingBusiness] = useState<Pick<
    DirectoryBusiness,
    "id" | "title"
  > | null>(null);
  const [mediaBusiness, setMediaBusiness] = useState<Pick<
    DirectoryBusiness,
    "id" | "title"
  > | null>(null);
  const [pendingCreate, setPendingCreate] = useState<DirectoryCreateIntent | null>(null);
  const [loginRequired, setLoginRequired] = useState(false);
  const [bookingOption, setBookingOption] = useState<{ id: string; enabled: boolean } | null>(null);
  const [bookingNote, setBookingNote] = useState("");
  const [bookingLoading, setBookingLoading] = useState(false);
  const reads = useRef(0);
  const bookingReads = useRef(0);
  const writing = useRef<AbortController | null>(null);
  const creation = useRef(createDirectoryCreation());
  const loadedSelection = useRef("");
  const live = useRef(false);
  const epoch = useRef(0);
  const boundary = useRef({ expectedAccountId, directoryApi, bookingApi, mediaApi, isOwner });
  const currentBoundary = useRef(boundary.current);
  currentBoundary.current = { expectedAccountId, directoryApi, bookingApi, mediaApi, isOwner };
  const current = useCallback(
    (access: number) => {
      const value = currentBoundary.current;
      return (
        live.current &&
        epoch.current === access &&
        value.expectedAccountId === expectedAccountId &&
        value.directoryApi === directoryApi &&
        value.bookingApi === bookingApi &&
        value.mediaApi === mediaApi &&
        value.isOwner === isOwner
      );
    },
    [expectedAccountId, directoryApi, bookingApi, mediaApi, isOwner],
  );
  const request = useMemo(
    () => directoryActorRequest(expectedAccountId, directoryApi),
    [expectedAccountId, directoryApi],
  );
  const booking = useMemo(
    () => bookingActorRequest(expectedAccountId, bookingApi),
    [expectedAccountId, bookingApi],
  );
  const clearPrivate = useCallback((preserveCreation = false) => {
    if (preserveCreation) creation.current.retainUncertain();
    epoch.current++;
    reads.current++;
    bookingReads.current++;
    writing.current?.abort();
    writing.current = null;
    loadedSelection.current = "";
    setItems(null);
    setCategories([]);
    setHasMore(false);
    setEditing(undefined);
    // An unknown child command must keep its mounted recovery state, without a private title.
    setBookingBusiness((current) =>
      preserveCreation && current ? { id: current.id, title: "Booking" } : null,
    );
    setMediaBusiness((current) =>
      preserveCreation && current ? { id: current.id, title: "Fotografije" } : null,
    );
    setBookingOption(null);
    setBookingNote("");
    setBookingLoading(false);
    setNotice("");
    setBusy(false);
    setLoading(false);
    setReadError("");
    if (!preserveCreation) creation.current = createDirectoryCreation();
    setPendingCreate(creation.current.intent);
  }, []);
  const denied = useCallback(
    (failure: unknown) => {
      if (!directoryAccessDenied(failure)) return false;
      clearPrivate(true);
      setLoginRequired(true);
      setError("Prijavi se ponovo svojim nalogom.");
      return true;
    },
    [clearPrivate],
  );
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      epoch.current++;
      reads.current++;
      bookingReads.current++;
      writing.current?.abort();
    };
  }, []);
  useEffect(() => {
    const previous = boundary.current;
    if (
      previous.expectedAccountId !== expectedAccountId ||
      previous.directoryApi !== directoryApi ||
      previous.bookingApi !== bookingApi ||
      previous.mediaApi !== mediaApi ||
      previous.isOwner !== isOwner
    ) {
      boundary.current = { expectedAccountId, directoryApi, bookingApi, mediaApi, isOwner };
      clearPrivate();
      setAll(initialAll && isOwner);
      setPage(1);
      setError("");
      setLoginRequired(false);
    }
  }, [expectedAccountId, directoryApi, bookingApi, mediaApi, isOwner, initialAll, clearPrivate]);
  const editingId = editing?.id;
  const locked = busy || pendingCreate !== null;
  // A dispatched command keeps its result and lock while another account section is visible.
  // Only a changed actor/transport/role or unmount invalidates that private workspace.
  useEffect(() => {
    const revision = ++bookingReads.current;
    const access = epoch.current;
    setBookingOption(null);
    setBookingLoading(false);
    if (!active || !editingId) return;
    const controller = new AbortController();
    setBookingLoading(true);
    void booking(`mine/businesses/${encodeURIComponent(editingId)}/settings`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (!current(access) || controller.signal.aborted || revision !== bookingReads.current)
          return;
        const settings = readBookingSettings(data.settings);
        setBookingOption({ id: editingId, enabled: settings.enabled });
      })
      .catch((failure) => {
        if (!current(access)) return;
        if (denied(failure)) return;
        if (current(access) && !controller.signal.aborted && revision === bookingReads.current)
          setBookingNote("Booking postavke nisu učitane. Ostaju nepromijenjene.");
      })
      .finally(() => {
        if (!controller.signal.aborted && revision === bookingReads.current)
          setBookingLoading(false);
      });
    return () => controller.abort();
  }, [active, editingId, booking, denied, current]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh explicitly invalidates the fetched list after writes and on request.
  useEffect(() => {
    if (!active || bookingBusiness || mediaBusiness) return;
    const controller = new AbortController(),
      revision = ++reads.current;
    const access = epoch.current;
    setReadError("");
    const suffix = `?page=${page}${archived ? "&status=archived" : ""}`;
    const selection = `${all && isOwner ? "admin" : "mine"}${suffix}`;
    const cached = loadedSelection.current === selection && items !== null;
    setLoading(!cached);
    if (!cached) setItems(null);
    Promise.all([
      request(`${all && isOwner ? "admin" : "mine"}${suffix}`, { signal: controller.signal }),
      request("categories", { signal: controller.signal }),
    ])
      .then(([list, taxonomy]) => {
        if (!current(access) || controller.signal.aborted || revision !== reads.current) return;
        if (
          !Array.isArray(list.items) ||
          !Array.isArray(taxonomy.categories) ||
          typeof list.hasMore !== "boolean"
        )
          throw new RequestError("UNAVAILABLE");
        setItems(list.items);
        setHasMore(list.hasMore);
        setCategories(taxonomy.categories);
        loadedSelection.current = selection;
        setLoginRequired(false);
      })
      .catch((error) => {
        if (!current(access)) return;
        if (denied(error)) return;
        if (!controller.signal.aborted && revision === reads.current) {
          if (!cached || (error instanceof RequestError && [401, 403].includes(error.status))) {
            setItems(null);
            loadedSelection.current = "";
          }
          setReadError(errorMessage(error));
        }
      })
      .finally(() => {
        if (current(access) && !controller.signal.aborted && revision === reads.current)
          setLoading(false);
      });
    return () => controller.abort();
  }, [
    active,
    refresh,
    all,
    archived,
    isOwner,
    page,
    bookingBusiness,
    mediaBusiness,
    request,
    denied,
    current,
  ]);

  async function updateBookingFlag(
    business: DirectoryBusiness,
    enabled: boolean,
    wasNew: boolean,
    controller: AbortController,
    access: number,
  ) {
    try {
      if (!current(access) || controller.signal.aborted) return;
      const bookingPath = `mine/businesses/${encodeURIComponent(business.id)}/settings`;
      const fresh = await booking(bookingPath, { signal: controller.signal });
      if (!current(access) || controller.signal.aborted) return;
      const before = readBookingSettings(fresh.settings);
      if (before.enabled !== enabled) {
        const body = {
          expectedVersion: before.version,
          enabled,
          timezone: before.timezone,
          windows: before.windows.map(({ weekday, startMinute, endMinute }) => ({
            weekday,
            startMinute,
            endMinute,
          })),
          services: before.services.map(({ id, name, durationMinutes, priceMinor, active }) => ({
            id,
            name,
            durationMinutes,
            priceMinor,
            active,
          })),
        };
        const changed = await booking(bookingPath, {
          ...bookingWrite("PATCH", body),
          signal: controller.signal,
        });
        if (!current(access) || controller.signal.aborted) return;
        const after = readBookingSettings(changed.settings);
        const configuration = (value: BookingSettings) =>
          JSON.stringify({
            timezone: value.timezone,
            windows: value.windows
              .map(
                ({ weekday, startMinute, endMinute }) => `${weekday}:${startMinute}:${endMinute}`,
              )
              .sort(),
            services: value.services
              .map(({ id, name, durationMinutes, priceMinor, active }) =>
                JSON.stringify([id, name, durationMinutes, priceMinor, active]),
              )
              .sort(),
          });
        if (
          after.enabled !== enabled ||
          after.version <= before.version ||
          configuration(after) !== configuration(before)
        )
          throw new Error("invalid_booking_ack");
      }
      if (wasNew && enabled) setBookingBusiness(business);
    } catch (failure) {
      if (!current(access)) return;
      if (!controller.signal.aborted && denied(failure)) return;
      if (!controller.signal.aborted)
        setBookingNote(
          `Podaci djelatnosti su sačuvani. Promjena bookinga nije potvrđena. ${bookingError(failure)} Otvori Booking i provjeri postavke.`,
        );
    }
  }
  async function save(fields: BusinessFields, publish: boolean, replay?: DirectoryCreateIntent) {
    if (
      writing.current ||
      !active ||
      (creation.current.intent && !replay) ||
      (replay && replay !== creation.current.intent)
    )
      return;
    const editingBusiness = replay ? null : editing;
    if (replay) {
      fields = replay.fields;
      publish = replay.publish;
    }
    const controller = new AbortController();
    const access = epoch.current;
    writing.current = controller;
    const call = async (path: string, options: RequestInit = {}) => {
      const result = await request(path, { ...options, signal: controller.signal });
      if (!current(access) || controller.signal.aborted) throw new Error("aborted");
      return result;
    };
    const { bookingEnabled, ...directoryFields } = fields;
    const wasNew = !editingBusiness;
    const updateBooking =
      typeof bookingEnabled === "boolean" &&
      (wasNew
        ? bookingEnabled
        : bookingOption?.id === editingBusiness?.id && bookingOption.enabled !== bookingEnabled);
    setBusy(true);
    setError("");
    setNotice("");
    setBookingNote("");
    setLoginRequired(false);
    reads.current++;
    let committed: DirectoryBusiness | null = null;
    try {
      const intent = editingBusiness ? null : (replay ?? creation.current.begin(fields, publish));
      if (intent) {
        setPendingCreate(intent);
      }
      const data = editingBusiness
        ? await call(
            `mine/${editingBusiness.id}`,
            write("PATCH", { ...directoryFields, expectedVersion: editingBusiness.version }),
          )
        : {
            business: await creation.current.send(intent as DirectoryCreateIntent, (options) =>
              call("mine", options),
            ),
          };
      if (!data.business?.id || !Number.isInteger(data.business.version))
        throw new RequestError("UNAVAILABLE");
      let business = data.business as DirectoryBusiness;
      committed = business;
      setEditing(business);
      setPendingCreate(null);
      if (publish && isOwner && business.status !== "published") {
        const published = await call(
          `mine/${business.id}/publish`,
          write("POST", { expectedVersion: business.version }),
        );
        if (published.business?.id !== business.id || published.business?.status !== "published")
          throw new RequestError("UNAVAILABLE");
        business = published.business;
      }
      setNotice(
        business.status === "published"
          ? "Djelatnost je objavljena."
          : business.status === "pending"
            ? "Izmjene su poslane na pregled."
            : "Nacrt je sačuvan.",
      );
      setEditing(undefined);
    } catch (error) {
      if (!current(access) || controller.signal.aborted) return;
      if (denied(error)) return;
      if (committed) {
        try {
          const latest = await call(`mine/${committed.id}`);
          if (latest.business?.id !== committed.id || !Number.isInteger(latest.business.version))
            throw new RequestError("UNAVAILABLE");
          if (latest.business.status === "published") {
            setNotice("Djelatnost je objavljena.");
            setEditing(undefined);
          } else {
            setEditing(latest.business);
            setError("Podaci su sačuvani. Objava nije potvrđena.");
          }
        } catch (failure) {
          if (!current(access) || controller.signal.aborted) return;
          if (denied(failure)) return;
          setEditing(undefined);
          setError("Podaci su sačuvani. Osvježi spisak radi provjere objave.");
        }
      } else {
        setPendingCreate(creation.current.intent);
        setLoginRequired(error instanceof RequestError && error.status === 401);
        setError(
          creation.current.intent
            ? "Ishod unosa nije potvrđen. Ponovi isti unos da provjerimo sačuvanu djelatnost."
            : errorMessage(error),
        );
      }
    } finally {
      if (
        committed &&
        updateBooking &&
        typeof bookingEnabled === "boolean" &&
        current(access) &&
        !controller.signal.aborted
      )
        await updateBookingFlag(committed, bookingEnabled, wasNew, controller, access);
      if (writing.current === controller) {
        writing.current = null;
        if (current(access) && !controller.signal.aborted) {
          setBusy(false);
          setRefresh((value) => value + 1);
        }
      }
    }
  }
  async function move(item: DirectoryBusiness, action: "publish" | "archive" | "recover") {
    if (writing.current || !active || creation.current.intent) return;
    const controller = new AbortController();
    const access = epoch.current;
    writing.current = controller;
    setBusy(true);
    setError("");
    setNotice("");
    reads.current++;
    try {
      const data = await request(`mine/${item.id}/${action}`, {
        ...write("POST", { expectedVersion: item.version }),
        signal: controller.signal,
      });
      if (!current(access) || controller.signal.aborted) return;
      if (data.business?.id !== item.id) throw new RequestError("UNAVAILABLE");
      setNotice(
        action === "archive"
          ? "Djelatnost je arhivirana."
          : action === "recover"
            ? "Djelatnost je vraćena u nacrte."
            : isOwner
              ? "Djelatnost je objavljena."
              : "Djelatnost je poslana na pregled.",
      );
    } catch (error) {
      if (!current(access)) return;
      if (!controller.signal.aborted && denied(error)) return;
      if (!controller.signal.aborted) setError(errorMessage(error));
    } finally {
      if (writing.current === controller) {
        writing.current = null;
        if (current(access) && !controller.signal.aborted) {
          setBusy(false);
          setRefresh((value) => value + 1);
        }
      }
    }
  }
  function mediaChanged(manifest: BusinessMediaManifest) {
    const patch = {
      version: manifest.businessVersion,
      status: manifest.status,
      media: { logo: manifest.logo, cover: manifest.cover, gallery: manifest.gallery },
    };
    setItems(
      (current) =>
        current?.map((row) => (row.id === manifest.businessId ? { ...row, ...patch } : row)) ??
        current,
    );
    setMediaBusiness((current) =>
      current?.id === manifest.businessId ? { ...current, ...patch } : current,
    );
    setEditing((current) =>
      current?.id === manifest.businessId ? { ...current, ...patch } : current,
    );
  }
  if (mediaBusiness)
    return (
      <BusinessMediaManager
        key={mediaBusiness.id}
        businessId={mediaBusiness.id}
        businessTitle={mediaBusiness.title}
        active={active}
        expectedAccountId={expectedAccountId}
        request={mediaApi}
        imageUrl={mediaImageUrl}
        onAccessDenied={denied}
        onChanged={mediaChanged}
        onBack={() => {
          setMediaBusiness(null);
          setRefresh((value) => value + 1);
        }}
      />
    );
  if (bookingBusiness) {
    return (
      <div className={styles.workspace}>
        {notice && (
          <p className={styles.notice} role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <BusinessBookingManager
          active={active}
          expectedAccountId={expectedAccountId}
          request={bookingApi}
          onAccessDenied={denied}
          businessId={bookingBusiness.id}
          businessTitle={bookingBusiness.title}
          onBack={() => {
            setBookingBusiness(null);
            setRefresh((value) => value + 1);
          }}
        />
      </div>
    );
  }
  return (
    <div className={styles.workspace} aria-busy={busy || loading}>
      <div className={styles.header}>
        {!embedded && (
          <div>
            <h1>{all && isOwner ? "Sve djelatnosti" : "Moje djelatnosti"}</h1>
            <p>Predstavi, uredi i objavi svoj posao.</p>
          </div>
        )}
        {editing === undefined && (
          <button
            type="button"
            className={styles.primary}
            disabled={locked || loading || categories.length === 0}
            onClick={() => {
              if (creation.current.intent) return;
              setEditing(null);
              setError("");
              setNotice("");
              setBookingNote("");
            }}
          >
            <Icon name="shop" />
            Dodaj djelatnost
          </button>
        )}
      </div>
      {(error || readError) && (
        <p role="alert" className={styles.error}>
          {error || readError}
        </p>
      )}
      {loginRequired && !busy && (
        <div className={styles.notice}>
          <Link
            className={styles.secondary}
            href="/prijava?nastavi=%2Fnalog%3Fodjeljak%3Ddjelatnosti"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Obnovi prijavu u novoj kartici"
          >
            Obnovi prijavu
          </Link>
        </div>
      )}
      {pendingCreate && !busy && (
        <div className={styles.notice} role="status">
          <p>Prethodni unos još nije potvrđen.</p>
          <button
            type="button"
            className={styles.primary}
            disabled={!active}
            onClick={() => void save(pendingCreate.fields, pendingCreate.publish, pendingCreate)}
          >
            Ponovi isti unos
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
      {bookingNote && (
        <p role="alert" className={styles.notice}>
          {bookingNote}
        </p>
      )}
      {bookingLoading && <p role="status">Dohvaćanje booking postavki…</p>}
      {editing !== undefined ? (
        <BusinessEditor
          key={editing?.id ?? "new"}
          initial={editing ?? undefined}
          categories={categories}
          busy={locked}
          canPublish={isOwner}
          currentStatus={editing?.status}
          bookingEnabled={
            editing ? (bookingOption?.id === editing.id ? bookingOption.enabled : undefined) : false
          }
          onSave={save}
          onCancel={() => {
            if (creation.current.intent) return;
            setEditing(undefined);
            setError("");
            setBookingNote("");
          }}
        />
      ) : (
        <>
          <div className={styles.toolbar}>
            <div className={styles.filters}>
              {isOwner && (
                <label>
                  <input
                    type="checkbox"
                    checked={all}
                    disabled={locked || loading}
                    onChange={(event) => {
                      setAll(event.target.checked);
                      setPage(1);
                    }}
                  />
                  Sve djelatnosti
                </label>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={archived}
                  disabled={locked || loading}
                  onChange={(event) => {
                    setArchived(event.target.checked);
                    setPage(1);
                  }}
                />
                Arhivirane
              </label>
            </div>
            <button
              type="button"
              className={styles.cancel}
              disabled={locked || loading}
              onClick={() => {
                setError("");
                setRefresh((value) => value + 1);
              }}
            >
              Osvježi
            </button>
          </div>
          {!items && !error && !readError && <p role="status">Dohvaćanje djelatnosti…</p>}
          {categories.length === 0 && items && isOwner && (
            <p className={styles.notice}>Prvo dodaj kategoriju u administraciji.</p>
          )}
          {items?.length === 0 && (
            <div className={styles.empty}>
              <Icon name="shop" />
              <h2>
                {archived ? "Nema arhiviranih djelatnosti." : "Tvoj sljedeći korak počinje ovdje."}
              </h2>
              <p>
                {archived
                  ? "Ovdje ćeš pronaći arhivirane profile."
                  : "Dodaj osnovne podatke o svom poslu."}
              </p>
            </div>
          )}
          <div className={styles.list}>
            {items?.map((item) => (
              <article key={item.id} className={styles.business}>
                <span className={styles.monogram} aria-hidden="true">
                  {item.media?.logo && mediaImageUrl(item.id, item.media.logo, "mine") ? (
                    <Image
                      src={mediaImageUrl(item.id, item.media.logo, "mine") as string}
                      alt=""
                      width={50}
                      height={50}
                      className={mediaStyles.rowLogo}
                      unoptimized
                    />
                  ) : (
                    item.title.slice(0, 1).toLocaleUpperCase("bs")
                  )}
                </span>
                <div className={styles.businessInfo}>
                  <h2>{item.title}</h2>
                  {item.city && <p>{item.city}</p>}
                  <span className={styles.status} data-status={item.status}>
                    {statuses[item.status]}
                  </span>
                </div>
                <div className={styles.businessActions}>
                  {item.status === "published" && (
                    <Link className={styles.secondary} href={`/djelatnosti/${item.id}`}>
                      Javni profil
                    </Link>
                  )}
                  {item.status !== "archived" ? (
                    <>
                      <button
                        type="button"
                        className={styles.secondary}
                        disabled={locked || loading}
                        onClick={() => {
                          setEditing(item);
                          setError("");
                          setNotice("");
                          setBookingNote("");
                        }}
                      >
                        Uredi
                      </button>
                      <button
                        type="button"
                        className={styles.secondary}
                        disabled={locked || loading}
                        onClick={() => {
                          setMediaBusiness(item);
                          setError("");
                          setNotice("");
                          setBookingNote("");
                        }}
                      >
                        Fotografije
                      </button>
                      <button
                        type="button"
                        className={styles.secondary}
                        disabled={locked || loading}
                        onClick={() => {
                          setBookingBusiness(item);
                          setError("");
                          setNotice("");
                          setBookingNote("");
                        }}
                      >
                        <Icon name="calendar" />
                        Booking
                      </button>
                      {["draft", "pending"].includes(item.status) && (
                        <button
                          type="button"
                          className={styles.primary}
                          disabled={locked || loading || (!isOwner && item.status === "pending")}
                          onClick={() => move(item, "publish")}
                        >
                          {isOwner ? "Objavi" : "Pošalji na pregled"}
                        </button>
                      )}
                      <button
                        type="button"
                        className={styles.cancel}
                        disabled={locked || loading}
                        onClick={() => move(item, "archive")}
                      >
                        Arhiviraj
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className={styles.secondary}
                      disabled={locked || loading}
                      onClick={() => move(item, "recover")}
                    >
                      Vrati u nacrte
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
          {items && (page > 1 || hasMore) && (
            <div className={styles.pagination}>
              <button
                type="button"
                className={styles.secondary}
                disabled={page === 1 || locked || loading}
                onClick={() => setPage(page - 1)}
              >
                Prethodna
              </button>
              <span>{page}</span>
              <button
                type="button"
                className={styles.secondary}
                disabled={!hasMore || locked || loading}
                onClick={() => setPage(page + 1)}
              >
                Sljedeća
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
