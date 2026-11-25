"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { readOverview } from "../../lib/account-overview";
import type { BookingSettings } from "../../lib/booking";
import {
  bookingActorRequest,
  bookingError,
  bookingRequest,
  bookingWrite,
} from "../../lib/booking-client";
import { isTimeZone } from "../../lib/booking-time";
import {
  type BusinessDetailsRequest,
  businessDetailsRequest,
} from "../../lib/business-details-client";
import {
  type BusinessMediaAsset,
  type BusinessMediaManifest,
  businessMediaUrl,
  inventoryMedia,
} from "../../lib/business-media";
import { businessMediaRequest } from "../../lib/business-media-client";
import {
  type BusinessOwnershipApi,
  businessOwnershipApi,
} from "../../lib/business-ownership-client";
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
import {
  type DirectoryListFilter,
  type DirectoryMutation,
  directoryMutationFieldsMatch,
  directoryMutationState,
  effectiveBusiness,
  patchDirectoryBusinessCache,
  uncertainDirectoryMutation,
} from "../../lib/directory-mutation-recovery";
import { msg } from "../../lib/i18n/translate";
import { packageFullText } from "../../lib/packages";
import type { DirectoryBusiness } from "../../server/directory/types";
import { ProfileVerification } from "../admin/ProfileVerification";
import { BusinessBookingManager } from "../booking/BusinessBookingManager";
import { Icon } from "../Icon";
import { useT } from "../i18n/LocaleProvider";
import { RentalFleet } from "../rentals/RentalFleet";
import { StayUnits } from "../stays/StayUnits";
import { BusinessChanges } from "./BusinessChanges";
import { BusinessDeleteAction } from "./BusinessDeleteAction";
import { BusinessDetailsManager } from "./BusinessDetailsManager";
import {
  BusinessEditor,
  type BusinessFields,
  type CategoryOption,
  hasRentalCategory,
  hasStayCategory,
} from "./BusinessEditor";
import { BusinessLogo } from "./BusinessLogo";
import { BusinessMediaManager } from "./BusinessMediaManager";
import { BusinessOwnershipManager } from "./BusinessOwnershipManager";
import styles from "./directory.module.css";

const statuses = {
  draft: msg("Nacrt"),
  pending: msg("Na pregledu"),
  published: msg("Objavljeno"),
  archived: msg("Arhivirano"),
};
function ReturnedBusinessNote({ business }: { business?: DirectoryBusiness | null }) {
  const t = useT();
  const note = business?.moderationReturn;
  if (business?.status !== "draft" || !note || note.version !== business.version) return null;
  return (
    <div className={styles.returnNote} role="note" aria-label={t("Razlog vraćanja u nacrt")}>
      <strong>{t("Razlog vraćanja u nacrt")}</strong>
      <p>{note.reason}</p>
    </div>
  );
}
/** True when the account's package has no room left. A failed read leaves the answer to the server. */
async function packageFull(accountId: string | undefined): Promise<boolean> {
  if (!accountId) return false;
  try {
    const response = await fetch("/api/account/overview", {
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      mode: "same-origin",
      headers: { "X-AhiBizz-Account-ID": accountId },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return false;
    const facts = readOverview(await response.json(), accountId);
    return facts.businessLimit !== null && facts.businesses >= facts.businessLimit;
  } catch {
    return false;
  }
}
function errorMessage(error: unknown) {
  const code = error instanceof RequestError ? error.code : "";
  if (code === "BUSINESS_LIMIT_REACHED") return packageFullText;
  if (code === "PACKAGE_PAYMENT_REQUIRED")
    return msg("Nacrt je sačuvan. Za objavu je potreban aktivan paket.");
  if (code === "REVIEW_REQUIRED")
    return msg("Prvo pregledaj i odobri ili odbij predložene izmjene.");
  if (code === "VERSION_CONFLICT")
    return msg("Djelatnost je u međuvremenu izmijenjena. Otvori je ponovo.");
  if (code === "IDEMPOTENCY_CONFLICT")
    return msg("Ovaj zahtjev je već poslan. Osvježi spisak i provjeri sačuvanu djelatnost.");
  if (code === "AUTHENTICATION_REQUIRED" || code === "ACCOUNT_SUSPENDED")
    return msg("Prijava je istekla. Prijavi se ponovo.");
  if (code === "ACCOUNT_IDENTITY_CHANGED") return msg("Prijavi se ponovo svojim nalogom.");
  if (code === "INVALID_DIRECTORY_INPUT") return msg("Provjeri unesene podatke.");
  return msg("Zahtjev nije uspio. Pokušaj ponovo.");
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
  initialReview = false,
  startCreation = false,
  embedded = false,
  expectedAccountId,
  request: directoryApi = directoryRequest,
  bookingApi = bookingRequest,
  mediaApi = businessMediaRequest,
  detailsApi = businessDetailsRequest,
  ownershipApi = businessOwnershipApi,
  adminVerification = false,
  mediaImageUrl = businessMediaUrl,
}: {
  active: boolean;
  isOwner: boolean;
  initialAll?: boolean;
  initialReview?: boolean;
  startCreation?: boolean;
  embedded?: boolean;
  expectedAccountId?: string;
  request?: DirectoryRequest;
  bookingApi?: typeof bookingRequest;
  mediaApi?: typeof businessMediaRequest;
  detailsApi?: BusinessDetailsRequest;
  ownershipApi?: BusinessOwnershipApi;
  adminVerification?: boolean;
  mediaImageUrl?: (id: string, asset: BusinessMediaAsset, area: "mine" | "public") => string | null;
}) {
  const t = useT();
  const [items, setItems] = useState<DirectoryBusiness[] | null>(null);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [editing, setEditing] = useState<DirectoryBusiness | null | undefined>(undefined);
  const [detailsBusiness, setDetailsBusiness] = useState<DirectoryBusiness | null>(null);
  const [stayBusiness, setStayBusiness] = useState<DirectoryBusiness | null>(null);
  const [rentalBusiness, setRentalBusiness] = useState<DirectoryBusiness | null>(null);
  const [ownershipBusiness, setOwnershipBusiness] = useState<DirectoryBusiness | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a fresh business version rekeys the base form and discards its dirty marker.
  useEffect(() => setEditorDirty(false), [editing?.id, editing?.version]);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [searchText, setSearchText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<DirectoryListFilter>(
    initialReview && isOwner ? "review" : "active",
  );
  const reviewOnly = filter === "review";
  const archived = filter === "archived";
  const missingMap = filter === "missingMap";
  const [all, setAll] = useState(initialAll && isOwner);
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
  const [pendingMutation, setPendingMutation] = useState<DirectoryMutation | null>(null);
  const [returning, setReturning] = useState<DirectoryBusiness | null>(null);
  const [rejectRevision, setRejectRevision] = useState(false);
  const [returnReason, setReturnReason] = useState("");
  const returnReasonId = useId();
  const returnInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (active && returning) returnInput.current?.focus();
  }, [active, returning]);
  const [loginRequired, setLoginRequired] = useState(false);
  const [bookingOption, setBookingOption] = useState<{ id: string; enabled: boolean } | null>(null);
  const [bookingNote, setBookingNote] = useState("");
  const [bookingLoading, setBookingLoading] = useState(false);
  const reads = useRef(0);
  const bookingReads = useRef(0);
  const writing = useRef<AbortController | null>(null);
  const creation = useRef(createDirectoryCreation());
  const mutation = useRef<DirectoryMutation | null>(null);
  const openedFromLink = useRef(false);
  const checkingRoom = useRef(false);
  useEffect(() => {
    if (!startCreation) {
      openedFromLink.current = false;
      return;
    }
    if (
      !active ||
      openedFromLink.current ||
      !categories.length ||
      busy ||
      creation.current.intent ||
      editing !== undefined
    )
      return;
    openedFromLink.current = true;
    setEditing(null);
  }, [startCreation, active, categories.length, busy, editing]);
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
  const clearPrivate = useCallback(
    (preserveCreation = false) => {
      if (preserveCreation) creation.current.retainUncertain();
      epoch.current++;
      reads.current++;
      bookingReads.current++;
      writing.current?.abort();
      writing.current = null;
      loadedSelection.current = "";
      setSearchText("");
      setSearchQuery("");
      setItems(null);
      setCategories([]);
      setHasMore(false);
      setEditing(undefined);
      setDetailsBusiness(null);
      setRentalBusiness(null);
      setStayBusiness(null);
      setOwnershipBusiness(null);
      setReturning(null);
      setReturnReason("");
      // An unknown child command must keep its mounted recovery state, without a private title.
      setBookingBusiness((current) =>
        preserveCreation && current ? { id: current.id, title: "Booking" } : null,
      );
      setMediaBusiness((current) =>
        preserveCreation && current ? { id: current.id, title: t("Fotografije") } : null,
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
      if (!preserveCreation) mutation.current = null;
      setPendingMutation(mutation.current);
    },
    [t],
  );
  const denied = useCallback(
    (failure: unknown) => {
      if (!directoryAccessDenied(failure)) return false;
      clearPrivate(true);
      setLoginRequired(true);
      setError(t("Prijavi se ponovo svojim nalogom."));
      return true;
    },
    [clearPrivate, t],
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
      setFilter(initialReview && isOwner ? "review" : "active");
      setAll(initialAll && isOwner);
      setPage(1);
      setError("");
      setLoginRequired(false);
    }
  }, [
    expectedAccountId,
    directoryApi,
    bookingApi,
    mediaApi,
    isOwner,
    initialAll,
    initialReview,
    clearPrivate,
  ]);
  const editingId = editing?.id;
  const commandLocked = busy || pendingCreate !== null || pendingMutation !== null;
  const locked = commandLocked || returning !== null;
  const area = reviewOnly && isOwner ? "review" : all && isOwner ? "admin" : "mine";
  const params = new URLSearchParams({ page: String(page) });
  if (archived) params.set("status", "archived");
  if (missingMap && area === "admin") params.set("map", "missing");
  if (searchQuery) params.set("q", searchQuery);
  const selection = `${area}?${params}`;
  const canContinue = items !== null && loadedSelection.current === selection && hasMore;
  function applySearch(value: string) {
    setSearchText(value);
    setSearchQuery(value.trim());
    setPage(1);
  }
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
          setBookingNote(t("Booking postavke nisu učitane. Ostaju nepromijenjene."));
      })
      .finally(() => {
        if (!controller.signal.aborted && revision === bookingReads.current)
          setBookingLoading(false);
      });
    return () => controller.abort();
  }, [active, editingId, booking, denied, current, t]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh explicitly invalidates the fetched list after writes and on request.
  useEffect(() => {
    if (
      !active ||
      bookingBusiness ||
      mediaBusiness ||
      detailsBusiness ||
      rentalBusiness ||
      stayBusiness
    )
      return;
    const controller = new AbortController(),
      revision = ++reads.current;
    const access = epoch.current;
    setReadError("");
    const cached = loadedSelection.current === selection && items !== null;
    setLoading(!cached);
    if (!cached) setItems(null);
    Promise.all([
      request(selection, { signal: controller.signal }),
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
        if (missingMap && page > 1 && list.items.length === 0) setPage(page - 1);
      })
      .catch((error) => {
        if (!current(access)) return;
        if (denied(error)) return;
        if (!controller.signal.aborted && revision === reads.current) {
          if (!cached || (error instanceof RequestError && [401, 403].includes(error.status))) {
            setItems(null);
            loadedSelection.current = "";
          }
          setReadError(t(errorMessage(error)));
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
    selection,
    missingMap,
    page,
    bookingBusiness,
    mediaBusiness,
    detailsBusiness,
    rentalBusiness,
    stayBusiness,
    request,
    denied,
    current,
  ]);

  function cacheBusiness(business: DirectoryBusiness) {
    reads.current++;
    setItems((rows) =>
      patchDirectoryBusinessCache(
        rows,
        business,
        filter,
        !searchQuery && page === 1 && ((all && isOwner) || business.ownerId === expectedAccountId),
      ),
    );
  }
  function forgetMutation() {
    mutation.current = null;
    setPendingMutation(null);
  }
  function mutationNotice(intent: DirectoryMutation) {
    if (intent.action === "approve-changes") return t("Izmjene su objavljene.");
    if (intent.action === "reject-changes") return t("Izmjene su odbijene.");
    if (intent.action === "edit" && !isOwner && intent.before.status === "published")
      return t("Podaci su sačuvani.");
    return intent.action === "return-to-draft"
      ? t("Djelatnost je vraćena u nacrt.")
      : intent.action === "archive"
        ? t("Djelatnost je arhivirana.")
        : intent.action === "recover"
          ? t("Djelatnost je vraćena u nacrte.")
          : intent.desiredStatus === "published"
            ? t("Djelatnost je objavljena.")
            : intent.desiredStatus === "pending"
              ? t("Izmjene su poslane na pregled.")
              : t("Nacrt je sačuvan.");
  }
  async function inspectMutation(
    intent: DirectoryMutation,
    controller: AbortController,
    access: number,
  ) {
    try {
      const data = await request(`mine/${encodeURIComponent(intent.before.id)}`, {
        signal: controller.signal,
      });
      if (!current(access) || controller.signal.aborted || mutation.current !== intent) return;
      if (!data.business) throw new RequestError("UNAVAILABLE");
      const state = directoryMutationState(intent, data.business);
      cacheBusiness(data.business);
      setLoginRequired(false);
      if (state === "pending") {
        setError(t("Prethodna izmjena još nije potvrđena. Provjeri ponovo."));
        return;
      }
      forgetMutation();
      const needsPublication =
        state === "matched" &&
        intent.action === "edit" &&
        intent.publish &&
        isOwner &&
        data.business.status !== "published";
      setEditing(
        (state === "changed" || needsPublication) &&
          ["edit", "publish"].includes(intent.action) &&
          data.business.status !== "archived"
          ? data.business
          : undefined,
      );
      setError(
        state === "changed"
          ? t("Djelatnost je u međuvremenu izmijenjena. Provjeri učitano stanje.")
          : needsPublication
            ? t("Podaci su sačuvani. Objava nije potvrđena.")
            : "",
      );
      if (state === "matched" && !needsPublication) setNotice(mutationNotice(intent));
      if (state === "matched" && typeof intent.bookingEnabled === "boolean")
        await updateBookingFlag(
          data.business,
          intent.bookingEnabled,
          intent.wasNew ?? false,
          controller,
          access,
        );
    } catch (failure) {
      if (!current(access) || controller.signal.aborted || mutation.current !== intent) return;
      if (denied(failure)) return;
      setError(t("Prethodna izmjena nije potvrđena. Provjeri ponovo."));
    }
  }
  async function checkPreviousMutation() {
    const intent = mutation.current;
    if (!intent || writing.current || !active) return;
    const controller = new AbortController(),
      access = epoch.current;
    writing.current = controller;
    reads.current++;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await inspectMutation(intent, controller, access);
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
      let confirmed = before;
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
        confirmed = after;
      }
      bookingReads.current++;
      setBookingLoading(false);
      setBookingOption({ id: business.id, enabled: confirmed.enabled });
      setBookingNote("");
      if (wasNew && enabled) setBookingBusiness(business);
    } catch (failure) {
      if (!current(access)) return;
      if (!controller.signal.aborted && denied(failure)) return;
      if (!controller.signal.aborted) {
        bookingReads.current++;
        setBookingLoading(false);
        setBookingOption(null);
        setBookingNote(
          `Podaci djelatnosti su sačuvani. Promjena bookinga nije potvrđena. ${bookingError(failure)} Otvori Booking i provjeri postavke.`,
        );
      }
    }
  }
  async function save(fields: BusinessFields, publish: boolean, replay?: DirectoryCreateIntent) {
    if (
      writing.current ||
      !active ||
      mutation.current ||
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
    let bookingPermitted = true;
    try {
      const intent = editingBusiness ? null : (replay ?? creation.current.begin(fields, publish));
      if (intent) {
        setPendingCreate(intent);
      }
      if (editingBusiness)
        mutation.current = {
          before: editingBusiness,
          action: "edit",
          useProposedFields: !isOwner && editingBusiness.status === "published",
          fields: directoryFields,
          desiredStatus: editingBusiness.status,
          publish,
          ...(updateBooking ? { bookingEnabled } : {}),
        };
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
      if (
        !data.business?.id ||
        !Number.isInteger(data.business.version) ||
        data.business.version < 1 ||
        (editingBusiness &&
          (data.business.id !== editingBusiness.id ||
            data.business.version < editingBusiness.version ||
            (data.business.version === editingBusiness.version &&
              !directoryMutationFieldsMatch(
                directoryFields,
                isOwner ? data.business : effectiveBusiness(data.business),
              ))))
      )
        throw new RequestError("UNAVAILABLE");
      let business = data.business as DirectoryBusiness;
      committed = business;
      forgetMutation();
      cacheBusiness(business);
      setEditing(business);
      setPendingCreate(null);
      if (publish && isOwner && business.status !== "published") {
        mutation.current = {
          before: business,
          action: "publish",
          desiredStatus: "published",
          fields: directoryFields,
          wasNew,
          ...(updateBooking ? { bookingEnabled } : {}),
        };
        const published = await call(
          `mine/${business.id}/publish`,
          write("POST", { expectedVersion: business.version }),
        );
        if (
          published.business?.id !== business.id ||
          published.business?.status !== "published" ||
          !Number.isInteger(published.business.version) ||
          published.business.version <= business.version
        )
          throw new RequestError("UNAVAILABLE");
        business = published.business;
        committed = business;
        forgetMutation();
        cacheBusiness(business);
      }
      setNotice(
        business.editorialRevision
          ? t("Izmjene su poslane na pregled.")
          : editingBusiness && business.version === editingBusiness.version
            ? t("Podaci su sačuvani.")
            : business.status === "published"
              ? t("Djelatnost je objavljena.")
              : business.status === "pending"
                ? t("Izmjene su poslane na pregled.")
                : t("Nacrt je sačuvan."),
      );
      setEditing(undefined);
    } catch (error) {
      if (!current(access) || controller.signal.aborted) return;
      if (mutation.current && !uncertainDirectoryMutation(error)) forgetMutation();
      if (denied(error)) return;
      if (mutation.current) {
        const intent = mutation.current;
        bookingPermitted = false;
        setPendingMutation(intent);
        await inspectMutation(intent, controller, access);
      } else if (committed) {
        bookingPermitted = false;
        try {
          const latest = await call(`mine/${committed.id}`);
          if (
            latest.business?.id !== committed.id ||
            !Number.isInteger(latest.business.version) ||
            latest.business.version < committed.version
          )
            throw new RequestError("UNAVAILABLE");
          cacheBusiness(latest.business);
          bookingPermitted = directoryMutationFieldsMatch(directoryFields, latest.business);
          if (latest.business.status === "published") {
            setNotice(t("Djelatnost je objavljena."));
            setEditing(undefined);
          } else {
            setEditing(latest.business);
            setError(t("Podaci su sačuvani. Objava nije potvrđena."));
          }
        } catch (failure) {
          if (!current(access) || controller.signal.aborted) return;
          if (denied(failure)) return;
          setEditing(undefined);
          setError(t("Podaci su sačuvani. Osvježi spisak radi provjere objave."));
        }
      } else {
        setPendingCreate(creation.current.intent);
        setLoginRequired(error instanceof RequestError && error.status === 401);
        setError(
          creation.current.intent
            ? t("Ishod unosa nije potvrđen. Ponovi isti unos da provjerimo sačuvanu djelatnost.")
            : t(errorMessage(error)),
        );
      }
    } finally {
      if (
        committed &&
        bookingPermitted &&
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
  async function move(
    item: DirectoryBusiness,
    action: Exclude<DirectoryMutation["action"], "edit">,
    reason?: string,
  ) {
    if (writing.current || !active || creation.current.intent || mutation.current) return;
    const returningToDraft = action === "return-to-draft";
    const rejecting = action === "reject-changes";
    const reviewing = returningToDraft || rejecting || action === "approve-changes";
    const trimmedReason = reason?.trim() ?? "";
    if (
      (returningToDraft || rejecting) &&
      (!isOwner ||
        !["pending", "published"].includes(item.status) ||
        trimmedReason.length < 2 ||
        trimmedReason.length > 500)
    ) {
      setError(t("Upiši razlog od 2 do 500 znakova."));
      return;
    }
    const controller = new AbortController();
    const access = epoch.current;
    writing.current = controller;
    setBusy(true);
    setError("");
    setNotice("");
    reads.current++;
    const intent: DirectoryMutation = {
      before: item,
      action,
      ...(returningToDraft || rejecting ? { reason: trimmedReason } : {}),
      desiredStatus:
        action === "archive"
          ? "archived"
          : action === "recover" || returningToDraft
            ? "draft"
            : isOwner
              ? "published"
              : "pending",
    };
    mutation.current = intent;
    try {
      const data = await request(reviewing ? `review/${item.id}` : `mine/${item.id}/${action}`, {
        ...write(
          reviewing ? "PATCH" : "POST",
          reviewing
            ? {
                status: returningToDraft ? "draft" : action,
                expectedVersion: item.version,
                ...(trimmedReason ? { reason: trimmedReason } : {}),
              }
            : { expectedVersion: item.version },
        ),
        signal: controller.signal,
      });
      if (!current(access) || controller.signal.aborted) return;
      if (
        data.business?.id !== item.id ||
        !Number.isInteger(data.business.version) ||
        data.business.version < item.version ||
        data.business.status !== intent.desiredStatus ||
        (reviewing && directoryMutationState(intent, data.business) !== "matched")
      )
        throw new RequestError("UNAVAILABLE");
      cacheBusiness(data.business);
      forgetMutation();
      setReturning(null);
      setReturnReason("");
      setNotice(mutationNotice(intent));
    } catch (error) {
      if (!current(access) || controller.signal.aborted) return;
      if (!uncertainDirectoryMutation(error)) forgetMutation();
      if (denied(error)) return;
      if (mutation.current) {
        setReturning(null);
        setReturnReason("");
        setPendingMutation(intent);
        await inspectMutation(intent, controller, access);
      } else {
        if (reviewing && error instanceof RequestError && error.status === 409) {
          setReturning(null);
          try {
            const latest = await request(`mine/${item.id}`, { signal: controller.signal });
            if (!current(access) || controller.signal.aborted) return;
            if (
              !latest.business ||
              latest.business.id !== item.id ||
              !Number.isInteger(latest.business.version) ||
              latest.business.version < item.version
            )
              throw new RequestError("UNAVAILABLE");
            cacheBusiness(latest.business);
          } catch (failure) {
            if (!current(access) || controller.signal.aborted) return;
            if (denied(failure)) return;
          }
        }
        setError(t(errorMessage(error)));
      }
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
    const approved = inventoryMedia(manifest);
    const patch = {
      version: manifest.businessVersion,
      status: manifest.status,
      pendingMedia: !!manifest.pendingMedia,
      ...(approved ? { media: approved } : {}),
    };
    setItems(
      (current) =>
        current?.map((row) => (row.id === manifest.businessId ? { ...row, ...patch } : row)) ??
        current,
    );
    setStayBusiness((current) =>
      current?.id === manifest.businessId ? { ...current, ...patch } : current,
    );
    setMediaBusiness((current) =>
      current?.id === manifest.businessId ? { ...current, ...patch } : current,
    );
    setEditing((current) =>
      current?.id === manifest.businessId ? { ...current, ...patch } : current,
    );
  }
  if (stayBusiness && expectedAccountId)
    return (
      <div className={styles.workspace}>
        <button type="button" className={styles.secondary} onClick={() => setStayBusiness(null)}>
          {t("Nazad na djelatnosti")}
        </button>
        <h2>{stayBusiness.title}</h2>
        {active && (
          <StayUnits
            key={`${expectedAccountId}:${stayBusiness.id}`}
            businessId={stayBusiness.id}
            actor={expectedAccountId}
            businessTitle={stayBusiness.title}
            photos={stayBusiness.media?.gallery}
            mediaOnReview={stayBusiness.pendingMedia}
            onMediaChanged={mediaChanged}
          />
        )}
      </div>
    );
  if (rentalBusiness && expectedAccountId)
    return (
      <div className={styles.workspace}>
        <button type="button" className={styles.secondary} onClick={() => setRentalBusiness(null)}>
          {t("Nazad na djelatnosti")}
        </button>
        <h2>{rentalBusiness.title}</h2>
        {active && (
          <RentalFleet
            key={`${expectedAccountId}:${rentalBusiness.id}`}
            businessId={rentalBusiness.id}
            actor={expectedAccountId}
            photos={rentalBusiness.media?.gallery}
            mediaOnReview={rentalBusiness.pendingMedia}
            onPhotos={() => {
              setMediaBusiness(rentalBusiness);
              setRentalBusiness(null);
            }}
          />
        )}
      </div>
    );
  if (ownershipBusiness && isOwner)
    return (
      <BusinessOwnershipManager
        key={`${ownershipBusiness.id}:${expectedAccountId ?? ""}`}
        businessId={ownershipBusiness.id}
        active={active}
        expectedAccountId={expectedAccountId}
        api={ownershipApi}
        onAccessDenied={denied}
        onChanged={(row) => {
          cacheBusiness(row);
          setEditing(row);
        }}
        onBack={() => {
          setOwnershipBusiness(null);
          setRefresh((value) => value + 1);
        }}
      />
    );
  if (detailsBusiness)
    return (
      <BusinessDetailsManager
        key={`${detailsBusiness.id}:${expectedAccountId ?? ""}`}
        businessId={detailsBusiness.id}
        businessTitle={detailsBusiness.title}
        administrator={isOwner}
        active={active}
        expectedAccountId={expectedAccountId}
        request={detailsApi}
        onAccessDenied={denied}
        onChanged={(row) => {
          cacheBusiness(row);
          setEditing(row);
          setDetailsBusiness(row);
        }}
        onBack={() => {
          setDetailsBusiness(null);
          setRefresh((value) => value + 1);
        }}
      />
    );
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
            <h1>{all && isOwner ? t("Sve djelatnosti") : t("Moje djelatnosti")}</h1>
          </div>
        )}
        {editing === undefined && (
          <button
            type="button"
            className={styles.primary}
            disabled={locked || loading || categories.length === 0}
            onClick={() => {
              if (creation.current.intent || checkingRoom.current) return;
              setError("");
              setNotice("");
              setBookingNote("");
              if (isOwner) {
                setEditing(null);
                return;
              }
              // Say that the package is full before the form is filled in, not after.
              checkingRoom.current = true;
              const access = epoch.current;
              void packageFull(expectedAccountId).then((full) => {
                checkingRoom.current = false;
                if (!current(access)) return;
                if (full) setError(t(packageFullText));
                else setEditing(null);
              });
            }}
          >
            <Icon name="shop" />
            {t("Dodaj djelatnost")}
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
            aria-label={t("Obnovi prijavu u novoj kartici")}
          >
            {t("Obnovi prijavu")}
          </Link>
        </div>
      )}
      {pendingCreate && !busy && (
        <div className={styles.notice} role="status">
          <p>{t("Prethodni unos još nije potvrđen.")}</p>
          <button
            type="button"
            className={styles.primary}
            disabled={!active}
            onClick={() => void save(pendingCreate.fields, pendingCreate.publish, pendingCreate)}
          >
            {t("Ponovi isti unos")}
          </button>
        </div>
      )}
      {pendingMutation && !busy && (
        <div className={styles.notice} role="status">
          <p>{t("Prethodna izmjena još nije potvrđena.")}</p>
          <button
            type="button"
            className={styles.primary}
            disabled={!active}
            onClick={() => void checkPreviousMutation()}
          >
            {t("Provjeri prethodnu izmjenu")}
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
      {bookingLoading && <p role="status">{t("Dohvaćanje booking postavki…")}</p>}
      {editing !== undefined ? (
        <>
          <ReturnedBusinessNote business={editing} />
          {editing && (
            <div className={styles.businessActions}>
              {(editing.hasStayUnits ||
                hasStayCategory(categories, editing.categoryId, editing.subcategoryId)) && (
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={locked || editorDirty}
                  onClick={() => setStayBusiness(editing)}
                >
                  <Icon name="bed" /> Smještaj
                </button>
              )}
              {bookingOption?.id === editing.id &&
                bookingOption.enabled &&
                hasStayCategory(categories, editing.categoryId, editing.subcategoryId) && (
                  <button
                    type="button"
                    className={styles.secondary}
                    disabled={locked || editorDirty}
                    onClick={() => setBookingBusiness(editing)}
                  >
                    <Icon name="calendar" /> Termini usluga
                  </button>
                )}
              {(editing.hasRentalVehicles ||
                hasRentalCategory(categories, editing.categoryId, editing.subcategoryId)) && (
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={locked || editorDirty}
                  onClick={() => setRentalBusiness(editing)}
                >
                  <Icon name="car" /> Automobili
                </button>
              )}
              <button
                type="button"
                className={styles.secondary}
                disabled={locked || editorDirty}
                title={editorDirty ? t("Prvo sačuvaj izmjene djelatnosti") : undefined}
                onClick={() => setDetailsBusiness(editing)}
              >
                <Icon name="clock" />
                {t("Radno vrijeme i sadržaji")}
              </button>
              {isOwner && (
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={locked || editorDirty}
                  title={editorDirty ? t("Prvo sačuvaj izmjene djelatnosti") : undefined}
                  onClick={() => setOwnershipBusiness(editing)}
                >
                  <Icon name="user" />
                  {t("Dodijeli vlasnika")}
                </button>
              )}
              {isOwner && adminVerification && active && expectedAccountId && (
                <ProfileVerification
                  kind="business"
                  id={editing.id}
                  actorId={expectedAccountId}
                  disabled={locked || editorDirty}
                  canGrant={editing.status !== "archived"}
                  onAccessDenied={denied}
                />
              )}
            </div>
          )}
          <BusinessEditor
            key={editing ? `${editing.id}:${editing.version}` : "new"}
            initial={editing ? (isOwner ? editing : effectiveBusiness(editing)) : undefined}
            categories={categories}
            busy={locked}
            canPublish={isOwner}
            currentStatus={editing?.status}
            bookingEnabled={
              editing
                ? bookingOption?.id === editing.id
                  ? bookingOption.enabled
                  : undefined
                : false
            }
            onSave={save}
            onDirty={() => setEditorDirty(true)}
            onCancel={() => {
              if (creation.current.intent || mutation.current) return;
              setEditing(undefined);
              setError("");
              setBookingNote("");
            }}
          />
        </>
      ) : (
        <>
          {returning && (
            <form
              className={styles.returnForm}
              aria-label={
                rejectRevision ? t("Odbijanje izmjena") : t("Vraćanje djelatnosti u nacrt")
              }
              onSubmit={(event) => {
                event.preventDefault();
                void move(
                  returning,
                  rejectRevision ? "reject-changes" : "return-to-draft",
                  returnReason,
                );
              }}
            >
              <fieldset disabled={commandLocked}>
                <h2>{rejectRevision ? t("Odbij izmjene") : t("Vrati u nacrt")}</h2>
                <p>{returning.title}</p>
                <label htmlFor={returnReasonId}>
                  {rejectRevision ? t("Razlog odbijanja") : t("Razlog vraćanja")}
                  <input
                    id={returnReasonId}
                    ref={returnInput}
                    value={returnReason}
                    onChange={(event) => setReturnReason(event.target.value)}
                    minLength={2}
                    maxLength={500}
                    required
                    autoComplete="off"
                  />
                </label>
                <div className={styles.returnActions}>
                  <button type="submit" className={styles.primary}>
                    {busy
                      ? t("Spremanje…")
                      : rejectRevision
                        ? t("Odbij izmjene")
                        : t("Vrati u nacrt")}
                  </button>
                  <button
                    type="button"
                    className={styles.cancel}
                    onClick={() => {
                      setReturning(null);
                      setReturnReason("");
                      setError("");
                    }}
                  >
                    {rejectRevision ? t("Odustani") : t("Odustani od vraćanja")}
                  </button>
                </div>
              </fieldset>
            </form>
          )}
          <div className={styles.listControls}>
            {isOwner && (
              <search aria-label={t("Pretraga djelatnosti")}>
                <form
                  className={styles.manageSearch}
                  onSubmit={(event) => {
                    event.preventDefault();
                    applySearch(searchText);
                  }}
                >
                  <input
                    type="search"
                    name="q"
                    aria-label={t("Naziv ili grad")}
                    placeholder={t("Naziv ili grad")}
                    maxLength={120}
                    disabled={locked}
                    value={searchText}
                    onChange={(event) => {
                      const next = event.target.value;
                      setSearchText(next);
                      if (!next && searchQuery) applySearch("");
                    }}
                  />
                  <button type="submit" className={styles.secondary} disabled={locked}>
                    {t("Pretraži")}
                  </button>
                  {(searchQuery || searchText) && (
                    <button
                      type="button"
                      className={styles.cancel}
                      disabled={locked}
                      onClick={() => applySearch("")}
                    >
                      {t("Očisti pretragu")}
                    </button>
                  )}
                </form>
              </search>
            )}
            <div className={styles.toolbar}>
              <div className={styles.filters}>
                {isOwner && (
                  <label>
                    <input
                      type="checkbox"
                      checked={all}
                      disabled={locked || loading}
                      onChange={(event) => {
                        if (!archived) setFilter("active");
                        setAll(event.target.checked);
                        setPage(1);
                      }}
                    />
                    {t("Sve djelatnosti")}
                  </label>
                )}
                {isOwner && (
                  <label>
                    <input
                      type="checkbox"
                      checked={reviewOnly}
                      disabled={locked || loading}
                      onChange={(event) => {
                        setFilter(event.target.checked ? "review" : "active");
                        if (event.target.checked) setAll(true);
                        setPage(1);
                      }}
                    />
                    {t("Na pregledu")}
                  </label>
                )}
                {isOwner && embedded && (
                  <label>
                    <input
                      type="checkbox"
                      checked={missingMap}
                      disabled={locked || loading}
                      onChange={(event) => {
                        setFilter(event.target.checked ? "missingMap" : "active");
                        if (event.target.checked) setAll(true);
                        setPage(1);
                      }}
                    />
                    {t("Bez lokacije na mapi")}
                  </label>
                )}
                <label>
                  <input
                    type="checkbox"
                    checked={archived}
                    disabled={locked || loading}
                    onChange={(event) => {
                      setFilter(event.target.checked ? "archived" : "active");
                      setPage(1);
                    }}
                  />
                  {t("Arhivirane")}
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
                {t("Osvježi")}
              </button>
            </div>
          </div>
          {!items && !error && !readError && <p role="status">{t("Dohvaćanje djelatnosti…")}</p>}
          {categories.length === 0 && items && isOwner && (
            <p className={styles.notice}>{t("Prvo dodaj kategoriju u administraciji.")}</p>
          )}
          {items?.length === 0 && (
            <div className={styles.empty}>
              <Icon name="shop" />
              <h2>
                {searchQuery
                  ? t("Nema rezultata za ovu pretragu.")
                  : reviewOnly
                    ? t("Nema djelatnosti na pregledu.")
                    : missingMap
                      ? t("Sve objavljene djelatnosti imaju lokaciju na mapi.")
                      : archived
                        ? t("Nema arhiviranih djelatnosti.")
                        : t("Tvoj sljedeći korak počinje ovdje.")}
              </h2>
              {!searchQuery && !reviewOnly && !missingMap && (
                <p>
                  {archived
                    ? t("Ovdje ćeš pronaći arhivirane profile.")
                    : t("Dodaj osnovne podatke o svom poslu.")}
                </p>
              )}
            </div>
          )}
          <div className={styles.list}>
            {items?.map((item) => {
              const stays =
                item.hasStayUnits ||
                hasStayCategory(categories, item.categoryId, item.subcategoryId);
              const cars =
                item.hasRentalVehicles ||
                hasRentalCategory(categories, item.categoryId, item.subcategoryId);
              return (
                <article key={item.id} className={styles.business}>
                  <span className={styles.monogram} aria-hidden="true">
                    {item.media?.logo && mediaImageUrl(item.id, item.media.logo, "mine") ? (
                      <BusinessLogo
                        src={mediaImageUrl(item.id, item.media.logo, "mine") as string}
                        alt=""
                        monogram={item.title.slice(0, 1).toLocaleUpperCase("bs")}
                        sizes="50px"
                      />
                    ) : (
                      item.title.slice(0, 1).toLocaleUpperCase("bs")
                    )}
                  </span>
                  <div className={styles.businessInfo}>
                    <h2 dir="auto">{item.title}</h2>
                    {item.city && <p dir="auto">{item.city}</p>}
                    <span className={styles.status} data-status={item.status}>
                      {t(statuses[item.status])}
                    </span>
                    <ReturnedBusinessNote business={item} />
                    {item.revisionRejection && (
                      <p>Razlog odbijanja izmjena: {item.revisionRejection}</p>
                    )}
                    {(item.editorialRevision || item.pendingMedia) && (
                      <BusinessChanges business={item} categories={categories} />
                    )}
                  </div>
                  <div className={styles.businessActions}>
                    {(item.status === "archived" ? item.hasStayUnits : stays) && (
                      <button
                        type="button"
                        className={styles.secondary}
                        disabled={locked || loading}
                        onClick={() => setStayBusiness(item)}
                      >
                        <Icon name="bed" />
                        {item.status === "archived" ? t("Kalendar smještaja") : t("Smještaj")}
                      </button>
                    )}
                    {item.status === "archived" && item.hasRentalVehicles && (
                      <button
                        type="button"
                        className={styles.secondary}
                        disabled={locked || loading}
                        onClick={() => setRentalBusiness(item)}
                      >
                        <Icon name="calendar" /> Kalendar automobila
                      </button>
                    )}
                    {item.status === "published" && (
                      <Link className={styles.secondary} href={`/djelatnosti/${item.id}`}>
                        {t("Javni profil")}
                      </Link>
                    )}
                    {item.status === "published" && item.ownerId === expectedAccountId && (
                      <Link
                        className={styles.secondary}
                        href={`/nalog/reels?djelatnost=${item.id}`}
                      >
                        <Icon name="play" /> Reels
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
                          {t("Uredi")}
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
                          {t("Fotografije")}
                        </button>
                        {(!stays || cars) && (
                          <button
                            type="button"
                            className={styles.secondary}
                            disabled={locked || loading}
                            onClick={() => {
                              if (cars) setRentalBusiness(item);
                              else setBookingBusiness(item);
                              setError("");
                              setNotice("");
                              setBookingNote("");
                            }}
                          >
                            <Icon name={cars ? "car" : "calendar"} />
                            {cars ? t("Automobili") : "Booking"}
                          </button>
                        )}
                        {["draft", "pending"].includes(item.status) && (
                          <button
                            type="button"
                            className={styles.primary}
                            disabled={locked || loading || (!isOwner && item.status === "pending")}
                            onClick={() => move(item, "publish")}
                          >
                            {isOwner ? t("Objavi") : t("Pošalji na pregled")}
                          </button>
                        )}
                        {isOwner && (item.editorialRevision || item.pendingMedia) && (
                          <>
                            <button
                              type="button"
                              className={styles.primary}
                              disabled={locked || loading}
                              onClick={() => void move(item, "approve-changes")}
                            >
                              {t("Odobri izmjene")}
                            </button>
                            <button
                              type="button"
                              className={styles.secondary}
                              disabled={locked || loading}
                              onClick={() => {
                                setRejectRevision(true);
                                setReturning(item);
                                setReturnReason("");
                                setError("");
                                setNotice("");
                              }}
                            >
                              {t("Odbij izmjene")}
                            </button>
                          </>
                        )}
                        {isOwner && ["pending", "published"].includes(item.status) && (
                          <button
                            type="button"
                            className={styles.secondary}
                            disabled={locked || loading}
                            onClick={() => {
                              setRejectRevision(false);
                              setReturning(item);
                              setReturnReason("");
                              setError("");
                              setNotice("");
                            }}
                          >
                            {t("Vrati u nacrt")}
                          </button>
                        )}
                        <button
                          type="button"
                          className={styles.cancel}
                          disabled={locked || loading}
                          onClick={() => move(item, "archive")}
                        >
                          {t("Arhiviraj")}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className={styles.secondary}
                        disabled={locked || loading}
                        onClick={() => move(item, "recover")}
                      >
                        {t("Vrati u nacrte")}
                      </button>
                    )}
                    {expectedAccountId && (isOwner || expectedAccountId === item.ownerId) && (
                      <BusinessDeleteAction
                        business={item}
                        accountId={expectedAccountId}
                        disabled={locked || loading}
                        onDeleted={() => {
                          setItems((current) => current?.filter((b) => b.id !== item.id) ?? null);
                          setRefresh((value) => value + 1);
                        }}
                      />
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          {!loginRequired && (page > 1 || canContinue) && (
            <div className={styles.pagination}>
              <button
                type="button"
                className={styles.secondary}
                disabled={page === 1 || locked || loading}
                onClick={() => setPage(page - 1)}
              >
                {t("Prethodna")}
              </button>
              <span>{page}</span>
              <button
                type="button"
                className={styles.secondary}
                disabled={!canContinue || locked || loading}
                onClick={() => setPage(page + 1)}
              >
                {t("Sljedeća")}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
