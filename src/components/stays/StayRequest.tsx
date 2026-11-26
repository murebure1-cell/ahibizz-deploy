"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { accountSectionPath } from "../../lib/account-return";
import { appointmentDate } from "../../lib/appointment-display";
import {
  bookingDate,
  bookingMoney,
  bookingMonth,
  bookingShortDate,
  bookingWeekdays,
} from "../../lib/booking";
import { BookingRequestError, bookingAccountId } from "../../lib/booking-client";
import { dateKey } from "../../lib/booking-time";
import { type BusinessMediaAsset, businessMediaUrl } from "../../lib/business-media";
import { stayCalendarMonth } from "../../lib/stay-calendar";
import { noStayChoice, type StayChoice, stayChoose, stayDay } from "../../lib/stay-request";
import { type StayIntent, StayRecoveryRequired, staySubmissions } from "../../lib/stay-submission";
import {
  type StayBooking,
  type StayCatalog,
  type StayInterval,
  type StayRequestInput,
  stayNights,
  stayQuote,
} from "../../lib/stays";
import panel from "../booking/booking-panel.module.css";
import { Icon } from "../Icon";
import { useI18n } from "../i18n/LocaleProvider";
import { stayError, useStayRead, writeStay } from "./stay-client";
import { bedsText, nightsText, unitKinds } from "./stay-labels";
import styles from "./stay-request.module.css";

type Photo = Pick<BusinessMediaAsset, "slot" | "kind" | "version" | "width" | "height">;
type Done = { name: string; checkIn: string; checkOut: string; total: number };

/**
 * Booking a stay, as a visitor of the business's page sees it: which unit, which nights, what
 * they come to, and the button that sends the request. The owner marks taken nights in the
 * calendar of the unit instead (StayCalendar).
 */
export function StayRequest({
  businessId,
  catalog,
  photos = [],
  catalogRevision,
  onChangedOffer,
  useRead = useStayRead,
  write = writeStay,
  account = bookingAccountId,
}: {
  businessId: string;
  catalog: StayCatalog;
  photos?: Photo[];
  catalogRevision: number;
  /** The offer is no longer what was shown: read it again. */
  onChangedOffer: () => void;
  /** The three below are replaced only by the local preview, which has no server. */
  useRead?: typeof useStayRead;
  write?: typeof writeStay;
  account?: () => Promise<string>;
}) {
  const { t, locale } = useI18n();
  const zone = catalog.timezone;
  const [unitId, setUnitId] = useState(catalog.units[0]?.id ?? "");
  const unit = catalog.units.find((item) => item.id === unitId) ?? catalog.units[0];
  // Today depends on the device's clock, so it is read after the page is drawn: the server
  // and the device may stand on two sides of midnight.
  const [today, setToday] = useState("");
  const [month, setMonth] = useState("");
  const [choice, setChoice] = useState<StayChoice>(noStayChoice);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [login, setLogin] = useState(false);
  const [pending, setPending] = useState<StayIntent | null>(null);
  const [revision, setRevision] = useState(0);
  const writing = useRef(false);
  useEffect(() => {
    const day = dateKey(new Date(), zone);
    setToday(day);
    setMonth(day.slice(0, 7));
  }, [zone]);
  // A request whose outcome was never confirmed, kept from an earlier visit, is checked first.
  useEffect(() => {
    if (!staySubmissions.previouslyUsed()) return;
    let live = true;
    void account()
      .then((id) => {
        const saved = staySubmissions.pending(id);
        if (live && saved && saved.businessId === businessId) setPending(saved);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [account, businessId]);

  const frame = month ? stayCalendarMonth(month) : null;
  const base = unit ? `public/${businessId}/${unit.id}` : null;
  const calendar = useRead<{ entries: (StayBooking | StayInterval)[] }>(
    base && frame ? `${base}/calendar?from=${frame.first}&to=${frame.end}` : null,
    undefined,
    revision + catalogRevision,
  );
  const entries = (calendar?.data?.entries ?? []).filter(
    (entry) => !("status" in entry) || entry.status === "requested" || entry.status === "confirmed",
  );
  const { arrival, departure } = choice;
  const valid = Boolean(today && arrival >= today && departure > arrival);
  const crossesMonth = Boolean(valid && frame && (arrival < frame.first || departure > frame.end));
  const availability = useRead<{ available: boolean }>(
    base && crossesMonth ? `${base}/availability?from=${arrival}&to=${departure}` : null,
    undefined,
    revision + catalogRevision,
  );
  if (!unit) return null;

  const occupied =
    valid &&
    (crossesMonth
      ? availability?.data?.available === false
      : entries.some((entry) => entry.checkIn < departure && entry.checkOut > arrival));
  const ready = Boolean(valid && calendar?.data && (!crossesMonth || availability?.data));
  const nights = valid ? stayNights(arrival, departure) : 0;
  const total = valid ? stayQuote(unit.priceMinor, arrival, departure) : null;
  const frozen = busy || Boolean(pending);
  const perNight = (minor: number) => `${bookingMoney(minor)} / ${t("noć")}`;
  const year = today.slice(0, 4) || undefined;

  function clear() {
    setError("");
    setNotice("");
    setLogin(false);
  }
  function choose(day: string) {
    setChoice((current) => stayChoose(current, day, entries, today));
    clear();
  }
  async function submit(recover = false) {
    if (writing.current || !unit) return;
    if (recover ? !pending : pending || !valid || !ready || occupied || total === null) return;
    writing.current = true;
    setBusy(true);
    clear();
    try {
      const id = await account();
      if (recover && pending && pending.account !== id)
        throw new BookingRequestError("ACCOUNT_IDENTITY_CHANGED", 401);
      const send = (path: string, accountId: string, body: StayRequestInput) =>
        write<{ entry: StayBooking }>(path, accountId, body);
      const receipt =
        recover && pending
          ? await staySubmissions.retry(pending, send)
          : await staySubmissions.submit(
              {
                account: id,
                businessId,
                unitId: unit.id,
                kind: "customer",
                body: {
                  requestId: crypto.randomUUID(),
                  expectedUnitVersion: unit.version,
                  checkIn: arrival,
                  checkOut: departure,
                },
              },
              send,
            );
      setPending(null);
      setChoice(noStayChoice);
      setRevision((value) => value + 1);
      if (recover) setNotice(t("Prethodni zahtjev je potvrđen u evidenciji."));
      else
        setDone({
          name: unit.name,
          checkIn: receipt.checkIn,
          checkOut: receipt.checkOut,
          total: total ?? 0,
        });
    } catch (failure) {
      if (failure instanceof StayRecoveryRequired) {
        setPending(failure.intent);
        return;
      }
      if (recover && pending && !staySubmissions.pending(pending.account)) setPending(null);
      setError(t(stayError(failure)));
      if (failure instanceof BookingRequestError) {
        if (failure.status === 401) setLogin(true);
        if (failure.status === 409) {
          setRevision((value) => value + 1);
          if (failure.code.includes("VERSION") || failure.code.includes("OFFER")) onChangedOffer();
        }
      }
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  const days = frame
    ? Array.from(
        { length: frame.days },
        (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`,
      )
    : [];
  const chosenPhotos = unit.photoSlots.flatMap((slot) =>
    photos.filter((photo) => photo.slot === slot),
  );
  const hint = !arrival
    ? t("Izaberi dan dolaska.")
    : choice.choosingEnd
      ? t("Izaberi dan odlaska.")
      : "";

  return (
    <section className={panel.panel} aria-label={t("Rezerviši boravak")} data-design="stay-request">
      <header className={panel.head}>
        <h2>{t("Rezerviši boravak")}</h2>
      </header>
      {done ? (
        <div role="status" className={panel.done}>
          <span className={panel.doneMark} aria-hidden="true">
            <Icon name="check" />
          </span>
          <h3>{t("Zahtjev je poslan.")}</h3>
          <p className={panel.doneWhat} dir="auto">
            {done.name}
          </p>
          <p>
            {appointmentDate(done.checkIn, locale, year)} –{" "}
            {appointmentDate(done.checkOut, locale, year)} ·{" "}
            {t(nightsText(stayNights(done.checkIn, done.checkOut)), {
              count: stayNights(done.checkIn, done.checkOut),
            })}
          </p>
          <p>
            {bookingMoney(done.total)} · {t("Čeka potvrdu")}
          </p>
          <div className={panel.actions}>
            <Link className={panel.send} href={accountSectionPath("appointments")}>
              {t("Moji termini")}
            </Link>
            <button type="button" className={panel.minor} onClick={() => setDone(null)}>
              {t("Novi zahtjev")}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className={panel.group}>
            <div className={panel.groupHead}>
              <h3>{t("Jedinica")}</h3>
            </div>
            <div role="radiogroup" aria-label={t("Jedinica")} className={styles.units}>
              {catalog.units.map((item) => {
                const chosen = item.id === unit.id;
                const cover = item.photoSlots
                  .map((slot) => photos.find((photo) => photo.slot === slot))
                  .find(Boolean);
                return (
                  // biome-ignore lint/a11y/useSemanticElements: A unit is a card with a picture and details, which a native radio cannot hold.
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={chosen}
                    className={styles.unit}
                    disabled={frozen}
                    onClick={() => {
                      if (chosen) return;
                      setUnitId(item.id);
                      setChoice(noStayChoice);
                      clear();
                    }}
                  >
                    <span className={styles.row}>
                      <span className={styles.picture} aria-hidden="true">
                        {cover ? (
                          <Image
                            src={businessMediaUrl(businessId, cover, "public")}
                            width={120}
                            height={120}
                            alt=""
                            unoptimized
                          />
                        ) : (
                          <Icon name="bed" />
                        )}
                      </span>
                      <span className={styles.name}>
                        <strong dir="auto">{item.name}</strong>
                        {t(unitKinds[item.type])} · {t(bedsText(item.beds), { count: item.beds })}
                        <span className={styles.price}>{perNight(item.priceMinor)}</span>
                      </span>
                      <span className={styles.mark} aria-hidden="true">
                        <Icon name="check" />
                      </span>
                    </span>
                    {chosen && item.description && (
                      <span className={styles.about} dir="auto">
                        {item.description}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {chosenPhotos.length > 1 && (
              <ul className={styles.photos}>
                {chosenPhotos.slice(1).map((photo, index) => (
                  <li key={photo.slot}>
                    <Image
                      src={businessMediaUrl(businessId, photo, "public")}
                      width={264}
                      height={176}
                      alt={t("{name}, fotografija {number}", {
                        name: unit.name,
                        number: index + 2,
                      })}
                      unoptimized
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={panel.group}>
            <div className={panel.groupHead}>
              <h3>{t("Datumi")}</h3>
            </div>
            <div className={styles.calendar}>
              <div className={styles.month}>
                <button
                  type="button"
                  className={styles.step}
                  data-back
                  aria-label={t("Prethodni mjesec")}
                  disabled={frozen || !frame?.previous || month <= today.slice(0, 7)}
                  onClick={() => frame?.previous && setMonth(frame.previous)}
                >
                  <Icon name="chevron" aria-hidden="true" />
                </button>
                <strong aria-live="polite">{month ? bookingMonth(month, locale) : "—"}</strong>
                <button
                  type="button"
                  className={styles.step}
                  aria-label={t("Sljedeći mjesec")}
                  disabled={frozen || !frame?.next}
                  onClick={() => frame?.next && setMonth(frame.next)}
                >
                  <Icon name="chevron" aria-hidden="true" />
                </button>
              </div>
              <div className={styles.weekdays} aria-hidden="true">
                {bookingWeekdays(locale).map((letter, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: The seven weekdays never reorder.
                  <span key={index}>{letter}</span>
                ))}
              </div>
              <div className={styles.days} aria-busy={!calendar}>
                {Array.from({ length: frame?.weekdayOffset ?? 0 }, (_, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: Empty cells before the first day.
                  <span key={`empty-${index}`} />
                ))}
                {days.map((day) => {
                  const state = stayDay(choice, day, entries, today);
                  const label = bookingDate(`${day}T12:00:00Z`, "UTC", { locale });
                  return (
                    <button
                      type="button"
                      key={day}
                      className={styles.day}
                      aria-label={state.taken ? t("{date}, zauzeto", { date: label }) : label}
                      aria-current={day === today ? "date" : undefined}
                      aria-pressed={state.role === "arrival" || state.role === "departure"}
                      data-role={state.role ?? undefined}
                      data-taken={state.taken || undefined}
                      disabled={frozen || !calendar?.data || state.disabled}
                      onClick={() => choose(day)}
                    >
                      {Number(day.slice(8))}
                    </button>
                  );
                })}
              </div>
              {calendar?.error ? (
                <div role="alert" className={panel.error}>
                  <p>{calendar.error}</p>
                  <div className={panel.actions}>
                    <button
                      type="button"
                      className={panel.minor}
                      onClick={() => setRevision((value) => value + 1)}
                    >
                      {t("Pokušaj ponovo")}
                    </button>
                  </div>
                </div>
              ) : (
                hint && (
                  <p className={panel.note} aria-live="polite">
                    {hint}
                  </p>
                )
              )}
            </div>
            <div className={styles.ends}>
              <button
                type="button"
                className={styles.end}
                aria-pressed={!choice.choosingEnd}
                disabled={frozen}
                onClick={() => setChoice((current) => ({ ...current, choosingEnd: false }))}
              >
                <span>{t("Dolazak")}</span>
                <strong data-empty={!arrival || undefined}>
                  {arrival ? bookingShortDate(arrival, locale) : t("Izaberi")}
                </strong>
              </button>
              <button
                type="button"
                className={styles.end}
                aria-pressed={choice.choosingEnd}
                disabled={frozen || !arrival}
                onClick={() => setChoice((current) => ({ ...current, choosingEnd: true }))}
              >
                <span>{t("Odlazak")}</span>
                <strong data-empty={!departure || undefined}>
                  {departure ? bookingShortDate(departure, locale) : t("Izaberi")}
                </strong>
              </button>
            </div>
            {occupied && (
              <p role="status" className={styles.taken}>
                {t("Smještaj je zauzet u tom periodu.")}
              </p>
            )}
          </div>

          {pending && (
            <div role="alert" className={panel.error}>
              <p>
                {t("Ishod zahtjeva još nije potvrđen.")}{" "}
                {appointmentDate(pending.body.checkIn, locale, year)} –{" "}
                {appointmentDate(pending.body.checkOut, locale, year)}
              </p>
              <div className={panel.actions}>
                <button
                  type="button"
                  className={panel.minor}
                  disabled={busy}
                  onClick={() => void submit(true)}
                >
                  {busy ? t("Provjera…") : t("Provjeri isti zahtjev")}
                </button>
                <Link className={panel.minor} href={accountSectionPath("appointments")}>
                  {t("Moji termini")}
                </Link>
              </div>
            </div>
          )}
          {(error || (crossesMonth && availability?.error)) && (
            <div role="alert" className={panel.error}>
              <p>{error || availability?.error}</p>
              <div className={panel.actions}>
                {login ? (
                  <Link
                    className={panel.minor}
                    href={`/prijava?nastavi=${encodeURIComponent(`/djelatnosti/${businessId}#business-stays`)}`}
                  >
                    {t("Prijavi se")}
                  </Link>
                ) : (
                  <button
                    type="button"
                    className={panel.minor}
                    disabled={busy}
                    onClick={() => {
                      setError("");
                      setRevision((value) => value + 1);
                    }}
                  >
                    {t("Pokušaj ponovo")}
                  </button>
                )}
              </div>
            </div>
          )}
          {notice && (
            <p role="status" className={panel.note}>
              {notice}
            </p>
          )}
          {total !== null && (
            <dl className={panel.summary}>
              <div>
                <dt dir="auto">{unit.name}</dt>
                <dd>{t(nightsText(nights), { count: nights })}</dd>
              </div>
              <div>
                <dt>{t("Cijena")}</dt>
                <dd>{perNight(unit.priceMinor)}</dd>
              </div>
              <div className={panel.total}>
                <dt>{t("Ukupno")}</dt>
                <dd>{bookingMoney(total)}</dd>
              </div>
            </dl>
          )}
          <p className={panel.note}>
            {t("Plaćaš kod djelatnosti. U aplikaciji nema plaćanja.")}{" "}
            {t("Tvoje ime i email dijele se s vlasnikom radi dogovora.")}
          </p>
          <div className={panel.foot}>
            <button
              type="button"
              className={panel.send}
              disabled={frozen || !ready || occupied || total === null}
              onClick={() => void submit()}
            >
              {busy ? t("Slanje…") : t("Pošalji zahtjev")}
            </button>
            <p className={panel.note}>
              {t("Zahtjev odmah zauzima jedinicu. Vlasnik ga potvrđuje ili odbija.")}
            </p>
          </div>
        </>
      )}
    </section>
  );
}
