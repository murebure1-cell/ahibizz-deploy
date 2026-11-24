"use client";
import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import type { BookingListView } from "../../lib/booking";
import type { RentalBooking } from "../../lib/rentals";
import type { StayBooking } from "../../lib/stays";
import { Icon } from "../Icon";
import { useT } from "../i18n/LocaleProvider";
import { RentalEntry } from "../rentals/RentalEntries";
import { RentalRecovery } from "../rentals/RentalRecovery";
import { useRentalRead } from "../rentals/rental-client";
import { StayEntry } from "../stays/StayEntries";
import { useStayRead } from "../stays/stay-client";
import styles from "./public-booking.module.css";

type Page<T> = { entries: T[]; hasMore: boolean };
type Read<T> = { data?: Page<T>; error?: string } | null;

function AppointmentsEmpty({ view }: { view: BookingListView }) {
  const t = useT();
  return (
    <div className={styles.empty}>
      <Icon name="calendar" />
      <h3>{view === "history" ? t("Još nema ranijih termina.") : t("Nema aktuelnih termina.")}</h3>
      {view === "upcoming" && <Link href="/pretraga">{t("Pronađi djelatnost")}</Link>}
    </div>
  );
}

function InventoryGroup<T>({
  title,
  state,
  page,
  setPage,
  retry,
  children,
}: {
  title: string;
  state: Read<T>;
  page: number;
  setPage: (page: number) => void;
  retry: () => void;
  children: (entry: T) => ReactNode;
}) {
  const t = useT();
  const data = state?.data;
  useEffect(() => {
    if (data && !data.entries.length && page > 1) setPage(page - 1);
  }, [data, page, setPage]);
  if (!state || (data && !data.entries.length)) return null;
  return (
    <section aria-label={title} className={styles.inventoryGroup}>
      <h3>{title}</h3>
      {state.error && (
        <p role="alert" className={styles.error}>
          {state.error}{" "}
          <button type="button" className={styles.secondary} onClick={retry}>
            {t("Pokušaj ponovo")}
          </button>
        </p>
      )}
      {data && <div className={styles.entryList}>{data.entries.map(children)}</div>}
      {data && (data.hasMore || page > 1) && (
        <nav className={styles.pagination} aria-label={`Stranice: ${title}`}>
          <button type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>
            {t("Prethodna")}
          </button>
          <span aria-current="page">{page}</span>
          <button type="button" disabled={!data.hasMore} onClick={() => setPage(page + 1)}>
            {t("Sljedeća")}
          </button>
        </nav>
      )}
    </section>
  );
}

export function InventoryAppointments({
  actor,
  view,
  refresh,
  servicesEmpty,
}: {
  actor: string;
  view: BookingListView;
  refresh: number;
  servicesEmpty: boolean;
}) {
  const t = useT();
  const [rentalPage, setRentalPage] = useState(1);
  const [stayPage, setStayPage] = useState(1);
  const [rentalRevision, setRentalRevision] = useState(0);
  const [stayRevision, setStayRevision] = useState(0);
  const rentals = useRentalRead<Page<RentalBooking>>(
    `mine?page=${rentalPage}&view=${view}`,
    actor,
    refresh + rentalRevision,
  );
  const stays = useStayRead<Page<StayBooking>>(
    `mine?page=${stayPage}&view=${view}`,
    actor,
    refresh + stayRevision,
  );
  const refreshRentals = () => setRentalRevision((n) => n + 1);
  const refreshStays = () => setStayRevision((n) => n + 1);
  return (
    <>
      <RentalRecovery actor={actor} onResolved={refreshRentals} />
      {servicesEmpty &&
        rentalPage === 1 &&
        stayPage === 1 &&
        rentals?.data?.entries.length === 0 &&
        stays?.data?.entries.length === 0 && <AppointmentsEmpty view={view} />}
      {servicesEmpty && (!rentals || !stays) && (
        <p role="status" className={styles.note}>
          {t("Provjeravam najam i smještaj…")}
        </p>
      )}
      <InventoryGroup
        title={t("Najam automobila")}
        state={rentals}
        page={rentalPage}
        setPage={setRentalPage}
        retry={refreshRentals}
      >
        {(entry) => (
          <RentalEntry key={entry.id} entry={entry} actor={actor} changed={refreshRentals} />
        )}
      </InventoryGroup>
      <InventoryGroup
        title={t("Smještaj")}
        state={stays}
        page={stayPage}
        setPage={setStayPage}
        retry={refreshStays}
      >
        {(entry) => <StayEntry key={entry.id} entry={entry} actor={actor} changed={refreshStays} />}
      </InventoryGroup>
    </>
  );
}
