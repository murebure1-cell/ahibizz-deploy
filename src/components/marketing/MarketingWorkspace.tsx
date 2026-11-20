"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
  type PlacementTarget,
  productionServices,
} from "../../lib/marketing";
import { ahiCreditTopUps } from "../../lib/wallet";
import styles from "./marketing.module.css";

const messages: Record<string, string> = {
  OFFER_CHANGED: "Ponuda je promijenjena. Osvježi pregled.",
  QUOTE_PAYMENT_PENDING: "Online uplata za ovu ponudu je otvorena. Provjeri njeno stanje.",
  OPEN_OFFER: "Već postoji otvoren zahtjev. Pogledaj ga ispod.",
  INSUFFICIENT_CREDITS: "Nemaš dovoljno kredita za ovu ponudu.",
  CREDIT_RATE_CHANGED: "Vrijednost kredita je promijenjena. Provjeri novi iznos.",
  CREDIT_RATE_REQUIRED: "Vrijednost kredita još nije postavljena.",
  CREDIT_BUNDLE_CHANGED: "Cijena dopune je promijenjena. Osvježi prikaz.",
  INVALID_CREDIT_BUNDLE: "Odaberi jednu od ponuđenih dopuna.",
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
  balance,
  submit,
  busy,
}: {
  order: MarketingOrder;
  admin: boolean;
  checkoutAvailable: boolean;
  balance: number;
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
              Posebna cijena u kreditima (opcionalno)
              <input name="credits" type="number" min="1" step="1" max="100000" />
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
        isPlacement(order.kind) &&
        order.creditPrice !== null &&
        (balance >= order.creditPrice ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => submit({ action: "useCredits", id: order.id })}
          >
            Plati kreditima · {credits(order.creditPrice)}
          </button>
        ) : (
          <Link className={styles.primaryLink} href="/nalog?odjeljak=krediti">
            Dopuni kredite · nedostaje {credits(order.creditPrice - balance)}
          </Link>
        ))}
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
export function MarketingWorkspace({ accountId, mode, target }: MarketingProps) {
  return (
    <MarketingView
      key={`${accountId}:${mode}:${target?.businessId ?? ""}:${target?.placement ?? ""}`}
      accountId={accountId}
      mode={mode}
      target={target}
    />
  );
}
type MarketingProps = { accountId: string; mode: MarketingMode; target?: PlacementTarget };
function MarketingView({ accountId, mode, target }: MarketingProps) {
  const router = useRouter();
  const [selectedQuantity, setSelectedQuantity] = useState<number>(ahiCreditTopUps[0].quantity);
  const [rateInput, setRateInput] = useState("");
  const pendingTopUp = useRef<{ quantity: number; id: string } | null>(null);
  const bundle =
    ahiCreditTopUps.find((option) => option.quantity === selectedQuantity) ?? ahiCreditTopUps[0];
  const [data, setData] = useState<MarketingData | null>(null),
    [page, setPage] = useState(0),
    [refresh, setRefresh] = useState(0),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  const running = useRef(false);
  const mounted = useRef(false);
  const placementForm = useRef<HTMLFormElement>(null);
  const openedPlacement = useRef(false);
  useEffect(() => {
    if (data && target && !openedPlacement.current) {
      openedPlacement.current = true;
      placementForm.current?.scrollIntoView({ block: "center" });
    }
  }, [data, target]);
  const openedProduction = useRef(false);
  useEffect(() => {
    if (
      data &&
      !openedProduction.current &&
      mode === "ads" &&
      (window.location.hash === "#produkcija" ||
        new URLSearchParams(window.location.search).get("usluga") === "produkcija")
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
        if (command.action === "topUp") {
          if (typeof result.id !== "string" || !/^[a-f0-9-]{36}$/i.test(result.id))
            throw new Error("INVALID_OFFER");
          pendingTopUp.current = null;
          router.push(`/naplata?ponuda=${result.id}`);
        } else if (command.action === "setCreditRate") {
          setRateInput("");
          setMessage("Vrijednost kredita je sačuvana.");
        } else {
          setMessage(
            command.action === "request"
              ? "Zahtjev je poslan."
              : command.action === "useCredits"
                ? "Plaćeno Ahi kreditima."
                : "Izmjena je sačuvana.",
          );
        }
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
    if (!isPlacement(placement) && !isProductionService(placement)) return;
    void submit({
      action: "request",
      id: crypto.randomUUID(),
      kind: placement,
      quantity: isProductionService(placement) ? 1 : Number(form.get("quantity")),
      businessId: String(form.get("business")),
    });
  }
  function topUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingTopUp.current?.quantity !== bundle.quantity) {
      pendingTopUp.current = { quantity: bundle.quantity, id: crypto.randomUUID() };
    }
    void submit({
      action: "topUp",
      id: pendingTopUp.current.id,
      quantity: bundle.quantity,
      expectedAmountMinor: bundle.amountMinor,
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
  const initialBusiness = target
    ? (data.businesses.find((business) => business.id === target.businessId)?.id ?? "")
    : undefined;
  const unitPrice = data.creditUnitBamMinor ?? null;
  return (
    <section className={styles.workspace}>
      {mode !== "admin" && <h1>{mode === "ads" ? "Moji oglasi" : "Ahi Credits"}</h1>}
      {mode === "credits" && (
        <header className={styles.wallet}>
          <span>Raspoloživi krediti</span>
          <strong>{credits(data.balance)}</strong>
          {unitPrice !== null && (
            <span>Pri plaćanju: {credits(100 / unitPrice)} kredita za 1 KM</span>
          )}
        </header>
      )}
      {mode === "admin" && (
        <details className={styles.order}>
          <summary>Vrijednost kredita pri plaćanju</summary>
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              const unitBamMinor = Number(rateInput);
              if (unitBamMinor > 0)
                void submit({
                  action: "setCreditRate",
                  id: crypto.randomUUID(),
                  unitBamMinor,
                  expectedUnitBamMinor: unitPrice,
                });
            }}
          >
            <label>
              Vrijednost jednog kredita (KM)
              <select
                value={rateInput || (unitPrice === null ? "" : String(unitPrice))}
                onChange={(event) => setRateInput(event.target.value)}
                required
              >
                <option value="" disabled>
                  Odaberi vrijednost
                </option>
                {[1, 2, 4, 5, 10, 20, 25, 50, 100].map((amount) => (
                  <option key={amount} value={amount}>
                    {billingMoney(amount)}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={busy || !rateInput || Number(rateInput) === unitPrice}>
              Sačuvaj vrijednost
            </button>
          </form>
        </details>
      )}
      {mode === "credits" && (
        <article className={styles.order}>
          <h2>Dopuni kredite</h2>
          <form className={styles.form} onSubmit={topUp}>
            <fieldset className={styles.bundles} aria-label="Odaberi dopunu">
              {ahiCreditTopUps.map((option) => (
                <label className={styles.bundle} key={option.quantity}>
                  <span className={styles.bundlePrice}>{billingMoney(option.amountMinor)}</span>
                  <input
                    type="radio"
                    name="dopuna"
                    value={option.quantity}
                    checked={bundle.quantity === option.quantity}
                    onChange={() => setSelectedQuantity(option.quantity)}
                  />
                  <strong>{credits(option.quantity)} kredita</strong>
                  <small>
                    {credits(option.base)} + {credits(option.bonus)} bonus
                  </small>
                </label>
              ))}
            </fieldset>
            <button type="submit" disabled={busy || !data.checkoutAvailable}>
              Dopuni za {billingMoney(bundle.amountMinor)}
            </button>
            {!data.checkoutAvailable && <p>Online dopuna trenutno nije dostupna.</p>}
          </form>
        </article>
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
          {(data.checkoutAvailable || unitPrice !== null) && data.businesses.length > 0 ? (
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
      {mode === "ads" && data.businesses.length > 0 && (
        <article className={styles.order}>
          <h2>Novi oglas</h2>
          <form ref={placementForm} onSubmit={request} className={styles.form}>
            {mode === "ads" && (
              <label>
                Mjesto prikaza
                <select name="placement" defaultValue={target?.placement}>
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
                <select name="business" required defaultValue={initialBusiness}>
                  {initialBusiness === "" && (
                    <option value="" disabled>
                      Odaberi objavljenu djelatnost
                    </option>
                  )}
                  {data.businesses.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Broj dana
              <input name="quantity" type="number" inputMode="numeric" required min={1} max={90} />
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
      {mode === "credits" && Boolean(data.movements?.length) && (
        <article className={styles.order}>
          <h2>Promet kredita</h2>
          <ul className={styles.movements}>
            {data.movements?.map((item) => (
              <li key={item.id}>
                <div>
                  {item.label}
                  <time dateTime={item.createdAt}>
                    {new Date(item.createdAt).toLocaleDateString("bs-BA")}
                  </time>
                </div>
                <strong>
                  {item.amount > 0 ? "+" : ""}
                  {credits(item.amount)}
                </strong>
              </li>
            ))}
          </ul>
        </article>
      )}
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
            balance={data.balance}
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
