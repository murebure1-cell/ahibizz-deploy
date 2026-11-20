"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { billingMoney } from "../../lib/billing";
import {
  adPlacements,
  isPlacement,
  isProductionService,
  type MarketingCommand,
  type MarketingData,
  type MarketingMode,
  type MarketingOrder,
  marketingLabels,
  productionServices,
} from "../../lib/marketing";
import styles from "./marketing.module.css";

const messages: Record<string, string> = {
  OFFER_CHANGED: "Ponuda je promijenjena. Osvježi pregled.",
  QUOTE_PAYMENT_PENDING: "Online uplata za ovu ponudu je otvorena. Provjeri njeno stanje.",
  OPEN_OFFER: "Već postoji otvoren zahtjev. Pogledaj ga ispod.",
  INSUFFICIENT_CREDITS: "Nemaš dovoljno kredita za ovu ponudu.",
  ACTIVE_BANNER: "Oglas na ovom mjestu već traje.",
  LOCATION_REQUIRED: "Prvo označi lokaciju djelatnosti na mapi.",
  INCLUDED_IN_PACKAGE: "Ovo isticanje već je aktivno kroz tvoj paket.",
  REFERENCE_USED: "Ova bankovna transakcija već je evidentirana.",
  AMOUNT_MISMATCH: "Primljeni iznos ne odgovara ponudi.",
  BUSINESS_CHANGED: "Djelatnost više nije dostupna za oglašavanje.",
  INVALID_OFFER: "Provjeri unesene podatke.",
  ACCOUNT_IDENTITY_CHANGED: "Prijavi se ponovo i osvježi ovu stranicu.",
};
const credits = (quantity: number) => new Intl.NumberFormat("bs-BA").format(quantity);
function price(value: FormDataEntryValue | null) {
  const raw = String(value ?? "")
    .trim()
    .replace(",", ".");
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(raw)) return 0;
  const [units, fraction = ""] = raw.split(".");
  return Number(units) * 100 + Number(fraction.padEnd(2, "0"));
}

function OfferCard({
  order,
  admin,
  checkoutAvailable,
  submit,
  busy,
}: {
  order: MarketingOrder;
  admin: boolean;
  checkoutAvailable: boolean;
  submit: (command: MarketingCommand) => void;
  busy: boolean;
}) {
  const title =
    order.kind === "credits"
      ? `${credits(order.quantity)} Ahi Credits`
      : (order.businessTitle ?? "Baner djelatnosti");
  function quote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget),
      alternative = Number(fields.get("credits") ?? 0);
    submit({
      id: order.id,
      action: "quote",
      amountMinor: price(fields.get("price")),
      instructions: String(fields.get("instructions") ?? ""),
      ...(alternative > 0 ? { creditPrice: alternative } : {}),
    });
  }
  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    submit({
      id: order.id,
      action: "confirm",
      amountMinor: price(fields.get("received")),
      reference: String(fields.get("reference") ?? ""),
    });
  }
  return (
    <article className={styles.order}>
      <header>
        <div>
          <h3>{title}</h3>
          <small>
            {admin ? `${order.customer} · ` : ""}
            {isPlacement(order.kind)
              ? `${adPlacements[order.kind]} · ${order.quantity} dana`
              : isProductionService(order.kind)
                ? productionServices[order.kind]
                : "Dopuna kredita"}
          </small>
        </div>
        <span className={styles.status}>
          {order.revokedAt
            ? isProductionService(order.kind)
              ? "Korekcija uplate"
              : "Obustavljeno"
            : marketingLabels[order.status]}
        </span>
      </header>
      {order.amountMinor !== null && (
        <p className={styles.amount}>
          {billingMoney(order.amountMinor)}
          {order.creditPrice !== null && <small> ili {credits(order.creditPrice)} kredita</small>}
        </p>
      )}
      {admin && order.productionReceiptConflict && (
        <p role="status">
          Uplata je potvrđena. U evidenciji postoji primitak s istom PayPal referencom i različitim
          podacima.
        </p>
      )}
      {order.endsAt && (
        <p>
          {order.startsAt && new Date(order.startsAt).getTime() > Date.now()
            ? `Prikaz od ${new Date(order.startsAt).toLocaleDateString("bs-BA")} `
            : "Prikaz "}
          do {new Date(order.endsAt).toLocaleDateString("bs-BA")}
        </p>
      )}
      {!admin && order.status === "quoted" && checkoutAvailable && (
        <Link className={styles.primaryLink} href={`/naplata?ponuda=${order.id}`}>
          {order.onlinePending ? "Nastavi otvorenu uplatu" : "Plati ponudu"}
        </Link>
      )}
      {order.status === "quoted" && !order.onlinePending && (
        <div className={styles.instructions}>
          <strong>{isProductionService(order.kind) ? "Detalji ponude" : "Upute za uplatu"}</strong>
          <p>{order.instructions}</p>
          <small>Poziv na broj: {order.id}</small>
        </div>
      )}
      {admin && order.status === "requested" && (
        <form onSubmit={quote} className={styles.form}>
          <label>
            Cijena (KM)
            <input name="price" inputMode="decimal" required maxLength={10} />
          </label>
          {isPlacement(order.kind) && (
            <label>
              Alternativa u kreditima (opcionalno)
              <input name="credits" type="number" min="1" max="100000" />
            </label>
          )}
          <label>
            {isProductionService(order.kind)
              ? "Opis usluge i upute za uplatu"
              : "Primalac, račun i upute za uplatu"}
            <textarea name="instructions" maxLength={600} required rows={3} />
          </label>
          <button disabled={busy} type="submit">
            Pošalji ponudu
          </button>
        </form>
      )}
      {admin && order.status === "quoted" && !order.onlinePending && (
        <form onSubmit={confirm} className={styles.form}>
          <label>
            Primljeno na računu (KM)
            <input name="received" inputMode="decimal" maxLength={10} required />
          </label>
          <label>
            Referenca s izvoda
            <input name="reference" minLength={3} maxLength={120} required />
          </label>
          <button disabled={busy} type="submit">
            Evidentiraj primljenu uplatu
          </button>
        </form>
      )}
      {!admin &&
        order.status === "quoted" &&
        !order.onlinePending &&
        order.creditPrice !== null && (
          <button
            type="button"
            disabled={busy}
            onClick={() => submit({ action: "useCredits", id: order.id })}
          >
            Plati {credits(order.creditPrice)} kredita
          </button>
        )}
      {["requested", "quoted"].includes(order.status) && !order.onlinePending && (
        <button
          type="button"
          className={styles.secondary}
          disabled={busy}
          onClick={() => submit({ action: "close", id: order.id })}
        >
          Zatvori zahtjev
        </button>
      )}
    </article>
  );
}
export function MarketingWorkspace({
  accountId,
  mode,
}: {
  accountId: string;
  mode: MarketingMode;
}) {
  return <MarketingView key={`${accountId}:${mode}`} accountId={accountId} mode={mode} />;
}
function MarketingView({ accountId, mode }: { accountId: string; mode: MarketingMode }) {
  const [data, setData] = useState<MarketingData | null>(null),
    [page, setPage] = useState(0),
    [refresh, setRefresh] = useState(0),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  const running = useRef(false);
  const mounted = useRef(false);
  const openedProduction = useRef(false);
  useEffect(() => {
    if (
      data &&
      !openedProduction.current &&
      mode === "ads" &&
      window.location.hash === "#produkcija"
    ) {
      openedProduction.current = true;
      document.getElementById("produkcija")?.scrollIntoView({ block: "start" });
    }
  }, [data, mode]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reread confirmed offers after every command and explicit retry.
  useEffect(() => {
    const abort = new AbortController();
    setFailed(false);
    fetch(`/api/marketing?mode=${mode}&page=${page}`, {
      headers: { "X-AhiBizz-Account-ID": accountId },
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: abort.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("read");
        const result: MarketingData = await response.json();
        if (!abort.signal.aborted) setData(result);
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          setFailed(true);
          setData(null);
        }
      });
    return () => abort.abort();
  }, [accountId, mode, page, refresh]);
  async function submit(command: MarketingCommand) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/marketing", {
        method: "POST",
        headers: { "X-AhiBizz-Account-ID": accountId, "Content-Type": "application/json" },
        credentials: "same-origin",
        redirect: "error",
        body: JSON.stringify(command),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.code);
      if (mounted.current) {
        setPage(0);
        setMessage(command.action === "request" ? "Zahtjev je poslan." : "Izmjena je sačuvana.");
      }
    } catch (error) {
      if (mounted.current)
        setMessage(
          (error instanceof Error ? messages[error.message] : null) ??
            "Rezultat nije potvrđen. Provjeri pregled zahtjeva.",
        );
    } finally {
      running.current = false;
      if (mounted.current) {
        setBusy(false);
        setRefresh((value) => value + 1);
      }
    }
  }
  function request(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const placement = form.get("placement");
    if (mode === "ads" && !isPlacement(placement) && !isProductionService(placement)) return;
    void submit({
      action: "request",
      id: crypto.randomUUID(),
      kind: isPlacement(placement) || isProductionService(placement) ? placement : "credits",
      quantity: isProductionService(placement) ? 1 : Number(form.get("quantity")),
      ...(mode === "ads" ? { businessId: String(form.get("business")) } : {}),
    });
  }
  if (failed)
    return (
      <div className={styles.workspace}>
        <p>Pregled trenutno nije dostupan.</p>
        <button type="button" onClick={() => setRefresh((value) => value + 1)}>
          Pokušaj ponovo
        </button>
      </div>
    );
  if (!data)
    return (
      <div
        className={styles.workspace}
        role="status"
        aria-busy="true"
        aria-label="Učitavanje ponuda"
      >
        <div className={styles.skeleton} />
      </div>
    );
  return (
    <section className={styles.workspace}>
      {mode !== "admin" && <h1>{mode === "ads" ? "Moji oglasi" : "Ahi Credits"}</h1>}
      {mode === "credits" && (
        <header className={styles.wallet}>
          <small>Raspoloživo</small>
          <strong>{credits(data.balance)}</strong>
          <span>Ahi Credits</span>
        </header>
      )}
      {mode === "ads" && data.included.length > 0 && (
        <article className={styles.order}>
          <h2>Uključeno u paket</h2>
          {data.included.map((item) => (
            <div key={`${item.id}:${item.kind}`}>
              <Link href={`/djelatnosti/${item.id}`}>{item.title}</Link>
              <p>
                {adPlacements[item.kind]} · do{" "}
                {new Date(item.endsAt).toLocaleString("bs-BA", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </p>
            </div>
          ))}
        </article>
      )}
      {mode === "ads" && (
        <article className={styles.order}>
          <header>
            <h2>Isticanje u kategoriji</h2>
            <small>7 dana · 10 KM</small>
          </header>
          {data.promotions.map((item) => (
            <p key={item.id}>
              <Link href={`/djelatnosti/${item.id}`}>{item.title}</Link> · do{" "}
              {new Date(item.endsAt).toLocaleDateString("bs-BA")}
            </p>
          ))}
          {data.checkoutAvailable && data.businesses.length > 0 ? (
            <Link className={styles.primaryLink} href="/naplata">
              Istakni djelatnost
            </Link>
          ) : (
            <small>
              {data.businesses.length
                ? "Online isticanje trenutno nije dostupno."
                : "Isticanje je dostupno za objavljene djelatnosti."}
            </small>
          )}
        </article>
      )}
      {mode !== "admin" && (mode === "credits" || data.businesses.length > 0) && (
        <article className={styles.order}>
          <h2>{mode === "credits" ? "Kupi kredite" : "Novi oglas"}</h2>
          {mode === "credits" && <small>Zatraži cijenu za željeni broj kredita.</small>}
          <form onSubmit={request} className={styles.form}>
            {mode === "ads" && (
              <label>
                Mjesto prikaza
                <select name="placement">
                  {Object.entries(adPlacements).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {mode === "ads" && (
              <label>
                Djelatnost
                <select name="business" required>
                  {data.businesses.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              {mode === "credits" ? "Broj kredita" : "Broj dana"}
              <input
                name="quantity"
                type="number"
                inputMode="numeric"
                required
                min={1}
                max={mode === "credits" ? 100000 : 90}
              />
            </label>
            <button type="submit" disabled={busy}>
              Zatraži ponudu
            </button>
          </form>
        </article>
      )}
      {mode === "ads" && (
        <article id="produkcija" className={styles.order}>
          <h2>Foto i video produkcija</h2>
          {(data.productionBusinesses ?? data.businesses).length > 0 ? (
            <form className={styles.form} onSubmit={request}>
              <label>
                Usluga
                <select name="placement">
                  {Object.entries(productionServices).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Djelatnost
                <select name="business" required>
                  {(data.productionBusinesses ?? data.businesses).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" disabled={busy}>
                Zatraži ponudu za produkciju
              </button>
            </form>
          ) : (
            <p>
              Za ponudu dodaj djelatnost.{" "}
              <Link href="/nalog?odjeljak=djelatnosti">Moje djelatnosti</Link>
            </p>
          )}
        </article>
      )}
      {message && <p role="status">{message}</p>}
      <div className={styles.orders}>
        <h2>{mode === "admin" ? "Zahtjevi i uplate" : "Moji zahtjevi"}</h2>
        {!data.orders.length && (
          <p>{mode === "admin" ? "Nema zahtjeva." : "Još nemaš zahtjeva."}</p>
        )}
        {data.orders.map((order) => (
          <OfferCard
            key={order.id}
            order={order}
            checkoutAvailable={data.checkoutAvailable}
            admin={mode === "admin"}
            busy={busy}
            submit={submit}
          />
        ))}
        {(page > 0 || data.more) && (
          <nav aria-label="Stranice zahtjeva">
            {page > 0 && (
              <button type="button" onClick={() => setPage(page - 1)}>
                Prethodna
              </button>
            )}
            {data.more && (
              <button type="button" onClick={() => setPage(page + 1)}>
                Sljedeća
              </button>
            )}
          </nav>
        )}
      </div>
    </section>
  );
}
