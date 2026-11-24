"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  type BusinessLocationResult,
  isLocationPoint,
  type LocationPoint,
} from "../../lib/business-location";
import { addressAtPoint, searchLocations } from "../../lib/geocoding";
import { Icon } from "../Icon";
import { useT } from "../i18n/LocaleProvider";
import { LocationMap } from "./LocationMap";
import styles from "./location.module.css";

export type LocationSelection = {
  point: LocationPoint | null;
  address?: Pick<BusinessLocationResult, "addressLine" | "city" | "countryCode">;
};
export function LocationPicker({
  value,
  disabled,
  onChange,
  onPending,
}: {
  value: LocationPoint | null;
  disabled: boolean;
  onChange: (selection: LocationSelection) => void;
  onPending: (pending: boolean) => void;
}) {
  const t = useT();
  const id = useId();
  const [query, setQuery] = useState("");
  const [candidate, setCandidate] = useState<LocationPoint | null>(value);
  const [results, setResults] = useState<BusinessLocationResult[]>([]);
  const [phase, setPhase] = useState<"idle" | "search" | "gps" | "reverse">("idle");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingPin, setPendingPin] = useState(false);
  const requests = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const alive = useRef(true);
  const change = useRef(onChange);
  change.current = onChange;
  const pending = useRef(onPending);
  pending.current = onPending;
  const inFlight = useRef(false);
  const pinPending = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      revision.current++;
      requests.current?.abort();
      pending.current(false);
    };
  }, []);
  function begin(next: typeof phase) {
    if (inFlight.current || disabled) return null;
    inFlight.current = true;
    requests.current?.abort();
    const controller = new AbortController();
    requests.current = controller;
    const current = ++revision.current;
    setPhase(next);
    setResults([]);
    setError("");
    setNotice("");
    pending.current(true);
    return { controller, current };
  }
  function finish(current: number) {
    if (alive.current && current === revision.current) {
      inFlight.current = false;
      setPhase("idle");
      pending.current(pinPending.current);
    }
  }
  async function search() {
    if (query.trim().length < 3) {
      setError(t("Upiši barem tri znaka."));
      return;
    }
    const task = begin("search");
    if (!task) return;
    try {
      const found = await searchLocations(query, task.controller.signal);
      if (!alive.current || task.current !== revision.current) return;
      setResults(found);
      if (!found.length) setNotice(t("Nema rezultata. Pokušaj adresu ili označi mjesto na karti."));
    } catch {
      if (alive.current && task.current === revision.current)
        setError(t("Pretraga trenutno nije dostupna. Koristi GPS ili označi mjesto na karti."));
    } finally {
      finish(task.current);
    }
  }
  function choose(result: BusinessLocationResult) {
    if (disabled || inFlight.current) return;
    revision.current++;
    requests.current?.abort();
    pinPending.current = false;
    setCandidate(result.point);
    setPendingPin(false);
    setResults([]);
    setQuery(result.label);
    setError("");
    setNotice(t("Lokacija je odabrana."));
    pending.current(false);
    change.current({
      point: result.point,
      address: {
        addressLine: result.addressLine,
        city: result.city,
        countryCode: result.countryCode,
      },
    });
  }
  async function commitPoint(point: LocationPoint, fromGps = false) {
    const task = begin(fromGps ? "gps" : "reverse");
    if (!task) return;
    pinPending.current = false;
    setCandidate(point);
    setPendingPin(false);
    setResults([]);
    try {
      const address = await addressAtPoint(point, task.controller.signal);
      if (!alive.current || task.current !== revision.current) return;
      // The exact GPS/pin remains authoritative. The nearest feature supplies text only.
      change.current({
        point,
        address: {
          addressLine: address?.addressLine ?? null,
          city: address?.city ?? null,
          countryCode: address?.countryCode ?? null,
        },
      });
      setNotice(
        address
          ? t("Lokacija je odabrana. Provjeri adresu ispod.")
          : t("Lokacija je odabrana. Adresu možeš dopuniti ispod."),
      );
    } catch {
      if (alive.current && task.current === revision.current) {
        change.current({ point, address: { addressLine: null, city: null, countryCode: null } });
        setNotice(t("Lokacija je odabrana. Adresu možeš dopuniti ispod."));
      }
    } finally {
      finish(task.current);
    }
  }
  function locate() {
    const task = begin("gps");
    if (!task) return;
    if (!navigator.geolocation) {
      setError(t("GPS nije podržan. Odaberi mjesto na karti ili putem pretrage."));
      finish(task.current);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!alive.current || task.current !== revision.current) return;
        const point = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
        finish(task.current);
        if (!isLocationPoint(point)) {
          setError(t("Lokacija nije dostupna. Pokušaj ponovo."));
          return;
        }
        void commitPoint(point, true);
      },
      (failure) => {
        if (!alive.current || task.current !== revision.current) return;
        setError(
          failure.code === 1
            ? t(
                "Pristup lokaciji nije dozvoljen. Uključi ga u pregledniku ili odaberi mjesto na karti.",
              )
            : t("Lokacija nije dostupna. Pokušaj ponovo ili koristi pretragu."),
        );
        finish(task.current);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  }
  return (
    <section className={styles.picker} aria-label={t("Odaberi lokaciju djelatnosti")}>
      <button
        type="button"
        className={styles.gps}
        disabled={disabled || phase !== "idle"}
        onClick={locate}
      >
        <Icon name="pin" />
        {phase === "gps" ? t("Pronalazim lokaciju…") : t("Koristi moju lokaciju")}
      </button>
      <div className={styles.search}>
        <label htmlFor={id}>{t("Adresa ili naziv firme")}</label>
        <div>
          <input
            id={id}
            value={query}
            maxLength={160}
            placeholder={t("Naziv, ulica ili grad")}
            disabled={disabled || phase !== "idle"}
            onChange={(event) => {
              setQuery(event.target.value);
              setResults([]);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void search();
              }
            }}
          />
          <button
            type="button"
            disabled={disabled || phase !== "idle"}
            onClick={() => void search()}
            aria-label={t("Pretraži lokacije")}
          >
            <Icon name="search" />
          </button>
        </div>
      </div>
      {results.length > 0 && (
        <ul className={styles.results}>
          {results.map((result) => (
            <li key={result.id}>
              <button
                type="button"
                disabled={disabled || phase !== "idle"}
                onClick={() => choose(result)}
              >
                <Icon name="pin" />
                <span>{result.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
      <LocationMap
        point={candidate}
        disabled={disabled || phase !== "idle"}
        onPoint={(point) => {
          pinPending.current = true;
          setCandidate(point);
          setPendingPin(true);
          pending.current(true);
          setNotice("");
          setError("");
        }}
      />
      {pendingPin && candidate && (
        <button
          type="button"
          className={styles.confirm}
          disabled={disabled || phase !== "idle"}
          onClick={() => void commitPoint(candidate)}
        >
          {t("Koristi označeno mjesto")}
        </button>
      )}
      {phase === "reverse" && (
        <p role="status" className={styles.notice}>
          {t("Prepoznajem adresu…")}
        </p>
      )}
      <div className={styles.footer}>
        <span>
          {pendingPin
            ? t("Potvrdi označeno mjesto.")
            : value
              ? t("Lokacija je postavljena.")
              : t("Dodirni kartu za odabir mjesta.")}
        </span>
        {value && !pendingPin && (
          <button
            type="button"
            disabled={disabled || phase !== "idle"}
            onClick={() => {
              setCandidate(null);
              setResults([]);
              setNotice("");
              change.current({ point: null });
            }}
          >
            {t("Ukloni")}
          </button>
        )}
      </div>
      <small className={styles.credit}>
        {t("Upit i odabrana tačka šalju se servisu")}{" "}
        <a href="https://photon.komoot.io/" target="_blank" rel="noreferrer">
          Photon
        </a>{" "}
        . Kartu pruža{" "}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap
        </a>
      </small>
    </section>
  );
}
