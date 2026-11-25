"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  cityPins,
  countryKey,
  countryPins,
  distanceLabel,
  type MapBounds,
  type MapCity,
  type MapCountry,
  type MapPin,
  mapMarkers,
  pinMatches,
  pointBounds,
} from "../../lib/business-map";
import { distanceMetres } from "../../lib/device-location";
import { streetsFromZoom } from "../../lib/google-maps";
import { categoryIcon } from "../../lib/home";
import { bosnianForm, msg } from "../../lib/i18n/translate";
import { localNumber } from "../../lib/number-format";
import { countryLabel } from "../../lib/people";
import { safeBusinessImage } from "../../lib/public-business";
import { AhiMark } from "../AhiMark";
import { BusinessOpenStatus } from "../directory/BusinessDetails";
import { Icon } from "../Icon";
import { useI18n } from "../i18n/LocaleProvider";
import { useDeviceLocation } from "../location/DeviceLocation";
import { VerificationBadge } from "../VerificationBadge";
import { OnMap } from "./OnMap";
import { useStyledMap } from "./useStyledMap";
import styles from "./world-map.module.css";

/** A city's circle grows with the root of its number of businesses, as on the drawing. */
function bubbleSize(count: number) {
  return Math.round(Math.min(64, 26.2 + 3.35 * Math.sqrt(count)));
}
/** How many cities carry their name under the circle; more would cover the map in words. */
const namedCities = 5;
/** The list under the country shows this many businesses; the map shows them all. */
const listedBusinesses = 40;
/** Room the fitted pins keep clear of the bars over the map, in pixels. */
const countryRoom = { top: 84, right: 44, bottom: 40, left: 44 };
const streetRoom = { top: 150, right: 56, bottom: 250, left: 56 };
/** On a wide screen the sheet is a panel on the left, and the pins keep clear of that instead. */
function room(kind: "country" | "streets") {
  const base = kind === "country" ? countryRoom : streetRoom;
  return window.matchMedia("(min-width: 900px)").matches
    ? { top: 84, right: 56, bottom: 56, left: 440 }
    : base;
}

function photo(src: string | null) {
  return src ? safeBusinessImage({ src, alt: "" }) : undefined;
}

function within(pin: MapPin, box: MapBounds) {
  const tall = (box.north - box.south) * 0.2;
  const wide = (box.east - box.west) * 0.2;
  const east = box.east + wide;
  const west = box.west - wide;
  const inLatitude = pin.latitude <= box.north + tall && pin.latitude >= box.south - tall;
  // A view across the date line has its west edge east of its east edge.
  const inLongitude =
    west <= east
      ? pin.longitude >= west && pin.longitude <= east
      : pin.longitude >= west || pin.longitude <= east;
  return inLatitude && inLongitude;
}

/**
 * The Google map under the globe: a country with a circle for each of its cities, then the
 * streets of a city with a pin for every business. The map is made once and keeps its place
 * while the person moves between a country and its cities.
 */
export function MapPlaces({
  pins,
  country,
  city,
  streets,
  selected: linked,
  onWorld,
  onCountry,
  onCity,
}: {
  pins: MapPin[];
  /** The country in the address; null while the globe is in front. */
  country: MapCountry | null;
  city: MapCity | null;
  /** True when the address asks for the streets, with or without a known city. */
  streets: boolean;
  /** The business a link asked to show. */
  selected: string | null;
  onWorld: () => void;
  onCountry: (country: MapCountry) => void;
  onCity: (country: MapCountry, city: string) => void;
}) {
  const { t, locale } = useI18n();
  // The last country stays drawn while the screen returns to the globe.
  const [kept, setKept] = useState(country);
  useEffect(() => {
    if (country) setKept(country);
  }, [country]);
  const shown = country ?? kept;

  const target = useRef<HTMLDivElement>(null);
  const [start] = useState(() => ({
    lat: shown?.latitude ?? 44.1,
    lng: shown?.longitude ?? 17.8,
  }));
  const { state, map, maps } = useStyledMap(target, {
    centre: start,
    zoom: 6,
    kind: "auto",
    minZoom: 3,
  });
  const location = useDeviceLocation({ active: true });
  const [zoom, setZoom] = useState(6);
  const [box, setBox] = useState<MapBounds | null>(null);
  const [selected, setSelected] = useState(linked);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [chip, setChip] = useState<string | null>(null);
  const pressed = useRef(0);
  const wantMe = useRef(false);

  const key = shown ? countryKey(shown.code) : null;
  const inCountry = useMemo(() => (key ? countryPins(pins, key) : []), [pins, key]);
  const cityName = city?.name ?? null;
  const inCity = useMemo(
    () => (cityName ? cityPins(inCountry, cityName) : []),
    [inCountry, cityName],
  );
  const chosen = selected ? (pins.find((pin) => pin.id === selected) ?? null) : null;

  // A link to one business selects it; leaving the streets lets it go.
  useEffect(() => setSelected(linked), [linked]);
  useEffect(() => {
    if (!streets) {
      setSelected(null);
      setQuery("");
      setCategory(null);
    }
  }, [streets]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new country starts with all of its cities.
  useEffect(() => setChip(null), [key]);

  useEffect(() => {
    if (!map) return;
    const read = () => {
      setZoom(map.getZoom() ?? 6);
      const bounds = map.getBounds();
      if (!bounds) return;
      const north = bounds.getNorthEast();
      const south = bounds.getSouthWest();
      setBox({ south: south.lat(), west: south.lng(), north: north.lat(), east: north.lng() });
    };
    const listeners = [
      map.addListener("idle", read),
      map.addListener("zoom_changed", () => setZoom(map.getZoom() ?? 6)),
      // A touch on the bare map lets go of the chosen business; a touch on a pin is not one.
      map.addListener("click", () => {
        if (performance.now() - pressed.current > 120) setSelected(null);
      }),
    ];
    return () => {
      for (const listener of listeners) listener.remove();
    };
  }, [map]);

  // Frame what the address names: the whole country, or the streets of the city or business.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the pins of a country or city change only with its name; a selection made by hand must not move the frame.
  useEffect(() => {
    if (!map || !country) return;
    if (!streets) {
      map.setOptions({ minZoom: 3, maxZoom: streetsFromZoom - 1 });
      const bounds = pointBounds(inCountry);
      if (bounds) map.fitBounds(bounds, room("country"));
      return;
    }
    map.setOptions({ minZoom: streetsFromZoom, maxZoom: 21 });
    const one = linked ? pins.find((pin) => pin.id === linked) : null;
    const frame = one ? [one] : inCity.length ? inCity : inCountry;
    if (frame.length === 1 && frame[0]) {
      map.setCenter({ lat: frame[0].latitude, lng: frame[0].longitude });
      map.setZoom(16);
      return;
    }
    const bounds = pointBounds(frame);
    if (bounds) map.fitBounds(bounds, room("streets"));
  }, [map, key, streets, cityName, linked, Boolean(country)]);

  useEffect(() => {
    if (!map || !wantMe.current || !location.point) return;
    wantMe.current = false;
    map.panTo({ lat: location.point.latitude, lng: location.point.longitude });
  }, [map, location.point]);

  const filtered = useMemo(
    () => pins.filter((pin) => (!category || pin.category === category) && pinMatches(pin, query)),
    [pins, category, query],
  );
  const markers = useMemo(() => {
    if (!streets || !box) return [];
    const inView = filtered.filter((pin) => pin.id === selected || within(pin, box));
    return mapMarkers(inView, zoom, { keep: selected ?? undefined });
  }, [streets, box, filtered, zoom, selected]);
  const categories = useMemo(
    () =>
      [
        ...new Set(
          (inCity.length ? inCity : inCountry).flatMap((pin) =>
            pin.category ? [pin.category] : [],
          ),
        ),
      ].slice(0, 6),
    [inCity, inCountry],
  );
  const listed = useMemo(() => {
    const from = chip ? cityPins(inCountry, chip) : inCountry;
    return [...from]
      .sort(
        (a, b) =>
          Number(b.verified) - Number(a.verified) ||
          (b.rating ?? 0) - (a.rating ?? 0) ||
          a.title.localeCompare(b.title, "bs"),
      )
      .slice(0, listedBusinesses);
  }, [inCountry, chip]);

  if (!shown) return null;
  const stage = streets ? "city" : "country";
  const name = shown.code ? countryLabel(shown.code, locale) || shown.name : t("Ostalo");
  const cities = shown.cities;
  const opens = chip ?? cities[0]?.name ?? "";
  const select = (id: string) => {
    pressed.current = performance.now();
    setSelected(id);
  };
  const rating = (value: number) =>
    localNumber(locale, value, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const chosenPhoto = photo(chosen?.image ?? null);
  const directions = chosen
    ? `https://www.google.com/maps/dir/?${new URLSearchParams({
        api: "1",
        destination: `${chosen.latitude},${chosen.longitude}`,
      })}`
    : "";

  return (
    <div className={styles.places} data-stage={stage} inert={!country}>
      <div className={styles.map} data-state={state}>
        <div ref={target} className={styles.mapCanvas} />
        {state === "unavailable" && (
          <p className={styles.mapOff} role="status">
            {t("Mapa trenutno nije dostupna.")}
          </p>
        )}
      </div>

      {map &&
        maps &&
        !streets &&
        cities.map((item, index) => (
          <OnMap
            key={item.name}
            map={map}
            maps={maps}
            latitude={item.latitude}
            longitude={item.longitude}
            order={cities.length - index}
            onPress={() => onCity(shown, item.name)}
          >
            <button
              type="button"
              className={styles.bubble}
              style={{ width: bubbleSize(item.count), height: bubbleSize(item.count) }}
              aria-label={`${item.name}, ${t(
                bosnianForm(
                  item.count,
                  msg("{count} djelatnost"),
                  msg("{count} djelatnosti"),
                  msg("{count} djelatnosti"),
                ),
                { count: item.count },
              )}`}
            >
              {item.count}
              {index < namedCities && (
                <span className={styles.bubbleName} aria-hidden="true">
                  {item.name}
                </span>
              )}
            </button>
          </OnMap>
        ))}

      {map &&
        maps &&
        markers.map((marker) =>
          marker.type === "pin" ? (
            <OnMap
              key={marker.pin.id}
              map={map}
              maps={maps}
              latitude={marker.pin.latitude}
              longitude={marker.pin.longitude}
              order={marker.pin.id === selected ? 3 : 2}
              onPress={() => select(marker.pin.id)}
            >
              <button
                type="button"
                className={styles.pin}
                data-selected={marker.pin.id === selected || undefined}
                aria-pressed={marker.pin.id === selected}
                aria-label={marker.pin.title}
              >
                <span className={styles.pinHead}>
                  <Icon name={categoryIcon(marker.pin.category ?? marker.pin.kind ?? "")} />
                  {marker.pin.verified && (
                    <span className={styles.pinCheck}>
                      <Icon name="check" />
                    </span>
                  )}
                </span>
                <span className={styles.pinTip} />
                {marker.pin.id === selected && (
                  <span className={styles.pinName} aria-hidden="true">
                    {marker.pin.title}
                  </span>
                )}
              </button>
            </OnMap>
          ) : (
            <OnMap
              key={marker.id}
              map={map}
              maps={maps}
              latitude={marker.latitude}
              longitude={marker.longitude}
              order={1}
              onPress={() => {
                pressed.current = performance.now();
                const members = pins.filter((pin) => marker.ids.includes(pin.id));
                const bounds = pointBounds(members);
                if (bounds) map.fitBounds(bounds, room("streets"));
              }}
            >
              <button
                type="button"
                className={styles.group}
                aria-label={t(
                  bosnianForm(
                    marker.count,
                    msg("{count} djelatnost na ovom mjestu"),
                    msg("{count} djelatnosti na ovom mjestu"),
                    msg("{count} djelatnosti na ovom mjestu"),
                  ),
                  { count: marker.count },
                )}
              >
                {marker.count}
              </button>
            </OnMap>
          ),
        )}

      {map && maps && location.point && (
        <OnMap
          map={map}
          maps={maps}
          latitude={location.point.latitude}
          longitude={location.point.longitude}
          order={0}
        >
          <span className={styles.me} role="img" aria-label={t("Moja lokacija")}>
            <span />
          </span>
        </OnMap>
      )}

      {streets ? (
        <div className={styles.search}>
          <div className={styles.searchRow}>
            <button
              type="button"
              className={styles.glassRound}
              onClick={() => onCountry(shown)}
              aria-label={t("Nazad na {country}", { country: name })}
            >
              <Icon name="chevron" data-back="" />
            </button>
            <label className={styles.field}>
              <Icon name="search" />
              <span className={styles.srOnly}>{t("Pretraži na mapi")}</span>
              <input
                type="search"
                value={query}
                maxLength={80}
                enterKeyHint="search"
                placeholder={cityName ?? name}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
          {categories.length > 1 && (
            <div className={styles.filters}>
              <button type="button" aria-pressed={!category} onClick={() => setCategory(null)}>
                {t("Sve")}
              </button>
              {categories.map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={category === item}
                  onClick={() => setCategory(category === item ? null : item)}
                >
                  {t(item)}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className={styles.back}>
          <button
            type="button"
            className={styles.glassRound}
            onClick={onWorld}
            aria-label={t("Nazad na globus")}
          >
            <Icon name="chevron" data-back="" />
          </button>
          <button type="button" className={styles.glassPill} onClick={onWorld}>
            <Icon name="globe" />
            {t("Cijeli svijet")}
          </button>
        </div>
      )}

      {streets ? (
        <div className={styles.foot}>
          <button
            type="button"
            className={styles.glassRound}
            data-size="large"
            aria-label={t("Moja lokacija")}
            onClick={() => {
              wantMe.current = true;
              location.requestLocation();
              if (location.point && map)
                map.panTo({ lat: location.point.latitude, lng: location.point.longitude });
            }}
          >
            <Icon name="locate" />
          </button>
          {chosen && (
            <section className={styles.card} aria-label={chosen.title}>
              <div className={styles.cardTop}>
                <span className={styles.cardPhoto}>
                  {chosenPhoto ? (
                    <Image src={chosenPhoto.src} alt="" width={64} height={64} unoptimized />
                  ) : (
                    <AhiMark size={28} />
                  )}
                </span>
                <div>
                  <h2>
                    <span dir="auto">{chosen.title}</span>
                    {chosen.verified && <VerificationBadge kind="business" />}
                  </h2>
                  <p>
                    {[
                      chosen.kind && t(chosen.kind),
                      location.point &&
                        distanceLabel(distanceMetres(location.point, chosen), locale),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <BusinessOpenStatus details={chosen.details} inline />
                </div>
              </div>
              <div className={styles.cardActions}>
                <a href={directions} target="_blank" rel="noreferrer" data-kind="main">
                  <Icon name="route" />
                  {t("Uputstva")}
                </a>
                <Link href={`/djelatnosti/${chosen.id}`}>{t("Otvori profil")}</Link>
              </div>
            </section>
          )}
        </div>
      ) : (
        <section className={styles.sheet} aria-label={name}>
          <span className={styles.handle} aria-hidden="true" />
          <h1 className={styles.country}>{name}</h1>
          <p className={styles.countryFacts}>
            {[
              t(
                bosnianForm(
                  shown.count,
                  msg("{count} djelatnost"),
                  msg("{count} djelatnosti"),
                  msg("{count} djelatnosti"),
                ),
                { count: shown.count },
              ),
              cities.length > 0 &&
                t(
                  bosnianForm(
                    cities.length,
                    msg("{count} grad"),
                    msg("{count} grada"),
                    msg("{count} gradova"),
                  ),
                  { count: cities.length },
                ),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {cities.length > 1 && (
            <div className={styles.cityChips}>
              <button type="button" aria-pressed={!chip} onClick={() => setChip(null)}>
                {t("Svi gradovi")}
              </button>
              {cities.map((item) => (
                <button
                  key={item.name}
                  type="button"
                  aria-pressed={chip === item.name}
                  onClick={() => setChip(chip === item.name ? null : item.name)}
                >
                  {item.name} · {item.count}
                </button>
              ))}
            </div>
          )}
          <ul className={styles.list}>
            {listed.map((pin) => {
              const image = photo(pin.image);
              return (
                <li key={pin.id}>
                  <Link href={`/djelatnosti/${pin.id}`}>
                    <span className={styles.listPhoto}>
                      {image ? (
                        <Image src={image.src} alt="" width={44} height={44} unoptimized />
                      ) : (
                        <AhiMark size={22} />
                      )}
                    </span>
                    <span className={styles.listText}>
                      <strong>
                        <span dir="auto">{pin.title}</span>
                        {pin.verified && <VerificationBadge kind="business" />}
                      </strong>
                      <span>
                        {[
                          pin.kind && t(pin.kind),
                          pin.city,
                          pin.rating !== null && rating(pin.rating),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <Icon name="chevron" />
                  </Link>
                </li>
              );
            })}
          </ul>
          <button type="button" className={styles.openCity} onClick={() => onCity(shown, opens)}>
            <Icon name="pin" />
            {opens ? t("Otvori mapu grada {city}", { city: opens }) : t("Otvori mapu")}
          </button>
        </section>
      )}
    </div>
  );
}
