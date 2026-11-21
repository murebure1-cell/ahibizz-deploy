"use client";

import Form from "next/form";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { fetchNearbyPages, nearbyDirectoryPath, nearbyRadiusKm } from "../../lib/home-nearby";
import type { PublicBusinessView } from "../../lib/public-business";
import { DirectoryResultCard } from "../directory/DirectoryResultCard";
import { Icon } from "../Icon";
import { useDeviceLocation } from "../location/DeviceLocation";
import { HomeBusinessRail, HomeEmptyState } from "./HomeSurface";
import homeStyles from "./home.module.css";
import styles from "./nearby.module.css";

type NearbyProps = {
  categories: { id: string; name: string; parentId: string | null }[];
  initialBusinesses: PublicBusinessView[];
  available: boolean;
  place: string;
  children: ReactNode;
};
type NearbyContext = {
  businesses: PublicBusinessView[];
  state: "waiting" | "loading" | "ready" | "unavailable";
  place: string;
  useGps: boolean;
  refresh: "pending" | "failed" | null;
  pagination: "pending" | "failed" | null;
  hasMore: boolean;
  loadMore: () => void;
  retryRefresh: () => void;
  location: ReturnType<typeof useDeviceLocation>;
  chooseGps: () => void;
  chooseCity: () => void;
};
const Context = createContext<NearbyContext | null>(null);

type NearbySnapshot = Awaited<ReturnType<typeof fetchNearbyPages>> & { path: string };
type NearbyRequest = { path: string; page: number };
type NearbyFailure = { path: string; kind: "refresh" | "page" };

export function HomeNearbyProvider({
  categories,
  initialBusinesses,
  available,
  place,
  children,
}: NearbyProps) {
  const [useGps, setUseGps] = useState(!place);
  const router = useRouter();
  const location = useDeviceLocation({ active: useGps });
  const path = useGps && location.point ? nearbyDirectoryPath(location.point) : null;
  const latest = useRef<NearbySnapshot | null>(null);
  const [snapshot, setSnapshot] = useState<NearbySnapshot | null>(null);
  const [request, setRequest] = useState<NearbyRequest | null>(null);
  const [failure, setFailure] = useState<NearbyFailure | null>(null);
  useEffect(() => {
    if (!path) {
      latest.current = null;
      setSnapshot(null);
      setRequest(null);
      setFailure(null);
      return;
    }
    const previous = latest.current;
    const sameLocation = previous?.path === path;
    const firstPage = sameLocation ? previous.page + 1 : 1;
    // Replace a widened list as one snapshot, so a coordinate change cannot mix two locations.
    const lastPage = sameLocation
      ? request?.path === path
        ? request.page
        : previous.page
      : (previous?.page ?? 1);
    if (lastPage < firstPage) return;
    let current = true;
    const abort = new AbortController();
    const timeout = window.setTimeout(() => abort.abort(), 12_000);
    setFailure(null);
    void (async () => {
      try {
        const response = await fetchNearbyPages(
          path,
          categories,
          firstPage,
          lastPage,
          abort.signal,
        );
        if (!current) return;
        const items = new Map(
          [...(sameLocation ? previous.items : []), ...response.items].map((item) => [
            item.id,
            item,
          ]),
        );
        const next = { ...response, path, items: [...items.values()] };
        latest.current = next;
        setSnapshot(next);
      } catch {
        if (current) setFailure({ path, kind: sameLocation ? "page" : "refresh" });
      } finally {
        window.clearTimeout(timeout);
      }
    })();
    return () => {
      current = false;
      window.clearTimeout(timeout);
      abort.abort();
    };
  }, [path, categories, request]);
  const value = useMemo<NearbyContext>(() => {
    const gpsResults = path ? snapshot : null;
    const refreshFailed = failure?.path === path && failure.kind === "refresh";
    const paginationPending =
      path && gpsResults?.path === path && request?.path === path && request.page > gpsResults.page;
    return {
      businesses: useGps ? (gpsResults?.items ?? []) : initialBusinesses,
      state: useGps
        ? !path
          ? "waiting"
          : gpsResults
            ? "ready"
            : refreshFailed
              ? "unavailable"
              : "loading"
        : available
          ? "ready"
          : "unavailable",
      place,
      useGps,
      location,
      refresh:
        gpsResults && gpsResults.path !== path ? (refreshFailed ? "failed" : "pending") : null,
      pagination: paginationPending
        ? failure?.path === path && failure.kind === "page"
          ? "failed"
          : "pending"
        : null,
      hasMore: gpsResults?.hasMore ?? false,
      loadMore() {
        if (!gpsResults || !path || gpsResults.path !== path || !gpsResults.hasMore) return;
        setRequest({ path, page: gpsResults.page + 1 });
      },
      retryRefresh() {
        if (path) setRequest({ path, page: 1 });
      },
      chooseGps() {
        setUseGps(true);
        if (place) router.replace("/", { scroll: false });
        location.requestLocation();
      },
      chooseCity() {
        setUseGps(false);
      },
    };
  }, [
    useGps,
    snapshot,
    request,
    failure,
    path,
    initialBusinesses,
    available,
    place,
    location,
    router,
  ]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
function useNearby() {
  const context = useContext(Context);
  if (!context) throw new Error("Nearby provider is missing");
  return context;
}

export function HomeNearbyControl() {
  const { location, chooseGps, chooseCity, place, useGps, refresh } = useNearby();
  return (
    <div className={styles.controls}>
      {useGps && location.point ? (
        <span className={styles.current} role="status">
          <Icon name="pin" />
          {refresh === "pending"
            ? "Osvježavamo rezultate…"
            : refresh === "failed"
              ? "Rezultati za prethodnu lokaciju"
              : `Moja lokacija · ${nearbyRadiusKm} km`}
        </span>
      ) : location.permission === "denied" ? (
        <span className={styles.current}>Lokacija je isključena</span>
      ) : (
        <button
          type="button"
          className={styles.locate}
          disabled={location.status === "locating"}
          onClick={chooseGps}
        >
          <Icon name="pin" />
          {location.status === "locating" ? "Pronalazimo lokaciju…" : "Koristi moju lokaciju"}
        </button>
      )}
      <details className={styles.city}>
        <summary>{!useGps && place ? place : "Odaberi grad"}</summary>
        <Form
          action="/"
          className={styles.form}
          onSubmit={(event) => {
            const city = new FormData(event.currentTarget).get("mjesto");
            if (typeof city !== "string" || !city.trim()) {
              event.preventDefault();
              return;
            }
            chooseCity();
          }}
        >
          <label htmlFor="home-place" className={styles.srOnly}>
            Grad ili mjesto
          </label>
          <input
            id="home-place"
            name="mjesto"
            placeholder="Grad ili mjesto"
            defaultValue={place}
            maxLength={100}
            required
          />
          <button type="submit" aria-label="Prikaži djelatnosti u ovom mjestu">
            <Icon name="search" />
          </button>
        </Form>
      </details>
    </div>
  );
}

export function HomeNearbyResults({ exampleId }: { exampleId?: string }) {
  const { businesses, state, place, useGps, location, refresh, retryRefresh } = useNearby();
  if (state === "unavailable")
    return (
      <>
        <HomeEmptyState>Imenik trenutno nije dostupan.</HomeEmptyState>
        {useGps && (
          <button onClick={retryRefresh} type="button" className={styles.more}>
            Pokušaj ponovo
          </button>
        )}
      </>
    );
  if (state === "loading")
    return (
      <HomeEmptyState icon="pin">
        <span role="status">Tražimo djelatnosti u blizini…</span>
      </HomeEmptyState>
    );
  if (state === "waiting")
    return location.status === "unavailable" ? (
      <p className={homeStyles.availability}>Lokacija nije dostupna. Odaberi grad.</p>
    ) : null;
  if (!businesses.length)
    return (
      <div className={styles.group}>
        <p className={homeStyles.availability}>
          {refresh
            ? "Nema rezultata za prethodnu lokaciju."
            : useGps
              ? "U tvojoj blizini još nema objavljenih djelatnosti."
              : `Još nema objavljenih djelatnosti za ${place}.`}
        </p>
        <Link className={homeStyles.subtleLink} href="/pretraga">
          Istraži sve djelatnosti <Icon name="arrow" />
        </Link>
        {refresh === "failed" && (
          <button onClick={retryRefresh} type="button" className={styles.more}>
            Pokušaj ponovo
          </button>
        )}
      </div>
    );
  return <NearbyCards exampleId={exampleId} />;
}

function NearbyCards({ exampleId }: { exampleId?: string }) {
  const { businesses, hasMore, useGps, place, refresh, pagination, loadMore, retryRefresh } =
    useNearby();
  const [expanded, setExpanded] = useState(false);
  const moreAvailable = businesses.length > 6 || hasMore;
  const featured = businesses.filter((business) => business.localFeatured);
  const others = businesses.filter((business) => !business.localFeatured);
  const sample = others.find((business) => business.id === exampleId);
  const ordered = sample
    ? [...featured, sample, ...others.filter((business) => business.id !== sample.id)]
    : [...featured, ...others];
  const selected = expanded ? ordered : ordered.slice(0, 6);
  return (
    <>
      <HomeBusinessRail
        label="Djelatnosti u blizini"
        cards={selected.map((business) => (
          <DirectoryResultCard
            key={business.id}
            business={business}
            compact
            example={business.id === sample?.id}
          />
        ))}
        expanded={expanded}
      />
      {!useGps && moreAvailable && (
        <Link className={styles.more} href={`/pretraga?mjesto=${encodeURIComponent(place)}`}>
          Sve djelatnosti u ovom mjestu
        </Link>
      )}
      {useGps && !expanded && moreAvailable && (
        <button className={styles.more} onClick={() => setExpanded(true)} type="button">
          Sve u blizini
        </button>
      )}
      {useGps && expanded && hasMore && refresh !== "failed" && (
        <button
          className={styles.more}
          type="button"
          disabled={refresh === "pending" || pagination === "pending"}
          onClick={loadMore}
        >
          {pagination === "failed"
            ? "Pokušaj ponovo"
            : pagination === "pending"
              ? "Učitavanje…"
              : "Prikaži još"}
        </button>
      )}
      {refresh === "failed" && (
        <button className={styles.more} type="button" onClick={retryRefresh}>
          Pokušaj ponovo
        </button>
      )}
    </>
  );
}
