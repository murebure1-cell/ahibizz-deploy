"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appointmentDay, appointmentHours, appointmentTile } from "../../lib/appointment-display";
import {
  type BookingEntry,
  type BookingListView,
  type BookingStatus,
  bookingDate,
  bookingMoney,
  bookingStatusLabels,
} from "../../lib/booking";
import {
  bookingAccessDenied,
  bookingActorRequest,
  bookingError,
  bookingRequest,
  bookingWrite,
} from "../../lib/booking-client";
import {
  type CustomerAppointmentsState,
  customerAppointmentCancelled,
  customerAppointmentsFailed,
  readCustomerCancellation,
  reconcileCustomerCancellations,
} from "../../lib/customer-appointments-state";
import { Icon } from "../Icon";
import { useI18n } from "../i18n/LocaleProvider";
import {
  AppointmentCard,
  type AppointmentTone,
  appointmentAction,
  BusinessActions,
  CancelAppointment,
} from "./AppointmentCard";
import styles from "./appointments.module.css";
import { listenForBookingResume } from "./booking-resume";
import { InventoryAppointments } from "./InventoryAppointments";

const tones: Record<BookingStatus, AppointmentTone> = {
  requested: "waiting",
  confirmed: "confirmed",
  cancelled: "refused",
  declined: "refused",
  completed: "over",
};

type Props = {
  active?: boolean;
  heading?: boolean;
  request?: typeof bookingRequest;
  expectedAccountId?: string;
  initialView?: BookingListView;
};

export function CustomerAppointments(props: Props) {
  return <AppointmentsWorkspace key={props.expectedAccountId ?? "unavailable"} {...props} />;
}

function AppointmentsWorkspace({
  active = true,
  heading = true,
  request = bookingRequest,
  expectedAccountId,
  initialView = "upcoming",
}: Props) {
  const { t, locale } = useI18n();
  const [readState, setReadState] = useState<CustomerAppointmentsState>({
      result: null,
      requiresLogin: false,
    }),
    [view, setView] = useState<BookingListView>(initialView),
    [page, setPage] = useState(1),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    setView(initialView);
    setPage(1);
  }, [initialView]);
  const revision = useRef(0),
    authority = useRef(0),
    live = useRef(false),
    controllers = useRef(new Set<AbortController>()),
    writing = useRef(false),
    cancellations = useRef(new Map<string, BookingEntry>()),
    api = useMemo(
      () => bookingActorRequest(expectedAccountId, request),
      [expectedAccountId, request],
    );
  const clearPrivate = useCallback(
    (failure: unknown) => {
      authority.current++;
      revision.current++;
      for (const controller of controllers.current) controller.abort();
      controllers.current.clear();
      writing.current = false;
      cancellations.current.clear();
      setReadState({ result: null, requiresLogin: true });
      setNotice("");
      setError(t(bookingError(failure)));
      setBusy(false);
      setLoading(false);
    },
    [t],
  );
  const previousApi = useRef(api);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      authority.current++;
      revision.current++;
      for (const controller of controllers.current) controller.abort();
      controllers.current.clear();
      cancellations.current.clear();
    };
  }, []);
  useEffect(() => {
    if (previousApi.current === api) return;
    previousApi.current = api;
    authority.current++;
    revision.current++;
    for (const controller of controllers.current) controller.abort();
    controllers.current.clear();
    setReadState({ result: null, requiresLogin: false });
    setNotice("");
    setError("");
    writing.current = false;
    cancellations.current.clear();
    setBusy(false);
  }, [api]);
  const { result, requiresLogin } = readState;
  const selection = `${view}:${page}`;
  const ready = result?.key === selection;
  const entries = ready ? result.entries : [];
  const more = ready && result.more;
  useEffect(() => {
    if (!active || requiresLogin) return;
    return listenForBookingResume(() => {
      // An in-flight cancellation refreshes the same list when it settles.
      if (!writing.current) setRefresh((value) => value + 1);
    });
  }, [active, requiresLogin]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: The refresh counter deliberately repeats the same read after a user action.
  useEffect(() => {
    if (!active || writing.current) return;
    const current = ++revision.current,
      generation = authority.current,
      controller = new AbortController();
    controllers.current.add(controller);
    setError("");
    setLoading(true);
    void api(`mine?page=${page}&view=${view}`, { signal: controller.signal })
      .then((data) => {
        if (
          !live.current ||
          generation !== authority.current ||
          controller.signal.aborted ||
          current !== revision.current
        )
          return;
        if (
          !Array.isArray(data.entries) ||
          data.page !== page ||
          data.view !== view ||
          typeof data.hasMore !== "boolean" ||
          typeof data.asOf !== "string" ||
          !Number.isFinite(Date.parse(data.asOf))
        )
          throw new Error("invalid_appointments");
        if (data.entries.length === 0 && page > 1) {
          setPage(page - 1);
          return;
        }
        setReadState({
          result: reconcileCustomerCancellations(
            {
              key: `${view}:${page}`,
              entries: data.entries,
              more: data.hasMore,
            },
            cancellations.current.values(),
          ),
          requiresLogin: false,
        });
      })
      .catch((failure) => {
        if (!live.current || generation !== authority.current) return;
        if (bookingAccessDenied(failure)) {
          clearPrivate(failure);
          return;
        }
        if (!controller.signal.aborted && current === revision.current) {
          setReadState((previous) => customerAppointmentsFailed(previous, failure));
          setError(t(bookingError(failure)));
        }
      })
      .finally(() => {
        controllers.current.delete(controller);
        if (live.current && generation === authority.current && current === revision.current)
          setLoading(false);
      });
    return () => {
      revision.current++;
      controller.abort();
    };
  }, [active, page, view, refresh, api, clearPrivate]);
  async function cancel(entry: BookingEntry) {
    if (requiresLogin || writing.current) return;
    const generation = authority.current,
      controller = new AbortController();
    controllers.current.add(controller);
    writing.current = true;
    revision.current++;
    setLoading(false);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api(`entries/${entry.id}/action`, {
        ...bookingWrite("POST", { expectedVersion: entry.version, action: "cancel" }),
        signal: controller.signal,
      });
      if (!live.current || generation !== authority.current || controller.signal.aborted) return;
      const cancelled = readCustomerCancellation(result.entry, entry, expectedAccountId);
      revision.current++;
      setLoading(false);
      cancellations.current.set(cancelled.id, cancelled);
      setReadState((previous) => customerAppointmentCancelled(previous, cancelled));
      setNotice(t("Termin je otkazan."));
    } catch (failure) {
      if (!live.current || generation !== authority.current) return;
      if (bookingAccessDenied(failure)) {
        clearPrivate(failure);
        return;
      }
      setReadState((previous) => customerAppointmentsFailed(previous, failure));
      setError(t(bookingError(failure)));
    } finally {
      controllers.current.delete(controller);
      if (live.current && generation === authority.current) {
        writing.current = false;
        setBusy(false);
        setRefresh((value) => value + 1);
      }
    }
  }
  return (
    <section className={styles.list} aria-label={t("Moji termini")} data-design="appointments">
      <div className={styles.head}>
        {heading && <h2>{t("Moji termini")}</h2>}
        <button
          type="button"
          className={styles.refresh}
          aria-label={t("Osvježi")}
          title={t("Osvježi")}
          disabled={busy || loading}
          onClick={() => setRefresh((value) => value + 1)}
        >
          <Icon name="refresh" aria-hidden="true" />
        </button>
      </div>
      <fieldset className={styles.views} aria-label={t("Prikaz termina")}>
        {(
          [
            ["upcoming", t("Aktuelni")],
            ["history", t("Historija")],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={view === value}
            disabled={busy}
            onClick={() => {
              setView(value);
              setPage(1);
              setError("");
              setNotice("");
            }}
          >
            {label}
          </button>
        ))}
      </fieldset>
      {error && (
        <div role="alert" className={styles.problem}>
          <p>{error}</p>
          {requiresLogin && (
            <Link
              className={appointmentAction}
              href="/prijava?nastavi=%2Fnalog%3Fodjeljak%3Dtermini"
            >
              {t("Prijavi se")}
            </Link>
          )}
        </div>
      )}
      {notice && (
        <p role="status" className={styles.done}>
          {notice}
        </p>
      )}
      {!ready && !error && (
        <p role="status" className={styles.note}>
          {t("Provjeravam tvoje termine…")}
        </p>
      )}
      {entries.length > 0 && (
        <section className={styles.group} aria-label={t("Usluge")}>
          <h3>{t("Usluge")}</h3>
          <div className={styles.cards} aria-busy={loading}>
            {entries.map((entry) => {
              const ahead = new Date(entry.startsAt) > new Date();
              return (
                <AppointmentCard
                  key={entry.id}
                  tile={appointmentTile(appointmentDay(entry.startsAt, entry.timezone), locale)}
                  spoken={bookingDate(entry.startsAt, entry.timezone, { locale })}
                  title={entry.serviceName ?? t("Termin")}
                  detail={
                    <>
                      <Link href={`/djelatnosti/${entry.businessId}`} dir="auto">
                        {entry.businessTitle}
                      </Link>
                      {` · ${appointmentHours(
                        entry,
                        appointmentDay(new Date().toISOString(), entry.timezone),
                        locale,
                      )} · ${bookingMoney(entry.priceMinor)}`}
                    </>
                  }
                  state={t(bookingStatusLabels[entry.status])}
                  tone={tones[entry.status]}
                  past={view === "history"}
                >
                  <BusinessActions
                    businessId={entry.businessId}
                    directions={entry.status === "confirmed" && ahead}
                  />
                  {["requested", "confirmed"].includes(entry.status) && ahead && (
                    <CancelAppointment
                      label={t("Otkaži")}
                      disabled={busy || loading}
                      onConfirm={() => void cancel(entry)}
                    />
                  )}
                </AppointmentCard>
              );
            })}
          </div>
        </section>
      )}
      {ready && (page > 1 || more) && (
        <nav className={styles.pages} aria-label={t("Stranice termina")}>
          <button type="button" disabled={busy || page === 1} onClick={() => setPage(page - 1)}>
            {t("Prethodna")}
          </button>
          <span aria-current="page">{page}</span>
          <button type="button" disabled={busy || !more} onClick={() => setPage(page + 1)}>
            {t("Sljedeća")}
          </button>
        </nav>
      )}
      {active && expectedAccountId && !requiresLogin && (
        <InventoryAppointments
          key={view}
          actor={expectedAccountId}
          view={view}
          refresh={refresh}
          servicesEmpty={page === 1 && ready && entries.length === 0 && !loading && !error}
        />
      )}
    </section>
  );
}
