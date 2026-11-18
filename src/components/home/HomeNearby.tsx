"use client";

import Form from "next/form";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { nearbyDirectoryPath, readNearbyBusinesses } from "../../lib/home-nearby";
import type { PublicBusinessView } from "../../lib/public-business";
import { DirectoryResultCard } from "../directory/DirectoryResultCard";
import { Icon } from "../Icon";
import { useDeviceLocation } from "../location/DeviceLocation";
import { HomeEmptyState } from "./HomeSurface";
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
  categoryOptions: NearbyProps["categories"];
  searchPath: string | null;
  hasMore: boolean;
  location: ReturnType<typeof useDeviceLocation>;
  chooseGps: () => void;
  chooseCity: () => void;
};
const Context = createContext<NearbyContext | null>(null);

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
  const [response, setResponse] = useState<{
    path: string;
    items: PublicBusinessView[];
    hasMore: boolean;
    state: "loading" | "ready" | "unavailable";
  } | null>(null);
  useEffect(() => {
    if (!path) {
      setResponse(null);
      return;
    }
    let current = true;
    const abort = new AbortController();
    const timeout = window.setTimeout(() => abort.abort(), 12_000);
    setResponse({ path, items: [], hasMore: false, state: "loading" });
    void (async () => {
      try {
        const result = await fetch(path, {
          signal: abort.signal,
          cache: "no-store",
          credentials: "omit",
          mode: "same-origin",
          redirect: "error",
        });
        if (!result.ok) throw new Error("DIRECTORY_UNAVAILABLE");
        const data = await result.json();
        const items = readNearbyBusinesses(data, categories);
        if (current && !abort.signal.aborted)
          setResponse({ path, items, hasMore: data.hasMore, state: "ready" });
      } catch {
        if (current) setResponse({ path, items: [], hasMore: false, state: "unavailable" });
      } finally {
        window.clearTimeout(timeout);
      }
    })();
    return () => {
      current = false;
      window.clearTimeout(timeout);
      abort.abort();
    };
  }, [path, categories]);
  const value = useMemo<NearbyContext>(
    () => ({
      businesses: useGps ? (response?.path === path ? response.items : []) : initialBusinesses,
      state: !useGps
        ? available
          ? "ready"
          : "unavailable"
        : path
          ? response?.path === path
            ? response.state
            : "loading"
          : "waiting",
      place,
      useGps,
      location,
      categoryOptions: categories,
      searchPath: path,
      hasMore: response?.path === path && response.hasMore,
      chooseGps() {
        setUseGps(true);
        if (place) router.replace("/", { scroll: false });
        location.requestLocation();
      },
      chooseCity() {
        setUseGps(false);
      },
    }),
    [useGps, response, path, initialBusinesses, available, place, location, router, categories],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
function useNearby() {
  const context = useContext(Context);
  if (!context) throw new Error("Nearby provider is missing");
  return context;
}

export function HomeNearbyControl() {
  const { location, chooseGps, chooseCity, place, useGps } = useNearby();
  return (
    <div className={styles.controls}>
      {useGps && location.point ? (
        <span className={styles.current}>
          <Icon name="pin" /> Moja lokacija · 25 km
        </span>
      ) : location.permission === "denied" ? (
        <details className={styles.permission}>
          <summary>Lokacija je isključena</summary>
          <p>Uključi lokaciju u postavkama preglednika ili odaberi grad.</p>
        </details>
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
        <Form action="/" className={styles.form} onSubmit={chooseCity}>
          <label htmlFor="home-place" className={styles.srOnly}>
            Grad ili mjesto
          </label>
          <input
            id="home-place"
            name="mjesto"
            placeholder="Grad ili mjesto"
            defaultValue={place}
            maxLength={100}
          />
          <button type="submit" aria-label="Prikaži djelatnosti u ovom mjestu">
            <Icon name="search" />
          </button>
        </Form>
      </details>
    </div>
  );
}

export function HomeNearbyResults() {
  const { businesses, state, place, useGps, location, searchPath } = useNearby();
  if (state === "unavailable")
    return <HomeEmptyState>Imenik trenutno nije dostupan.</HomeEmptyState>;
  if (state === "loading")
    return (
      <HomeEmptyState icon="pin">
        <span role="status">Tražimo djelatnosti u blizini…</span>
      </HomeEmptyState>
    );
  if (state === "waiting")
    return (
      <HomeEmptyState icon="pin">
        {location.status === "unavailable"
          ? "Lokacija nije dostupna. Možeš odabrati grad."
          : location.status === "locating"
            ? "Pronalazimo tvoju lokaciju…"
            : "Dozvoli lokaciju za prikaz djelatnosti u blizini."}
      </HomeEmptyState>
    );
  if (!businesses.length)
    return (
      <HomeEmptyState>
        {useGps
          ? "Još nema objavljenih djelatnosti u blizini."
          : `Još nema objavljenih djelatnosti za ${place}.`}
      </HomeEmptyState>
    );
  return <NearbyCards key={searchPath ?? place} />;
}

function NearbyCards() {
  const { businesses, hasMore, searchPath, useGps, categoryOptions, place } = useNearby();
  const [expanded, setExpanded] = useState(false);
  const [request, setRequest] = useState({ page: 1 });
  const [more, setMore] = useState({ items: [] as PublicBusinessView[], page: 1, hasMore });
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const { page } = request;
    if (!searchPath || page === 1) return;
    const abort = new AbortController();
    let active = true;
    const timer = window.setTimeout(() => abort.abort(), 12_000);
    setFailed(false);
    async function fetchPage() {
      try {
        const result = await fetch(`${searchPath}&page=${page}`, {
          signal: abort.signal,
          cache: "no-store",
          credentials: "omit",
          mode: "same-origin",
          redirect: "error",
        });
        if (!result.ok) throw new Error("DIRECTORY_UNAVAILABLE");
        const data = await result.json();
        const items = readNearbyBusinesses(data, categoryOptions, page);
        if (active)
          setMore((previous) => ({
            items: [...previous.items, ...items],
            page,
            hasMore: data.hasMore,
          }));
      } catch {
        if (active) setFailed(true);
      } finally {
        window.clearTimeout(timer);
      }
    }
    void fetchPage();
    return () => {
      active = false;
      abort.abort();
      window.clearTimeout(timer);
    };
  }, [request, searchPath, categoryOptions]);
  const combined = expanded
    ? [...new Map([...businesses, ...more.items].map((item) => [item.id, item])).values()]
    : businesses.slice(0, 4);
  return (
    <>
      {combined.map((business) => (
        <DirectoryResultCard key={business.id} business={business} />
      ))}
      {!useGps && businesses.length > 4 && (
        <Link className={styles.more} href={`/pretraga?mjesto=${encodeURIComponent(place)}`}>
          Sve djelatnosti u ovom mjestu
        </Link>
      )}
      {useGps && !expanded && businesses.length > 4 && (
        <button className={styles.more} onClick={() => setExpanded(true)} type="button">
          Sve u blizini
        </button>
      )}
      {useGps && expanded && more.hasMore && (
        <button
          className={styles.more}
          type="button"
          disabled={request.page > more.page && !failed}
          onClick={() => setRequest({ page: more.page + 1 })}
        >
          {failed ? "Pokušaj ponovo" : request.page > more.page ? "Učitavanje…" : "Prikaži još"}
        </button>
      )}
    </>
  );
}
