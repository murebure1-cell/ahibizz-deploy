"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { creditTopUpPath, creditTopUpReturn } from "../../lib/account-return";
import { type CampaignSelection, campaignPath } from "../../lib/ad-brief";
import type { BankTopUpCreate } from "../../lib/bank-credit-topup";
import { billingMoney } from "../../lib/billing";
import {
  adPlacements,
  categoryPromotionPriceBamMinor,
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
import {
  ahiCreditTopUps,
  creditNumber as credits,
  creditsForBamMinor,
  formatAhiCredits,
} from "../../lib/wallet";
import { AdCampaignForm, CampaignDetails } from "./AdCampaignForm";
import { AdCreativeManager } from "./AdCreativeManager";
import { AdRateEditor } from "./AdRateEditor";
import {
  BankTopUpAdmin,
  CreditBankTransfer,
  creditBankAmount,
  marketingAmount,
  useBankTopUps,
} from "./CreditBankTransfers";
import styles from "./marketing.module.css";

const messages: Record<string, string> = {
  OFFER_CHANGED: "Ponuda je promijenjena. Osvježi pregled.",
  QUOTE_PAYMENT_PENDING: "Online uplata za ovu ponudu je otvorena. Provjeri njeno stanje.",
  CAMPAIGN_ASSET_CHANGED:
    "Datoteka oglasa se promijenila. Pregledaj noviju verziju prije slanja ponude.",
  INVALID_CAMPAIGN: "Provjeri postavke kampanje.",
  CAMPAIGN_POSITION_UNAVAILABLE: "Pozicija trenutno nije dostupna.",
  CAMPAIGN_IMAGE_CHANGED: "Odabrana fotografija se promijenila. Odaberi je ponovo.",
  CAMPAIGN_SITE_CHANGED: "Web stranica djelatnosti više nije dostupna za oglas.",
  CAMPAIGN_COUNTRY_CHANGED: "Nema objavljene djelatnosti za odabranu državu. Osvježi izbor.",
  CAMPAIGN_CATEGORY_CHANGED: "Odabrana kategorija više nije dostupna.",
  CAMPAIGN_DATE_CHANGED: "Odaberi početak u narednih 12 mjeseci.",
  CAMPAIGN_BUDGET_EXCEEDED: "Ponuda prelazi budžet koji je oglašivač prihvatio.",
  CAMPAIGN_MINIMUM: "Ponuda je ispod minimalnog zakupa ove kampanje.",
  CAMPAIGN_REQUIRED: "Za baner odaberi poziciju i format kampanje.",
  CAMPAIGN_BENEFIT_CHANGED: "Cijena više ne odgovara odabranom popustu.",
  CAMPAIGN_WELCOME_USED: "Oglašivač je već koristio popust dobrodošlice ili imao plaćenu kampanju.",
  CAMPAIGN_MANUAL_ONLY: "Posebni uslovi ciljanja zahtijevaju pojedinačni dogovor.",
  OPEN_OFFER: "Već postoji otvoren zahtjev. Pogledaj ga ispod.",
  INSUFFICIENT_CREDITS: "Nemaš dovoljno kredita za ovu ponudu.",
  CREDIT_RATE_CHANGED: "Vrijednost kredita je promijenjena. Provjeri novi iznos.",
  CREDIT_RATE_REQUIRED: "Vrijednost kredita još nije postavljena.",
  CREDIT_BUNDLE_CHANGED: "Cijena dopune je promijenjena. Osvježi prikaz.",
  CREDIT_TOP_UP_BANK_ONLY: "Ahi krediti se dopunjuju uplatom na račun.",
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

function OfferCard({
  accountId,
  order,
  admin,
  checkoutAvailable,
  creditTopUpBankOnly,
  platformCreditsOnly,
  walletRate,
  balance,
  submit,
  busy,
  refresh,
}: {
  accountId: string;
  order: MarketingOrder;
  admin: boolean;
  checkoutAvailable: boolean;
  creditTopUpBankOnly: boolean;
  platformCreditsOnly: boolean;
  walletRate: number | null;
  balance: number;
  submit: (command: MarketingCommand) => void;
  busy: boolean;
  refresh: () => void;
}) {
  const bankOnlyTopUp = order.kind === "credits" && creditTopUpBankOnly;
  const showPaymentHistory = order.status === "paid" && platformCreditsOnly;
  const [benefit, setBenefit] = useState<"" | "advance" | "welcome">("");
  const suggested = order.campaign
    ? benefit === "advance"
      ? order.campaign.advanceMinor
      : benefit === "welcome"
        ? order.campaign.welcomeMinor
        : order.campaign.estimateMinor
    : null;
  const suggestedAmount =
    suggested != null ? Math.max(suggested, order.campaign?.minimumMinor ?? 0) : null;
  const suggestedCredits =
    suggestedAmount !== null ? creditsForBamMinor(suggestedAmount, walletRate ?? 0) : null;
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
      ...(!platformCreditsOnly ? { amountMinor: marketingAmount(fields.get("price")) } : {}),
      instructions: String(fields.get("instructions") ?? ""),
      ...(alternative > 0 ? { creditPrice: alternative } : {}),
      ...(order.campaign ? { expectedAssetVersion: order.campaign.assetVersion } : {}),
      ...(benefit ? { campaignBenefit: benefit } : {}),
      ...(fields.get("standardTargeting") === "yes"
        ? { offerStandardTargeting: true as const }
        : {}),
    });
  }
  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    submit({
      id: order.id,
      action: "confirm",
      amountMinor: marketingAmount(fields.get("received")),
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
      {order.campaign && (
        <CampaignDetails
          campaign={order.campaign}
          creditRate={platformCreditsOnly ? walletRate : undefined}
        />
      )}
      {order.campaign && ["requested", "quoted", "paid"].includes(order.status) && (
        <AdCreativeManager
          accountId={accountId}
          orderId={order.id}
          assetVersion={order.campaign.assetVersion}
          onChange={refresh}
          editable={order.status === "requested" && !admin}
        />
      )}
      {showPaymentHistory ? (
        <p className={styles.amount}>
          {order.paidWithCredits
            ? order.creditPrice !== null
              ? `Plaćeno · ${formatAhiCredits(Math.round(order.creditPrice * 100))}`
              : "Plaćeno Ahi kreditima"
            : order.paidCurrency && order.paidAmountMinor != null
              ? `Evidentirana uplata · ${creditBankAmount(order.paidAmountMinor, order.paidCurrency)}`
              : "Uplata evidentirana"}
        </p>
      ) : (
        order.amountMinor !== null && (
          <p className={styles.amount}>
            {platformCreditsOnly &&
            order.kind !== "credits" &&
            !order.onlinePending &&
            (order.creditPrice !== null || order.status === "quoted") ? (
              order.creditPrice !== null ? (
                formatAhiCredits(Math.round(order.creditPrice * 100))
              ) : (
                "Cijena u kreditima nije dostupna"
              )
            ) : (
              <>
                {billingMoney(order.amountMinor)}
                {!platformCreditsOnly && order.creditPrice !== null && (
                  <small> ili {credits(order.creditPrice)} kredita</small>
                )}
              </>
            )}
          </p>
        )
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
      {!admin &&
        order.status === "quoted" &&
        ((checkoutAvailable && !bankOnlyTopUp && !platformCreditsOnly) ||
          ((bankOnlyTopUp || platformCreditsOnly) && order.onlinePending)) && (
          <Link className={styles.primaryLink} href={`/naplata?ponuda=${order.id}`}>
            {bankOnlyTopUp || platformCreditsOnly
              ? "Provjeri otvorenu uplatu"
              : order.onlinePending
                ? "Nastavi otvorenu uplatu"
                : "Plati ponudu"}
          </Link>
        )}
      {order.status === "quoted" && !order.onlinePending && (admin || !bankOnlyTopUp) && (
        <div className={styles.instructions}>
          <strong>
            {platformCreditsOnly || isProductionService(order.kind)
              ? "Detalji ponude"
              : "Upute za uplatu"}
          </strong>
          <p>{order.instructions}</p>
          {!platformCreditsOnly && <small>Poziv na broj: {order.id}</small>}
        </div>
      )}
      {admin && order.status === "requested" && (
        <form onSubmit={quote} className={styles.form}>
          {order.campaign?.targetingNote && (
            <label>
              Alternativna ponuda
              <select name="standardTargeting" required defaultValue="">
                <option value="" disabled>
                  Odaberi postupak
                </option>
                <option value="yes">Ponudi standardno ciljanje bez posebnog zahtjeva</option>
              </select>
            </label>
          )}
          {order.campaign?.estimateMinor != null && (
            <label>
              Obračun ponude
              <select
                value={benefit}
                onChange={(e) => setBenefit(e.target.value as typeof benefit)}
              >
                <option value="">Količinski popust ili dogovorena cijena</option>
                <option value="advance">Avansni popust</option>
                <option value="welcome">Popust dobrodošlice</option>
              </select>
            </label>
          )}
          {platformCreditsOnly ? (
            <label>
              Cijena (Ahi krediti)
              <input
                key={benefit}
                type="number"
                name="credits"
                min="0.01"
                step="0.01"
                max="100000"
                required
                readOnly={Boolean(benefit) && suggestedCredits !== null}
                defaultValue={
                  suggestedCredits !== null ? (suggestedCredits / 100).toFixed(2) : undefined
                }
              />
            </label>
          ) : (
            <label>
              Cijena (KM)
              <input
                name="price"
                inputMode="decimal"
                required
                maxLength={10}
                key={benefit}
                readOnly={Boolean(benefit)}
                defaultValue={
                  suggestedAmount !== null ? (suggestedAmount / 100).toFixed(2) : undefined
                }
              />
            </label>
          )}
          {!platformCreditsOnly && isPlacement(order.kind) && !benefit && (
            <label>
              Posebna cijena u kreditima (opcionalno)
              <input name="credits" type="number" min="1" step="1" max="100000" />
            </label>
          )}
          <label>
            {platformCreditsOnly
              ? isProductionService(order.kind)
                ? "Opis usluge"
                : "Detalji ponude"
              : isProductionService(order.kind)
                ? "Opis usluge i upute za uplatu"
                : "Primalac, račun i upute za uplatu"}
            <textarea name="instructions" maxLength={600} required rows={3} />
          </label>
          <button disabled={busy} type="submit">
            Pošalji ponudu
          </button>
        </form>
      )}
      {admin && !platformCreditsOnly && order.status === "quoted" && !order.onlinePending && (
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
        (isPlacement(order.kind) || (platformCreditsOnly && isProductionService(order.kind))) &&
        order.creditPrice !== null &&
        (Math.round(balance * 100) >= Math.round(order.creditPrice * 100) ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => submit({ action: "useCredits", id: order.id })}
          >
            Plati {formatAhiCredits(Math.round(order.creditPrice * 100))}
          </button>
        ) : (
          <Link
            className={styles.primaryLink}
            href={
              platformCreditsOnly
                ? creditTopUpPath(`/naplata?ponuda=${order.id}`)
                : "/nalog?odjeljak=krediti"
            }
          >
            Dopuni kredite · nedostaje{" "}
            {formatAhiCredits(Math.round(order.creditPrice * 100) - Math.round(balance * 100))}
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
export function MarketingWorkspace({
  accountId,
  mode,
  target,
  campaign,
  promotionView,
  returnTo,
}: MarketingProps) {
  return (
    <MarketingView
      key={`${accountId}:${mode}:${promotionView ?? ""}:${target?.businessId ?? ""}:${target?.placement ?? ""}:${campaign ? campaignPath(campaign) : ""}`}
      accountId={accountId}
      mode={mode}
      target={target}
      campaign={campaign}
      promotionView={promotionView}
      returnTo={returnTo}
    />
  );
}
type MarketingProps = {
  accountId: string;
  mode: MarketingMode;
  target?: PlacementTarget;
  campaign?: CampaignSelection;
  promotionView?: "aktivne" | "zakazane";
  returnTo?: string | null;
};
function MarketingView({
  accountId,
  mode,
  target,
  campaign,
  promotionView,
  returnTo,
}: MarketingProps) {
  const router = useRouter();
  const [selectedQuantity, setSelectedQuantity] = useState<number>(ahiCreditTopUps[0].quantity);
  const [chosenMethod, setChosenMethod] = useState<"card" | "paypal" | "bank">();
  const [rateInput, setRateInput] = useState("");
  const pendingTopUp = useRef<{ quantity: number; id: string } | null>(null);
  const pendingBankTopUp = useRef<BankTopUpCreate | null>(null);
  const bundle =
    ahiCreditTopUps.find((option) => option.quantity === selectedQuantity) ?? ahiCreditTopUps[0];
  const [data, setData] = useState<MarketingData | null>(null),
    [page, setPage] = useState(0),
    [refresh, setRefresh] = useState(0),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  const bankTopUps = useBankTopUps(
    accountId,
    mode === "credits" ? "mine" : mode === "admin" ? "admin" : null,
    () => {
      setPage(0);
      setRefresh((value) => value + 1);
    },
  );
  const receiver = bankTopUps.data?.available ? bankTopUps.data.bank : null;
  const bankOffer = receiver
    ? bankTopUps.data?.offers.find((offer) => offer.quantity === bundle.quantity)
    : null;
  const pendingBank = bankTopUps.data?.requests.find((request) => request.status === "pending");
  const bankHistory =
    bankTopUps.data?.requests.filter((request) => request.status !== "pending") ?? [];
  const purchaseReturn = creditTopUpReturn(returnTo);
  const platformCreditsOnly = data?.platformCreditsOnly === true;
  const bankOnly = platformCreditsOnly || data?.creditTopUpBankOnly === true;
  const paypalAvailable = !bankOnly && data?.checkoutAvailable === true;
  const cardAvailable = paypalAvailable && data?.creditCardTopUps === true;
  const method =
    receiver && (bankOnly || chosenMethod === "bank")
      ? "bank"
      : cardAvailable && chosenMethod !== "paypal"
        ? "card"
        : paypalAvailable
          ? "paypal"
          : receiver
            ? "bank"
            : null;
  const bundles = method === "bank" ? (bankTopUps.data?.offers ?? []) : ahiCreditTopUps;
  const running = useRef(false);
  const mounted = useRef(false);
  const placementForm = useRef<HTMLFormElement>(null);
  const openedPlacement = useRef(false);
  useEffect(() => {
    if (data && (target || campaign) && !openedPlacement.current) {
      openedPlacement.current = true;
      placementForm.current?.scrollIntoView({ block: "center" });
    }
  }, [data, target, campaign]);
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
    const params = new URLSearchParams({ mode, page: String(page) });
    if (promotionView) params.set("view", promotionView);
    fetch(`/api/marketing?${params}`, {
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
  }, [accountId, mode, page, promotionView, refresh]);
  async function submit(command: MarketingCommand, cardTopUp = false) {
    if (running.current) return false;
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
          router.push(`/naplata?ponuda=${result.id}${cardTopUp ? "&nacin=kartica" : ""}`);
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
      return true;
    } catch (error) {
      if (mounted.current)
        setMessage(
          (error instanceof Error ? messages[error.message] : null) ??
            "Rezultat nije potvrđen. Provjeri pregled zahtjeva.",
        );
      return false;
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
    if (busy || bankTopUps.busy || pendingBank || !method) return;
    if (method === "bank") {
      if (!receiver || !bankOffer) return;
      const previous = pendingBankTopUp.current;
      const command =
        previous?.quantity === bundle.quantity &&
        previous.expectedAmountMinor === bankOffer.amountMinor &&
        previous.currency === receiver.currency
          ? previous
          : {
              id: crypto.randomUUID(),
              quantity: bundle.quantity,
              expectedAmountMinor: bankOffer.amountMinor,
              currency: receiver.currency,
            };
      pendingBankTopUp.current = command;
      void bankTopUps.start(command).then((result) => {
        if (result && pendingBankTopUp.current === command) pendingBankTopUp.current = null;
      });
      return;
    }
    if (pendingTopUp.current?.quantity !== bundle.quantity) {
      pendingTopUp.current = { quantity: bundle.quantity, id: crypto.randomUUID() };
    }
    void submit(
      {
        action: "topUp",
        id: pendingTopUp.current.id,
        quantity: bundle.quantity,
        expectedAmountMinor: bundle.amountMinor,
      },
      method === "card",
    );
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
  const unitPrice = data.creditUnitBamMinor ?? null;
  const categoryCredits = creditsForBamMinor(categoryPromotionPriceBamMinor, unitPrice ?? 0);
  const orders = data.orders.filter((order) => !order.bankTopUp);
  const topUpInProgress = busy || bankTopUps.busy;
  return (
    <section className={styles.workspace}>
      {mode !== "admin" && <h1>{mode === "ads" ? "Moji oglasi" : "Ahi Credits"}</h1>}
      {mode === "ads" && (
        <nav aria-label="Prikaz oglasa" className={styles.viewTabs}>
          <Link href="/nalog?odjeljak=oglasi" aria-current={!promotionView ? "page" : undefined}>
            Svi zahtjevi
          </Link>
          <Link
            href="/nalog?odjeljak=oglasi&prikaz=aktivne"
            aria-current={promotionView === "aktivne" ? "page" : undefined}
          >
            Aktivne
          </Link>
          <Link
            href="/nalog?odjeljak=oglasi&prikaz=zakazane"
            aria-current={promotionView === "zakazane" ? "page" : undefined}
          >
            Zakazane
          </Link>
        </nav>
      )}
      {mode === "credits" && (
        <header className={styles.wallet}>
          <span>Raspoloživi krediti</span>
          <strong>{credits(data.balance)}</strong>
          {!platformCreditsOnly && unitPrice !== null && (
            <span>Pri plaćanju: {credits(100 / unitPrice)} kredita za 1 KM</span>
          )}
        </header>
      )}
      {mode === "admin" && <AdRateEditor accountId={accountId} />}
      {mode === "admin" && <BankTopUpAdmin workspace={bankTopUps} />}
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
          <header>
            <h2>Dopuni kredite</h2>
            {purchaseReturn && <Link href={purchaseReturn}>Vrati se na kupovinu</Link>}
          </header>
          {pendingBank ? (
            <CreditBankTransfer request={pendingBank} workspace={bankTopUps} />
          ) : bankOnly && !receiver ? (
            <div role="status">
              <p>
                {bankTopUps.failed
                  ? "Podatke za bankovnu uplatu trenutno nije moguće učitati."
                  : bankTopUps.data
                    ? "Bankovna dopuna trenutno nije dostupna."
                    : "Učitavam podatke za bankovnu uplatu…"}
              </p>
              {bankTopUps.failed && (
                <button type="button" onClick={bankTopUps.reread}>
                  Pokušaj ponovo
                </button>
              )}
            </div>
          ) : (
            <form className={styles.form} onSubmit={topUp}>
              <fieldset
                className={styles.bundles}
                aria-label="Odaberi dopunu"
                disabled={topUpInProgress}
              >
                {bundles.map((option) => (
                  <label className={styles.bundle} key={option.quantity}>
                    <span className={styles.bundlePrice}>
                      {method === "bank" && receiver
                        ? creditBankAmount(option.amountMinor, receiver.currency)
                        : billingMoney(option.amountMinor)}
                    </span>
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
              {method ? (
                <>
                  {!bankOnly && (
                    <fieldset className={styles.paymentMethods} disabled={topUpInProgress}>
                      <legend>Način dopune</legend>
                      {cardAvailable && (
                        <label className={styles.paymentOption}>
                          <input
                            type="radio"
                            name="nacin"
                            checked={method === "card"}
                            onChange={() => setChosenMethod("card")}
                          />
                          Kartica
                        </label>
                      )}
                      {paypalAvailable && (
                        <label className={styles.paymentOption}>
                          <input
                            type="radio"
                            name="nacin"
                            checked={method === "paypal"}
                            onChange={() => setChosenMethod("paypal")}
                          />
                          PayPal nalog
                        </label>
                      )}
                      {receiver && (
                        <label className={styles.paymentOption}>
                          <input
                            type="radio"
                            name="nacin"
                            checked={method === "bank"}
                            onChange={() => setChosenMethod("bank")}
                          />
                          Uplata na {receiver.name}
                        </label>
                      )}
                    </fieldset>
                  )}
                  <button
                    type="submit"
                    disabled={topUpInProgress || (method === "bank" && !bankOffer)}
                  >
                    {method === "card"
                      ? `Plati karticom · ${billingMoney(bundle.amountMinor)}`
                      : method === "paypal"
                        ? `Nastavi na PayPal · ${billingMoney(bundle.amountMinor)}`
                        : bankOffer && receiver
                          ? `Upute za uplatu · ${creditBankAmount(bankOffer.amountMinor, receiver.currency)}`
                          : "Prikaži upute za uplatu"}
                  </button>
                </>
              ) : (
                <p>Dopuna kredita trenutno nije dostupna.</p>
              )}
            </form>
          )}
          {bankTopUps.message && <p role="status">{bankTopUps.message}</p>}
        </article>
      )}
      {mode === "ads" && promotionView !== "zakazane" && data.included.length > 0 && (
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
      {mode === "ads" && promotionView !== "zakazane" && (
        <article className={styles.order}>
          <header>
            <h2>Isticanje u kategoriji</h2>
            <small>
              7 dana
              {platformCreditsOnly
                ? categoryCredits === null
                  ? ""
                  : ` · ${formatAhiCredits(categoryCredits)}`
                : " · 10 KM"}
            </small>
          </header>
          {data.promotions.map((item) => (
            <p key={item.id}>
              <Link href={`/djelatnosti/${item.id}`}>{item.title}</Link> · do{" "}
              {new Date(item.endsAt).toLocaleDateString("bs-BA")}
            </p>
          ))}
          {(platformCreditsOnly
            ? categoryCredits !== null
            : data.checkoutAvailable || unitPrice !== null) && data.businesses.length > 0 ? (
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
      {mode === "ads" && !promotionView && data.businesses.length > 0 && (
        <AdCampaignForm
          data={data}
          target={target}
          selection={campaign}
          submit={submit}
          busy={busy}
          formRef={placementForm}
        />
      )}
      {mode === "ads" && !promotionView && (
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
      {mode === "credits" && bankHistory.length > 0 && (
        <article className={styles.order}>
          <h2>Bankovne uplate</h2>
          <ul className={styles.bankList}>
            {bankHistory.map((request) => (
              <li className={styles.bankOrder} key={request.id}>
                <strong>
                  {formatAhiCredits(request.quantity * 100)} ·{" "}
                  {creditBankAmount(request.amountMinor, request.currency)}
                </strong>
                <span>
                  {request.status === "approved" ? "Uplata potvrđena" : "Zahtjev otkazan"} ·{" "}
                  {new Date(request.approvedAt ?? request.createdAt).toLocaleDateString([
                    "bs-BA",
                    "hr-HR",
                  ])}
                </span>
                <details>
                  <summary>Referenca uplate</summary>
                  <p>{request.paymentReference}</p>
                </details>
              </li>
            ))}
          </ul>
        </article>
      )}
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
        <h2>
          {mode === "admin"
            ? "Zahtjevi i uplate"
            : promotionView === "aktivne"
              ? "Aktivne kampanje"
              : promotionView === "zakazane"
                ? "Zakazane kampanje"
                : "Moji zahtjevi"}
        </h2>
        {!orders.length && (
          <p>
            {mode === "admin"
              ? "Nema zahtjeva."
              : promotionView
                ? "Nema kampanja za ovaj prikaz."
                : "Još nemaš zahtjeva."}
          </p>
        )}
        {orders.map((order) => (
          <OfferCard
            key={order.id}
            accountId={accountId}
            order={order}
            refresh={() => setRefresh((v) => v + 1)}
            checkoutAvailable={data.checkoutAvailable}
            creditTopUpBankOnly={bankOnly}
            platformCreditsOnly={platformCreditsOnly}
            walletRate={unitPrice}
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
