"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { accountShortcuts } from "../../lib/account-shortcuts";
import {
  countryKey,
  type MapCountry,
  type MapPin,
  mapPlaces,
  mapTotals,
  nearestCity,
} from "../../lib/business-map";
import { bosnianForm, msg } from "../../lib/i18n/translate";
import { countryLabel } from "../../lib/people";
import { AhiLogo } from "../brand/AhiLogo";
import { Icon } from "../Icon";
import { useI18n } from "../i18n/LocaleProvider";
import { useDeviceLocation } from "../location/DeviceLocation";
import { DotGlobe } from "./DotGlobe";
import { MapPlaces } from "./MapPlaces";
import styles from "./world-map.module.css";

/** How many countries the sheet under the globe shows before "Svih …". */
const shownCountries = 4;
/** If the globe never reports that it has turned, the country opens anyway after this long. */
const turnPatience = 1100;

function sameText(a: string, b: string) {
  return a.trim().toLocaleLowerCase("bs") === b.trim().toLocaleLowerCase("bs");
}

/**
 * The map of the network. It opens as a slowly turning globe with a light wherever AhiBizz has
 * a business; a country opens the Google map of that country with its cities, and a city opens
 * its streets with a pin for every business. Where it stands is kept in the address
 * (`?drzava=BA&grad=Sarajevo`), so Back and a shared link do what a person expects.
 */
export function WorldMap({
  pins,
  countries,
  path = "/mapa",
}: {
  pins: MapPin[];
  countries: MapCountry[];
  /** Where the map lives; the stage is kept in this address.  */
  path?: string;
}) {
  const { t, locale } = useI18n();
  const search = useSearchParams();
  const pinParam = search.get("djelatnost");
  const linked = pinParam ? (pins.find((pin) => pin.id === pinParam) ?? null) : null;
  const cityParam = search.has("grad") ? search.get("grad") : linked ? (linked.city ?? "") : null;
  // A link may name only a business or only a city (the map side of search); its country follows.
  const cityHome =
    cityParam && !search.has("drzava") && !linked
      ? countries.find((item) => item.cities.some((entry) => sameText(entry.name, cityParam)))
      : null;
  const countryParam =
    search.get("drzava") ??
    (linked ? countryKey(linked.country) : cityHome ? countryKey(cityHome.code) : null);
  const country =
    (countryParam && countries.find((item) => sameText(countryKey(item.code), countryParam))) ||
    null;
  const streets = Boolean(country) && cityParam !== null;
  const city =
    (country && cityParam && country.cities.find((item) => sameText(item.name, cityParam))) || null;
  const stage = !country ? "globe" : streets ? "city" : "country";

  const [leaving, setLeaving] = useState<MapCountry | null>(null);
  const [everOpened, setEverOpened] = useState(false);
  const [allCountries, setAllCountries] = useState(false);
  const waiting = useRef<{ key: string; timer: number } | null>(null);
  const location = useDeviceLocation({ active: true });

  const places = useMemo(() => mapPlaces(pins), [pins]);
  const totals = useMemo(() => mapTotals(pins, countries), [pins, countries]);
  const here = useMemo(
    () =>
      location.point
        ? nearestCity(
            countries.flatMap((item) => item.cities),
            location.point,
          )
        : null,
    [countries, location.point],
  );

  useEffect(() => {
    if (country) setEverOpened(true);
  }, [country]);

  const go = useCallback(
    (next: { country?: string | null; city?: string | null }) => {
      const parameters = new URLSearchParams();
      if (next.country) {
        parameters.set("drzava", next.country);
        if (next.city !== undefined && next.city !== null) parameters.set("grad", next.city);
      }
      const query = parameters.toString();
      window.history.pushState(null, "", query ? `${path}?${query}` : path);
    },
    [path],
  );

  const arrived = useCallback(() => {
    const pending = waiting.current;
    if (!pending) return;
    window.clearTimeout(pending.timer);
    waiting.current = null;
    setLeaving(null);
    go({ country: pending.key });
  }, [go]);
  useEffect(
    () => () => {
      if (waiting.current) window.clearTimeout(waiting.current.timer);
    },
    [],
  );

  function openCountry(item: MapCountry) {
    if (waiting.current) return;
    // The globe first turns the country to the front; then the map of the country takes over.
    waiting.current = {
      key: countryKey(item.code),
      timer: window.setTimeout(arrived, turnPatience),
    };
    setLeaving(item);
  }

  const name = (item: MapCountry) =>
    item.code ? countryLabel(item.code, locale) || item.name : t("Ostalo");
  const listed = allCountries ? countries : countries.slice(0, shownCountries);

  return (
    <div className={styles.screen} data-stage={stage} data-map-stage={stage}>
      <div className={styles.world} inert={stage !== "globe"}>
        <header className={styles.top}>
          <div>
            <AhiLogo className={styles.logo} />
            <span>{t("Naša mreža, naša snaga")}</span>
          </div>
          <Link href="/" className={styles.round} aria-label={t("Zatvori mapu")}>
            <Icon name="close" />
          </Link>
        </header>
        {totals.businesses > 0 ? (
          <p className={styles.totals}>
            <strong>{totals.businesses}</strong>
            <span>
              {[
                t("{count|djelatnost|djelatnosti}", { count: totals.businesses }),
                totals.countries > 0 &&
                  t(
                    bosnianForm(
                      totals.countries,
                      msg("u {count} državi"),
                      msg("u {count} države"),
                      msg("u {count} država"),
                    ),
                    { count: totals.countries },
                  ),
                totals.cities > 0 &&
                  t(
                    bosnianForm(
                      totals.cities,
                      msg("i {count} gradu"),
                      msg("i {count} grada"),
                      msg("i {count} gradova"),
                    ),
                    { count: totals.cities },
                  ),
              ]
                .filter(Boolean)
                .join(" ")}
            </span>
          </p>
        ) : (
          <p className={styles.totals}>
            <span>{t("Ovdje će se vidjeti gdje nas sve ima.")}</span>
          </p>
        )}
        <div className={styles.stage}>
          <DotGlobe
            className={styles.globe}
            lights={places}
            label={t("Globus s mjestima u kojima ima AhiBizz djelatnosti")}
            interactive
            paused={stage !== "globe" && !leaving}
            focus={leaving}
            onArrive={arrived}
            onPick={(index) => {
              const place = places[index];
              const item =
                place && countries.find((entry) => countryKey(entry.code) === place.country);
              if (item) openCountry(item);
            }}
          />
          {here && (
            <p className={styles.here}>
              <span aria-hidden="true" />
              {t("Ti si ovdje · {city}", { city: here.name })}
            </p>
          )}
        </div>
        <section
          className={styles.sheet}
          aria-label={t("Djelatnosti po državama")}
          data-open={allCountries || undefined}
        >
          <span className={styles.handle} aria-hidden="true" />
          {countries.length ? (
            <>
              <div className={styles.sheetHead}>
                <h1>{t("Djelatnosti po državama")}</h1>
                {countries.length > shownCountries && (
                  <button type="button" onClick={() => setAllCountries(!allCountries)}>
                    {allCountries ? t("Manje") : t("Svih {count}", { count: countries.length })}
                  </button>
                )}
              </div>
              <ul className={styles.countries}>
                {listed.map((item) => (
                  <li key={item.code ?? "other"}>
                    <button type="button" onClick={() => openCountry(item)}>
                      <span className={styles.code} aria-hidden="true">
                        {item.code ?? "··"}
                      </span>
                      <span className={styles.countryName}>{name(item)}</span>
                      <strong>{item.count}</strong>
                      <Icon name="chevron" />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className={styles.empty}>
              <h1>{t("Još nema djelatnosti s lokacijom")}</h1>
              <p>
                {t("Čim prva djelatnost bude objavljena s lokacijom, zasvijetliće na globusu.")}
              </p>
              <Link href={accountShortcuts.newBusiness}>{t("Objavi djelatnost")}</Link>
            </div>
          )}
        </section>
      </div>
      {(everOpened || country) && (
        <MapPlaces
          pins={pins}
          country={country}
          city={city}
          streets={streets}
          selected={linked?.id ?? null}
          onWorld={() => go({})}
          onCountry={(item) => go({ country: countryKey(item.code) })}
          onCity={(item, cityName) => go({ country: countryKey(item.code), city: cityName })}
        />
      )}
    </div>
  );
}
