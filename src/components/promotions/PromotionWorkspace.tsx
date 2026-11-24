"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { bosnianDateTime } from "../../lib/display-date";
import { IS_PLAY_EDITION } from "../../lib/distribution";
import { msg } from "../../lib/i18n/translate";
import {
  bamToEuroMinor,
  isPromotionDuration,
  isPromotionKind,
  isPromotionReference,
  type PromotionDuration,
  type PromotionKind,
  type PromotionOrder,
  type PromotionPrice,
  promotionCapacity,
  promotionDurations,
  promotionKinds,
  promotionLabels,
  promotionMoney,
  promotionStatusLabel,
} from "../../lib/promotions";
import { AccountAuthorityBoundary } from "../account/AccountAuthorityBoundary";
import { ConfirmButton } from "../ConfirmButton";
import { useT } from "../i18n/LocaleProvider";
import { LoadingSkeleton } from "../LoadingSkeleton";
import { CopyPaymentDetails } from "../support/CopyPaymentDetails";
import styles from "./promotions.module.css";

type Business = { id: string; title: string; city: string; categoryId: string };
type Catalog = {
  orders: PromotionOrder[];
  businesses: Business[];
  prices: PromotionPrice[];
  purchaseAvailable: boolean;
};
type Availability = { available: boolean; firstAvailableAt: string; capacity: number };
const messages: Record<string, string> = {
  PROMOTION_FULL: msg("Odabrani termin je zauzet. Odaberi prvi slobodan termin ili kasniji datum."),
  PROMOTION_DUPLICATE: msg(
    "Ova djelatnost već ima isticanje na tom mjestu u odabranom periodu. Odaberi drugi početak.",
  ),
  PROMOTION_CHANGED: msg("Narudžba je promijenjena. Osvježi pregled i provjeri stanje."),
  PROMOTION_NOT_PENDING: msg("Ova narudžba više ne čeka potvrdu."),
  PROMOTION_ALREADY_CONFIRMED: msg("Uplata je već potvrđena. Provjeri status narudžbe."),
  PROMOTION_ALREADY_PROCESSED: msg("Narudžba je već obrađena. Provjeri njen status."),
  PROMOTION_AMOUNT_MISMATCH: msg("Iznos ne odgovara narudžbi. Provjeri iznos i valutu s izvoda."),
  PROMOTION_REFERENCE_MISMATCH: msg("Referenca ne odgovara narudžbi."),
  PROMOTION_REFERENCE_USED: msg("Oznaka s izvoda je već iskorištena."),
  INVALID_PROMOTION_REFERENCE: msg("Upiši tačnu referencu ili oznaku s izvoda."),
  INVALID_PROMOTION_PAYMENT: msg("Provjeri iznos i valutu s izvoda."),
  INVALID_PROMOTION_DATE: msg("Odaberi sadašnji ili kasniji početak."),
  PROMOTION_PAYMENT_UNAVAILABLE: msg("Upute za uplatu trenutno nisu dostupne."),
  PROMOTION_PERIOD_ENDED: msg("Odabrani period je završen. Napravi novu narudžbu."),
  PAYMENT_MISMATCH: msg("Iznos, valuta ili referenca ne odgovaraju narudžbi."),
  INVALID_PAYMENT: msg("Provjeri iznos, valutu i referencu uplate."),
  BANK_UNAVAILABLE: msg("Upute za uplatu trenutno nisu dostupne."),
  PROMOTION_IMAGE_REQUIRED: msg("Dodaj sliku banera prije potvrde."),
  INVALID_PROMOTION: msg("Provjeri djelatnost, vrstu, trajanje i početak."),
  PROMOTION_EXPIRED: msg("Odabrani period je završen. Napravi novu narudžbu."),
  INVALID_IMAGE: msg("Odaberi JPG, PNG ili WebP sliku do 4 MB."),
  IMAGE_TOO_LARGE: msg("Slika može imati najviše 4 MB."),
  ACCOUNT_IDENTITY_CHANGED: msg("Nalog je promijenjen. Prijavi se ponovo."),
  AUTHENTICATION_REQUIRED: msg("Prijavi se ponovo."),
};
class RequestError extends Error {
  constructor(
    public code: string,
    public firstAvailableAt?: string,
  ) {
    super(messages[code] ?? msg("Radnja nije završena. Osvježi pregled i pokušaj ponovo."));
  }
}

function readCatalog(value: unknown): Catalog {
  const data = value as Catalog | null;
  if (
    !data ||
    !Array.isArray(data.orders) ||
    !Array.isArray(data.businesses) ||
    !Array.isArray(data.prices) ||
    typeof data.purchaseAvailable !== "boolean" ||
    !data.orders.every(
      (order) =>
        order &&
        typeof order.id === "string" &&
        typeof order.businessTitle === "string" &&
        isPromotionKind(order.kind) &&
        isPromotionDuration(order.durationDays) &&
        isPromotionReference(order.paymentReference) &&
        ["pending", "active", "completed", "cancelled"].includes(order.status) &&
        Number.isSafeInteger(order.amountBamMinor) &&
        Number.isSafeInteger(order.amountEurMinor) &&
        Number.isFinite(Date.parse(order.startsAt)) &&
        Number.isFinite(Date.parse(order.endsAt)),
    ) ||
    !data.businesses.every(
      (business) =>
        business && typeof business.id === "string" && typeof business.title === "string",
    ) ||
    !data.prices.every(
      (price) =>
        price &&
        isPromotionKind(price.kind) &&
        isPromotionDuration(price.durationDays) &&
        Number.isSafeInteger(price.amountBamMinor) &&
        price.amountBamMinor > 0,
    )
  )
    throw new Error(msg("Pregled trenutno nije dostupan."));
  return data;
}

function localDate(iso: string) {
  const date = new Date(iso);
  // Round up to a full second so converting an offered instant never makes it earlier.
  date.setTime(Math.ceil(date.getTime() / 1000) * 1000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
}
function initialStart() {
  return localDate(new Date(Math.ceil((Date.now() + 60000) / 60000) * 60000).toISOString());
}
function localDisplay(iso: string) {
  return bosnianDateTime(iso, Intl.DateTimeFormat().resolvedOptions().timeZone);
}
function moneyInput(value: FormDataEntryValue | null) {
  const text = typeof value === "string" ? value.trim().replace(",", ".") : "";
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(text)) throw new Error(msg("Upiši ispravan iznos."));
  const [whole, decimal = ""] = text.split(".");
  return Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
}
function imageFile(value: FormDataEntryValue | null, required: boolean) {
  if (!(value instanceof File) || !value.size) {
    if (required) throw new Error(msg("Dodaj sliku banera."));
    return null;
  }
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(value.type) ||
    value.size > 4 * 1024 * 1024
  )
    throw new Error(msg("Odaberi JPG, PNG ili WebP sliku do 4 MB."));
  return value;
}
async function imageBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text = "";
  for (let offset = 0; offset < bytes.length; offset += 16384)
    text += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
  return btoa(text);
}

export function PromotionWorkspace({
  accountId,
  admin = false,
  businessId,
}: {
  accountId: string;
  admin?: boolean;
  businessId?: string;
}) {
  const t = useT();
  if (IS_PLAY_EDITION)
    return (
      <p>
        {t("Ovaj odjeljak nije dostupan u aplikaciji.")} <Link href="/nalog">{t("Moj nalog")}</Link>
      </p>
    );
  return (
    <AccountAuthorityBoundary
      expectedAccountId={accountId}
      expectedRole={admin ? "owner" : undefined}
      loginHref={`/prijava?nastavi=${encodeURIComponent(admin ? "/administracija/isticanja" : "/nalog/isticanja")}`}
    >
      {(active) => (
        <Workspace
          key={accountId}
          accountId={accountId}
          admin={admin}
          initialBusiness={businessId}
          active={active}
        />
      )}
    </AccountAuthorityBoundary>
  );
}

function Workspace({
  accountId,
  admin,
  initialBusiness,
  active,
}: {
  accountId: string;
  admin: boolean;
  initialBusiness?: string;
  active: boolean;
}) {
  const t = useT();
  const [data, setData] = useState<Catalog | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [filter, setFilter] = useState("Sve");
  const current = useRef(active);
  const mutating = useRef(false);
  current.current = active;
  const base = admin ? "/api/admin/promotions" : "/api/promotions";
  const request = useCallback(
    async <T,>(url: string, options: RequestInit = {}): Promise<T> => {
      if (!current.current) throw new RequestError("ACCOUNT_IDENTITY_CHANGED");
      const headers = new Headers(options.headers);
      headers.set("X-AhiBizz-Account-ID", accountId);
      const response = await fetch(url, {
        ...options,
        headers,
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        mode: "same-origin",
      });
      const payload = await response.json();
      if (!current.current) throw new RequestError("ACCOUNT_IDENTITY_CHANGED");
      if (!response.ok) throw new RequestError(payload.code, payload.firstAvailableAt);
      return payload as T;
    },
    [accountId],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision explicitly requests a fresh authenticated list.
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setError("");
    request<unknown>(base, { signal: controller.signal })
      .then(readCatalog)
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(t(failure.message));
      });
    return () => controller.abort();
  }, [request, base, active, revision]);
  const refresh = () => setRevision((value) => value + 1);
  async function command(url: string, body: unknown, method = "POST") {
    return request<{ order: PromotionOrder }>(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  async function act(action: () => Promise<unknown>, success: string) {
    if (mutating.current || !active) return;
    mutating.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(success);
    } catch (failure) {
      setError(failure instanceof Error ? t(failure.message) : t("Radnja nije završena."));
    } finally {
      mutating.current = false;
      setBusy(false);
      refresh();
    }
  }
  return (
    <div className={styles.workspace}>
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
      {!data && !error ? (
        <LoadingSkeleton label={t("Učitavam isticanja…")} />
      ) : !data ? (
        <p role="status">
          {t("Pregled nije učitan.")}{" "}
          <button type="button" onClick={refresh}>
            {t("Osvježi")}
          </button>
        </p>
      ) : (
        <>
          {admin || data.purchaseAvailable ? (
            <PurchaseForm
              businesses={data.businesses}
              prices={data.prices}
              initialBusiness={initialBusiness}
              admin={admin}
              busy={busy || !active}
              request={request}
              command={command}
              act={act}
              base={base}
            />
          ) : (
            <p>
              {t(
                "Nova isticanja trenutno nisu dostupna. Postojeće narudžbe možeš pregledati ispod.",
              )}
            </p>
          )}
          <section className={styles.panel}>
            <div className={styles.heading}>
              <h2>{admin ? t("Narudžbe isticanja") : t("Moja isticanja")}</h2>
              <button type="button" disabled={busy} onClick={refresh}>
                {t("Osvježi")}
              </button>
            </div>
            <label>
              {t("Prikaz")}{" "}
              <select value={filter} onChange={(event) => setFilter(event.target.value)}>
                {[
                  msg("Sve"),
                  msg("Na čekanju"),
                  msg("Aktivno"),
                  msg("Zakazano"),
                  msg("Završeno"),
                  msg("Otkazano"),
                ].map((value) => (
                  <option key={value} value={value}>
                    {t(value)}
                  </option>
                ))}
              </select>
            </label>
            {!data.orders.filter(
              (order) => filter === "Sve" || promotionStatusLabel(order) === filter,
            ).length && <p>{t("Nema isticanja u ovom prikazu.")}</p>}
            {data.orders
              .filter((order) => filter === "Sve" || promotionStatusLabel(order) === filter)
              .map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  admin={admin}
                  busy={busy || !active}
                  act={act}
                  command={command}
                  request={request}
                  base={base}
                  accountId={accountId}
                />
              ))}
          </section>
          {admin && (
            <section className={styles.panel}>
              <h2>{t("Cijene isticanja")}</h2>
              <p>{t("Cijene su u KM. Promjena vrijedi za nove narudžbe.")}</p>
              <div className={styles.prices}>
                {data.prices.map((price) => (
                  <form
                    key={`${price.kind}:${price.durationDays}:${price.amountBamMinor}`}
                    onSubmit={(event) => {
                      event.preventDefault();
                      const fields = new FormData(event.currentTarget);
                      void act(
                        async () =>
                          command(
                            `${base}/prices`,
                            { ...price, amountBamMinor: moneyInput(fields.get("price")) },
                            "PUT",
                          ),
                        t("Cijena je sačuvana."),
                      );
                    }}
                  >
                    <fieldset disabled={busy || !active}>
                      <legend>
                        {t(promotionLabels[price.kind])} ·{" "}
                        {t("{count} dana", { count: price.durationDays })}
                      </legend>
                      <label>
                        Cijena u KM{" "}
                        <input
                          name="price"
                          inputMode="decimal"
                          defaultValue={(price.amountBamMinor / 100).toFixed(2)}
                          required
                        />
                      </label>
                      <button type="submit">{t("Sačuvaj cijenu")}</button>
                    </fieldset>
                  </form>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

type Request = <T>(url: string, options?: RequestInit) => Promise<T>;
type Command = (url: string, body: unknown, method?: string) => Promise<{ order: PromotionOrder }>;
type Act = (action: () => Promise<unknown>, success: string) => Promise<void>;
function PurchaseForm({
  businesses,
  prices,
  initialBusiness,
  admin,
  busy,
  request,
  command,
  act,
  base,
}: {
  businesses: Business[];
  prices: PromotionPrice[];
  initialBusiness?: string;
  admin: boolean;
  busy: boolean;
  request: Request;
  command: Command;
  act: Act;
  base: string;
}) {
  const t = useT();
  const [businessId, setBusinessId] = useState(
    businesses.some((row) => row.id === initialBusiness)
      ? (initialBusiness as string)
      : (businesses[0]?.id ?? ""),
  );
  const [kind, setKind] = useState<PromotionKind>("home");
  const [durationDays, setDuration] = useState<PromotionDuration>(7);
  const [start, setStart] = useState(initialStart);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [problem, setProblem] = useState("");
  const [checking, setChecking] = useState(false);
  const price = prices.find((row) => row.kind === kind && row.durationDays === durationDays);
  // biome-ignore lint/correctness/useExhaustiveDependencies: changing any selection invalidates the offered slot.
  useEffect(() => {
    setAvailability(null);
    setProblem("");
  }, [businessId, kind, durationDays, start]);
  async function check() {
    const query = new URLSearchParams({
      businessId,
      kind,
      durationDays: String(durationDays),
      startsAt: new Date(start).toISOString(),
    });
    const result = await request<Availability>(`${base}/availability?${query}`);
    if (
      typeof result.available !== "boolean" ||
      !Number.isFinite(Date.parse(result.firstAvailableAt))
    )
      throw new Error(msg("Termin trenutno nije dostupan."));
    setAvailability(result);
    return result;
  }
  async function createOrder(url: string, body: unknown) {
    try {
      return await command(url, body);
    } catch (failure) {
      if (failure instanceof RequestError && failure.firstAvailableAt)
        setAvailability({
          available: false,
          firstAvailableAt: failure.firstAvailableAt,
          capacity: promotionCapacity[kind],
        });
      throw failure;
    }
  }
  if (!businesses.length)
    return (
      <p>
        {admin ? (
          t("Nema objavljenih djelatnosti.")
        ) : (
          <>
            {t("Prvo objavi svoju djelatnost.")}{" "}
            <Link href="/nalog?odjeljak=djelatnosti">{t("Moje djelatnosti")}</Link>
          </>
        )}
      </p>
    );
  return (
    <section className={styles.panel}>
      <h2>{admin ? t("Ručno uključi isticanje") : t("Istakni djelatnost")}</h2>
      <p>
        {admin
          ? t("Uključi isticanje bez uplate i upiši razlog.")
          : t("Odaberi mjesto i period. Upute za bankovnu uplatu dobit ćeš uz narudžbu.")}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          void act(
            async () => {
              const file = imageFile(fields.get("image"), kind === "banner");
              const slot = await check();
              if (!slot.available) throw new RequestError("PROMOTION_FULL", slot.firstAvailableAt);
              const body = {
                businessId,
                kind,
                durationDays,
                startsAt: new Date(start).toISOString(),
              };
              if (admin) {
                await createOrder(`${base}/manual`, {
                  ...body,
                  note: String(fields.get("note") ?? "").trim(),
                  ...(file ? { imageBase64: await imageBase64(file), imageMime: file.type } : {}),
                });
              } else {
                const { order } = await createOrder(base, body);
                if (file) {
                  try {
                    await request(`/api/promotions/${order.id}/image`, {
                      method: "PUT",
                      body: file,
                      headers: { "Content-Type": file.type },
                    });
                  } catch {
                    throw new Error(
                      t(
                        "Narudžba je sačuvana. Slika nije dodana; pokušaj ponovo u njenom pregledu ispod.",
                      ),
                    );
                  }
                }
              }
            },
            admin
              ? t("Isticanje je uključeno.")
              : t("Narudžba je sačuvana. Upute za uplatu su ispod."),
          );
        }}
      >
        <fieldset disabled={busy || checking}>
          <div className={styles.fields}>
            <label>
              {t("Djelatnost")}{" "}
              <select
                value={businessId}
                onChange={(event) => setBusinessId(event.target.value)}
                required
              >
                {businesses.map((business) => (
                  <option key={business.id} value={business.id}>
                    <bdi>{business.title}</bdi>
                    {business.city ? ` · ${business.city}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Mjesto")}{" "}
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value as PromotionKind)}
              >
                {promotionKinds.map((value) => (
                  <option key={value} value={value}>
                    {t(promotionLabels[value])}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Trajanje")}{" "}
              <select
                value={durationDays}
                onChange={(event) => setDuration(Number(event.target.value) as PromotionDuration)}
              >
                {promotionDurations.map((value) => (
                  <option key={value} value={value}>
                    {value} dana
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Početak")}{" "}
              <input
                type="datetime-local"
                step="1"
                value={start}
                min={localDate(new Date().toISOString())}
                required
                onChange={(event) => setStart(event.target.value)}
              />
            </label>
          </div>
          <p>{t("Vrijeme je prikazano prema tvom uređaju.")}</p>
          {kind === "banner" && (
            <label>
              {t("Slika banera")}{" "}
              <input type="file" name="image" accept="image/jpeg,image/png,image/webp" required />
              <small>{t("JPG, PNG ili WebP do 4 MB.")}</small>
            </label>
          )}
          {admin && (
            <label>
              {t("Napomena")} <textarea name="note" required maxLength={1000} rows={3} />
            </label>
          )}
          {!admin && price && (
            <p className={styles.total}>
              {t("Iznos:")}{" "}
              <strong>
                {promotionMoney(price.amountBamMinor)} ·{" "}
                {promotionMoney(bamToEuroMinor(price.amountBamMinor), "EUR")}
              </strong>
            </p>
          )}
          {problem && <p role="alert">{problem}</p>}
          {availability && (
            <p role="status">
              {availability.available ? t("Termin je slobodan.") : t("Odabrani termin je zauzet.")}
            </p>
          )}
          {availability && !availability.available && (
            <button
              type="button"
              onClick={() => setStart(localDate(availability.firstAvailableAt))}
            >
              Odaberi prvi slobodan termin · {localDisplay(availability.firstAvailableAt)}
            </button>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              onClick={() => {
                setChecking(true);
                setProblem("");
                void check()
                  .catch((failure) => setProblem(t(failure.message)))
                  .finally(() => setChecking(false));
              }}
            >
              {t("Provjeri termin")}
            </button>
            <button type="submit" className="button button-navy" disabled={!price}>
              {admin ? t("Uključi isticanje") : t("Naruči isticanje")}
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}

function OrderCard({
  order,
  admin,
  busy,
  act,
  command,
  request,
  base,
  accountId,
}: {
  order: PromotionOrder;
  admin: boolean;
  busy: boolean;
  act: Act;
  command: Command;
  request: Request;
  base: string;
  accountId: string;
}) {
  const t = useT();
  const [currency, setCurrency] = useState<"BAM" | "EUR">(order.bank?.currency ?? "BAM");
  const bank = order.bank;
  const payment = bank
    ? [
        `Primalac: ${bank.recipient}`,
        `Banka: ${bank.name}`,
        ...(bank.iban ? [`IBAN: ${bank.iban}`] : []),
        ...(bank.accountNumber ? [`Račun: ${bank.accountNumber}`] : []),
        ...(bank.bic ? [`BIC: ${bank.bic}`] : []),
        ...(bank.address ? [`Adresa: ${bank.address}`] : []),
        `Iznos: ${promotionMoney(bank.currency === "EUR" ? order.amountEurMinor : order.amountBamMinor, bank.currency)}`,
        `Referenca: ${order.paymentReference}`,
        ...(bank.note ? [bank.note] : []),
      ].join("\n")
    : "";
  return (
    <article className={styles.order}>
      <div className={styles.heading}>
        <h3>
          <Link href={`/djelatnosti/${order.businessId}`} dir="auto">
            {order.businessTitle}
          </Link>
        </h3>
        <strong>{t(promotionStatusLabel(order))}</strong>
      </div>
      <p>
        {t(promotionLabels[order.kind])} · {t("{count} dana", { count: order.durationDays })}
      </p>
      <p>
        <time dateTime={order.startsAt}>{localDisplay(order.startsAt)}</time> do{" "}
        <time dateTime={order.endsAt}>{localDisplay(order.endsAt)}</time>
      </p>
      <p>
        {promotionMoney(order.amountBamMinor)} · {promotionMoney(order.amountEurMinor, "EUR")}
      </p>
      <p className={styles.reference}>Referenca: {order.paymentReference}</p>
      {order.manual && <p>Ručno uključeno · {order.note}</p>}
      {order.kind === "banner" && order.hasImage && (
        <BannerPreview order={order} accountId={accountId} />
      )}
      {!admin &&
        order.status === "pending" &&
        bank &&
        (order.kind !== "banner" || order.hasImage) && (
          <details className={styles.instructions} open>
            <summary>{t("Upute za uplatu")}</summary>
            <pre>{payment}</pre>
            <p>
              {t(
                "Uplati navedeni iznos u valuti računa i prepiši referencu. Isticanje uključujemo nakon provjere uplate. Dok uplata nije potvrđena, možeš otkazati narudžbu.",
              )}{" "}
              {t(
                "Ako uplata ne bude potvrđena do početka perioda, a najmanje 3 dana od narudžbe, narudžba se automatski otkazuje i mjesto se oslobađa.",
              )}
            </p>
            <CopyPaymentDetails text={payment} />
          </details>
        )}
      {!admin && order.status === "pending" && order.kind === "banner" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const fields = new FormData(event.currentTarget);
            void act(async () => {
              const file = imageFile(fields.get("image"), true) as File;
              await request(`/api/promotions/${order.id}/image`, {
                method: "PUT",
                body: file,
                headers: { "Content-Type": file.type },
              });
            }, t("Slika banera je sačuvana."));
          }}
        >
          <fieldset disabled={busy}>
            <label>
              {order.hasImage ? t("Zamijeni sliku banera") : t("Dodaj sliku banera")}
              <input type="file" name="image" accept="image/jpeg,image/png,image/webp" required />
            </label>
            <button type="submit">{t("Sačuvaj sliku")}</button>
          </fieldset>
        </form>
      )}
      {admin && order.status === "pending" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const fields = new FormData(event.currentTarget);
            void act(
              () =>
                command(`${base}/${order.id}/confirm`, {
                  amountMinor: moneyInput(fields.get("amount")),
                  currency,
                  ...(String(fields.get("reference") ?? "").trim()
                    ? { paymentReference: String(fields.get("reference")).trim() }
                    : {}),
                  ...(String(fields.get("statement") ?? "").trim()
                    ? { statementReference: String(fields.get("statement")).trim() }
                    : {}),
                }),
              t("Uplata je potvrđena."),
            );
          }}
        >
          <fieldset disabled={busy}>
            <legend>{t("Potvrdi uplatu s izvoda")}</legend>
            <div className={styles.fields}>
              <label>
                {t("Iznos s izvoda")} <input name="amount" inputMode="decimal" required />
              </label>
              <label>
                {t("Valuta")}{" "}
                <select
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value as "BAM" | "EUR")}
                >
                  <option value="BAM">KM</option>
                  <option value="EUR">EUR</option>
                </select>
              </label>
              <label>
                {t("Referenca uplate")} <input name="reference" autoComplete="off" maxLength={36} />
              </label>
              <label>
                {t("Oznaka s izvoda")} <input name="statement" maxLength={200} />
              </label>
            </div>
            <p>{t("Upiši referencu uplate ili jedinstvenu oznaku s izvoda.")}</p>
            <button type="submit" disabled={order.kind === "banner" && !order.hasImage}>
              {t("Potvrdi uplatu")}
            </button>
            {order.kind === "banner" && !order.hasImage && (
              <p>{t("Vlasnik prvo treba dodati sliku banera.")}</p>
            )}
          </fieldset>
        </form>
      )}
      {(order.status === "pending" || (admin && order.status === "active")) && (
        <ConfirmButton
          disabled={busy}
          title={t("Otkazati isticanje?")}
          description="Narudžba ostaje u historiji kao otkazana, a mjesto se oslobađa."
          confirmLabel="Otkaži isticanje"
          onConfirm={() =>
            void act(() => command(`${base}/${order.id}/cancel`, {}), t("Isticanje je otkazano."))
          }
        >
          {t("Otkaži isticanje")}
        </ConfirmButton>
      )}
    </article>
  );
}

function BannerPreview({ order, accountId }: { order: PromotionOrder; accountId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let objectURL = "";
    setError("");
    setSource("");
    void fetch(`/api/promotions/${order.id}/image`, {
      headers: { "X-AhiBizz-Account-ID": accountId },
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok || response.headers.get("content-type") !== "image/webp")
          throw new Error();
        return response.blob();
      })
      .then((blob) => {
        if (!controller.signal.aborted) {
          objectURL = URL.createObjectURL(blob);
          setSource(objectURL);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(t("Slika trenutno nije dostupna."));
      });
    return () => {
      controller.abort();
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [open, accountId, order, t]);
  return (
    <div>
      <button type="button" onClick={() => setOpen(!open)}>
        {open ? t("Zatvori sliku") : t("Pregledaj sliku banera")}
      </button>
      {open && error && <p role="alert">{error}</p>}
      {open && source && (
        <Image
          src={source}
          alt={`Baner za ${order.businessTitle}`}
          width={960}
          height={320}
          unoptimized
          style={{ width: "100%", height: "auto", objectFit: "contain" }}
        />
      )}
    </div>
  );
}
