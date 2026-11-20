"use client";

import { useEffect, useRef, useState } from "react";
import {
  type BillingPackageId,
  type BillingPeriod,
  billingMoney,
  billingPackages,
} from "../../lib/billing";
import type { PackageBenefitsCatalog } from "../../lib/package-benefits";
import { checkoutEuro } from "../../lib/paypal-card-flow";
import {
  awaitingFirstSandboxPayment,
  followSandboxFirstPayment,
  type SandboxContractStatus,
  type SandboxPackageContract,
  type SandboxPackageQuote,
} from "../../lib/sandbox-subscriptions";
import styles from "./billing.module.css";
import { SubscriptionCardButton } from "./SubscriptionCardButton";

type Business = {
  id: string;
  title: string;
  status?: string;
  latitude?: number | null;
  longitude?: number | null;
  packagePaymentNeeded?: boolean;
};
type Catalog = PackageBenefitsCatalog & {
  available: boolean;
  packages: SandboxPackageQuote[];
  sellable: BillingPackageId[];
  paypalClientId?: string | null;
};
type ContractApproval = {
  contract: SandboxPackageContract;
  approvalUrl?: string | null;
  subscriptionId?: string | null;
};

const statusLabels: Record<SandboxContractStatus, string> = {
  CREATING: "U pripremi",
  APPROVAL_PENDING: "Čeka tvoje odobrenje",
  APPROVED: "Odobrena",
  ACTIVE: "Aktivna",
  SUSPENDED: "Pauzirana",
  CANCELLED: "Otkazana",
  EXPIRED: "Raspored naplate završen",
};

async function request<T>(
  path: string,
  userId: string,
  signal?: AbortSignal,
  body?: object,
): Promise<T> {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal,
    headers: {
      "X-AhiBizz-Account-ID": userId,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403)
      throw new Error("Pristup nije dostupan. Provjeri svoj nalog.");
    if (response.status === 409) {
      const detail = await response.json().catch(() => null);
      if (detail?.code === "PACKAGE_BENEFITS_CHANGED")
        throw new Error("Ponuda je izmijenjena. Učitaj novi uslov prije plaćanja.");
      if (detail?.code === "PACKAGE_LOCATION_REQUIRED")
        throw new Error("Za prikaz u blizini označi djelatnost na karti.");
      if (detail?.code === "PACKAGE_NOT_AVAILABLE")
        throw new Error("Prodaja ovog paketa je trenutno zatvorena.");
      if (detail?.code === "BUSINESS_ALREADY_COVERED")
        throw new Error("Ova djelatnost već ima pravo na usluge odabranog paketa.");
      if (detail?.code === "SUBSCRIPTION_SETTLEMENT_PENDING")
        throw new Error("PayPal još obrađuje uplatu. Provjeri status postojeće pretplate.");
      throw new Error("Za ovu djelatnost već postoji pretplata. Provjeri njen status ispod.");
    }
    throw new Error("Zahtjev nije završen. Provjeri status pretplate prije novog pokušaja.");
  }
  return response.json() as Promise<T>;
}

async function ownedBusinesses(userId: string, signal: AbortSignal, sandbox: boolean) {
  const businesses: Business[] = [];
  for (let page = 1; ; page++) {
    const result = await request<{ items: Business[]; hasMore: boolean }>(
      `/api/directory/mine?page=${page}&pageSize=50${sandbox ? "&status=published" : ""}`,
      userId,
      signal,
    );
    businesses.push(...result.items.filter((b) => b.status !== "archived"));
    if (!result.hasMore || !result.items.length) return businesses;
  }
}

export function PackageCheckout({
  environment = "sandbox",
  initialPeriod = "monthly",
  userId,
  initialPackage,
  initialContract,
  abandoned,
}: {
  environment?: "live" | "sandbox";
  initialPeriod?: BillingPeriod;
  userId: string;
  initialPackage: BillingPackageId;
  initialContract: string | null;
  abandoned: boolean;
}) {
  const sandbox = environment === "sandbox";
  const api = sandbox ? "/api/test-paketi" : "/api/paketi";
  const pagePath = sandbox ? "/paketi/proba" : "/paketi/placanje";
  const contractsPath = `${api}/contracts`;
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessId, chooseBusiness] = useState("");
  const [packageId, choosePackage] = useState(initialPackage);
  const [period, choosePeriod] = useState<BillingPeriod>(initialPeriod);
  const [accepted, accept] = useState(false);
  const [contracts, setContracts] = useState<SandboxPackageContract[]>([]);
  const [returnChecked, setReturnChecked] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"card" | "paypal">("paypal");
  const [cardResume, setCardResume] = useState("");
  const cardReturnPath = useRef("");
  const cardAttempt = useRef(0);

  const eventLock = useRef(false);
  const reportPoll = useRef<AbortController | null>(null);
  const pendingKey = useRef<{ selection: string; id: string } | null>(null);
  const quote = catalog?.packages.find((plan) => plan.id === packageId);
  const monthly = period === "monthly";
  const selected = billingPackages.find((p) => p.id === packageId) ?? billingPackages[0];
  const benefit = catalog?.benefits[packageId];
  const eligibleBusinesses = businesses.filter(
    (b) =>
      sandbox ||
      ((!benefit?.nearbyDays || (b.latitude != null && b.longitude != null)) &&
        (Boolean(benefit?.nearbyDays || benefit?.featuredDays) || b.packagePaymentNeeded)),
  );
  const ready = catalog?.available && catalog.sellable.includes(packageId);
  const chosenBusiness =
    eligibleBusinesses.find((b) => b.id === businessId)?.id ?? eligibleBusinesses[0]?.id ?? "";
  const canSubmit = Boolean(ready && chosenBusiness && quote && accepted);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const params = new URLSearchParams({ paket: initialPackage, period: initialPeriod });
    if (initialContract) params.set("ugovor", initialContract);
    if (abandoned) params.set("odustao", "1");
    window.history.replaceState(window.history.state, "", `${pagePath}?${params}`);
    async function load() {
      setError("");
      try {
        const [pricing, mine, history] = await Promise.all([
          request<Catalog>(`${api}/catalog`, userId, signal),
          ownedBusinesses(userId, signal, sandbox),
          request<{ contracts: SandboxPackageContract[] }>(contractsPath, userId, signal),
        ]);
        if (signal.aborted) return;
        setCatalog(pricing);
        setBusinesses(mine);
        chooseBusiness((id) => mine.find((b) => b.id === id)?.id ?? mine[0]?.id ?? "");
        setContracts(history.contracts);
        if (
          initialContract &&
          !abandoned &&
          history.contracts.some((c) => c.id === initialContract && c.status !== "CREATING")
        ) {
          const updated = await request<{ contract: SandboxPackageContract }>(
            `${contractsPath}/${initialContract}/refresh`,
            userId,
            signal,
            {},
          );
          if (!signal.aborted) {
            setContracts((values) =>
              values.map((c) => (c.id === initialContract ? updated.contract : c)),
            );
            setReturnChecked(updated.contract.id);
          }
        }
      } catch (e) {
        if (!signal.aborted) setError(e instanceof Error ? e.message : "Pretplate nisu dostupne.");
      }
    }
    void load();
    return () => controller.abort();
  }, [
    api,
    pagePath,
    contractsPath,
    userId,
    initialPackage,
    initialPeriod,
    initialContract,
    abandoned,
    sandbox,
  ]);

  const pendingReturn =
    !abandoned && initialContract === returnChecked && !busy
      ? contracts.find((c) => c.id === initialContract && awaitingFirstSandboxPayment(c))?.id
      : undefined;
  useEffect(() => {
    if (!pendingReturn) return;
    const controller = new AbortController();
    reportPoll.current = controller;
    void followSandboxFirstPayment(
      pendingReturn,
      controller.signal,
      async (signal) =>
        (
          await request<{ contract: SandboxPackageContract }>(
            `${contractsPath}/${pendingReturn}/refresh`,
            userId,
            signal,
            {},
          )
        ).contract,
      (contract) =>
        setContracts((values) =>
          values.map((c) =>
            c.id === pendingReturn && awaitingFirstSandboxPayment(c) ? contract : c,
          ),
        ),
    );
    return () => {
      controller.abort();
      reportPoll.current = null;
    };
  }, [pendingReturn, userId, contractsPath]);

  function contractPath(contract: SandboxPackageContract) {
    const params = new URLSearchParams({
      paket: contract.packageId,
      period: contract.period,
      ugovor: contract.id,
    });
    return `${pagePath}?${params}`;
  }

  function remember(contract: SandboxPackageContract) {
    setContracts((values) => [contract, ...values.filter((c) => c.id !== contract.id)]);
  }

  function prepare(existing?: SandboxPackageContract) {
    const selection = `${chosenBusiness}:${packageId}:${period}:${catalog?.version ?? ""}`;
    if (!existing && pendingKey.current?.selection !== selection)
      pendingKey.current = { selection, id: crypto.randomUUID() };
    return request<ContractApproval>(contractsPath, userId, undefined, {
      requestId: existing?.requestId ?? pendingKey.current?.id,
      businessId: existing?.businessId ?? chosenBusiness,
      packageId: existing?.packageId ?? packageId,
      period: existing?.period ?? period,
      accepted: true,
      ...(!sandbox ? { benefitsVersion: existing?.benefitsVersion ?? catalog?.version } : {}),
    });
  }

  async function startCard(existing?: SandboxPackageContract) {
    if (eventLock.current || (!existing && !canSubmit))
      throw new Error("Plaćanje trenutno nije dostupno.");
    reportPoll.current?.abort();
    eventLock.current = true;
    const attempt = ++cardAttempt.current;
    setBusy(true);
    setError("");
    try {
      const result = await prepare(existing);
      if (attempt !== cardAttempt.current) throw new Error("Kartično plaćanje je zatvoreno.");
      remember(result.contract);
      if (
        result.contract.status !== "APPROVAL_PENDING" ||
        !result.subscriptionId ||
        !/^I-[A-Z0-9]{5,32}$/.test(result.subscriptionId)
      )
        throw new Error("Provjeri status postojeće pretplate.");
      cardReturnPath.current = contractPath(result.contract);
      window.history.replaceState(window.history.state, "", cardReturnPath.current);
      return { localId: result.contract.id, subscriptionId: result.subscriptionId };
    } catch (e) {
      if (attempt === cardAttempt.current)
        finishCard(e instanceof Error ? e.message : "Zahtjev nije završen.");
      throw e;
    }
  }

  function finishCard(message: string) {
    cardAttempt.current++;
    cardReturnPath.current = "";
    eventLock.current = false;
    setBusy(false);
    setError((current) => current || message);
  }

  function cardButton(existing?: SandboxPackageContract) {
    if (!catalog?.paypalClientId)
      return <p className={styles.notice}>Kartično plaćanje trenutno nije dostupno.</p>;
    return (
      <SubscriptionCardButton
        key={existing?.id ?? `${chosenBusiness}:${packageId}:${period}:${catalog.version}`}
        clientId={catalog.paypalClientId}
        environment={environment}
        accepted={Boolean(existing) || accepted}
        create={() => startCard(existing)}
        approved={() => {
          if (eventLock.current && cardReturnPath.current)
            window.location.assign(cardReturnPath.current);
        }}
        finished={finishCard}
      />
    );
  }

  async function perform(
    action: "create" | "resume" | "refresh" | "cancel",
    existing?: SandboxPackageContract,
  ) {
    if (eventLock.current || (action === "create" && !canSubmit)) return;
    reportPoll.current?.abort();
    eventLock.current = true;
    setBusy(true);
    setError("");
    try {
      let result: ContractApproval;
      if (action === "create" || action === "resume") {
        result = await prepare(existing);
      } else {
        if (!existing) return;
        result = await request(`${contractsPath}/${existing.id}/${action}`, userId, undefined, {});
      }
      remember(result.contract);
      if (action === "refresh" && result.contract.id === initialContract)
        setReturnChecked(result.contract.id);
      setConfirmCancel("");
      if (action === "cancel") pendingKey.current = null;
      if (result.approvalUrl) {
        const approval = new URL(result.approvalUrl);
        if (
          approval.origin !==
            (sandbox ? "https://www.sandbox.paypal.com" : "https://www.paypal.com") ||
          approval.username ||
          approval.password
        )
          throw new Error("Adresa za odobravanje plaćanja nije ispravna.");
        window.history.replaceState(window.history.state, "", contractPath(result.contract));
        window.location.assign(approval.href);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Zahtjev nije završen.");
    } finally {
      eventLock.current = false;
      setBusy(false);
    }
  }

  return (
    <section className={styles.workspace}>
      <header className={styles.heading}>
        <h1>{sandbox ? "Probne pretplate" : "Plaćanje paketa"}</h1>
        {sandbox && <span className={styles.badge}>PayPal Sandbox</span>}
      </header>
      {!sandbox && (
        <div className={styles.orderSummary}>
          <h2>{selected.name}</h2>
          <p>{monthly ? "12 mjesečnih rata" : "Jedna uplata za 12 mjeseci"}</p>
          <strong>{billingMoney(monthly ? selected.monthlyMinor : selected.annualMinor)}</strong>
          {benefit && (
            <p>
              {benefit.nearbyDays || benefit.featuredDays
                ? `${benefit.nearbyDays} dana u blizini · ${benefit.featuredDays} dana na početnoj po plaćenom mjesecu.`
                : "Poslovni profil i zakazivanje termina."}
            </p>
          )}
          <a href="/paketi">Promijeni paket</a>
        </div>
      )}
      {abandoned && (
        <p className={styles.notice}>
          Odobravanje je prekinuto. Status pretplate možeš provjeriti ispod.
        </p>
      )}
      {error && (
        <div className={styles.error} role="alert">
          {error}{" "}
          <button
            type="button"
            className={styles.secondary}
            disabled={busy}
            onClick={() => window.location.reload()}
          >
            Učitaj ponovo
          </button>
        </div>
      )}
      {catalog && !catalog.available && (
        <p className={styles.notice}>
          {sandbox
            ? "Probna naplata trenutno nije dostupna."
            : "Online plaćanje paketa još nije uključeno."}
        </p>
      )}
      {catalog?.available && !ready && (
        <p className={styles.notice}>Prodaja ovog paketa još nije otvorena.</p>
      )}
      {ready && !eligibleBusinesses.length && (
        <p className={styles.notice}>
          {sandbox
            ? "Za pretplatu trebaš objavljenu djelatnost."
            : benefit?.nearbyDays && businesses.length
              ? "Za prikaz u blizini prvo označi djelatnost na karti."
              : "Prva djelatnost ima besplatnu godinu. Dodatnu djelatnost dodaj kao nacrt."}{" "}
          <a href="/nalog?odjeljak=djelatnosti">Moje djelatnosti</a>
        </p>
      )}
      {ready && eligibleBusinesses.length > 0 && (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            if (paymentMethod === "paypal") void perform("create");
          }}
        >
          <fieldset disabled={busy}>
            <div className={styles.fields}>
              <label>
                Djelatnost
                <select
                  value={chosenBusiness}
                  onChange={(e) => {
                    chooseBusiness(e.target.value);
                    accept(false);
                  }}
                >
                  {eligibleBusinesses.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Paket
                <select
                  value={packageId}
                  onChange={(e) => {
                    choosePackage(e.target.value as BillingPackageId);
                    accept(false);
                  }}
                >
                  {catalog.packages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Raspored uplata
                <select
                  value={period}
                  onChange={(e) => {
                    choosePeriod(e.target.value as BillingPeriod);
                    accept(false);
                  }}
                >
                  <option value="monthly">Mjesečno · 12 rata</option>
                  <option value="annual">Godišnje · jedna uplata</option>
                </select>
              </label>
            </div>
            {quote && (
              <p className={styles.notice}>
                {monthly
                  ? `${billingMoney(quote.monthlyMinor)} mjesečno. PayPal naplaćuje 12 rata po ${checkoutEuro(quote.monthlyEurMinor)}.`
                  : `${billingMoney(quote.annualMinor)} godišnje. PayPal naplaćuje ${checkoutEuro(quote.annualEurMinor)} jednom za 12 mjeseci.`}
              </p>
            )}
            <label>
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => accept(e.target.checked)}
              />{" "}
              {sandbox
                ? "Prihvatam odabrani raspored probnih uplata."
                : monthly
                  ? "Prihvatam ugovor na 12 mjeseci i 12 prikazanih mjesečnih rata."
                  : "Prihvatam jednu uplatu za 12 mjeseci usluge."}
            </label>
            <fieldset className={styles.methodPicker}>
              <legend>Način plaćanja</legend>
              {(["card", "paypal"] as const).map((method) => (
                <label key={method}>
                  <input
                    type="radio"
                    name="package-method"
                    value={method}
                    checked={paymentMethod === method}
                    onChange={() => {
                      setPaymentMethod(method);
                      setCardResume("");
                      setError("");
                    }}
                  />
                  {method === "card" ? "Kartica" : "PayPal"}
                </label>
              ))}
            </fieldset>
            {paymentMethod === "card" && !cardResume
              ? cardButton()
              : paymentMethod === "paypal" && (
                  <div className={styles.actions}>
                    <button type="submit" disabled={!canSubmit} className={styles.primary}>
                      {sandbox ? "Odobri u PayPal Sandboxu" : "Nastavi na PayPal"}
                    </button>
                  </div>
                )}
          </fieldset>
        </form>
      )}
      {contracts.length > 0 && (
        <section
          aria-label={sandbox ? "Moje probne pretplate" : "Moje pretplate"}
          className={styles.list}
        >
          <h2>{sandbox ? "Moje probne pretplate" : "Moje pretplate"}</h2>
          {contracts.map((c) => (
            <article key={c.id} className={styles.receipt}>
              <div className={styles.receiptHeader}>
                <div>
                  <h3>{c.businessTitle}</h3>
                  <p>
                    {billingPackages.find((p) => p.id === c.packageId)?.name} ·{" "}
                    {c.period === "monthly" ? "Mjesečno" : "Godišnje"}
                  </p>
                </div>
                <span className={styles.badge}>{statusLabels[c.status]}</span>
              </div>
              <dl className={styles.details}>
                <div>
                  <dt>Potvrđene uplate</dt>
                  <dd>
                    {c.paidCycles} / {c.totalCycles}
                  </dd>
                </div>
                <div>
                  <dt>Uplaćeno</dt>
                  <dd>{checkoutEuro(c.paidEurMinor)}</dd>
                </div>
                {c.endsAt && (
                  <div>
                    <dt>Plaćeno do</dt>
                    <dd>
                      <time dateTime={c.endsAt}>
                        {new Intl.DateTimeFormat(["bs-BA", "hr-HR"], {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                          hourCycle: "h23",
                          timeZone: "Europe/Sarajevo",
                        }).format(new Date(c.endsAt))}
                      </time>
                    </dd>
                  </div>
                )}
              </dl>
              {c.benefitsVersion && (
                <p className={styles.footnote}>
                  Ugovorene pogodnosti · {c.nearbyDays} dana u blizini i {c.featuredDays} dana na
                  početnoj po plaćenom mjesecu.
                </p>
              )}
              {awaitingFirstSandboxPayment(c) && (
                <p className={styles.footnote} role="status">
                  Čekamo PayPalov zapis prve uplate.
                </p>
              )}
              <div className={styles.actions}>
                {(c.status === "CREATING" || c.status === "APPROVAL_PENDING") && (
                  <>
                    <button
                      type="button"
                      className={styles.primary}
                      disabled={busy}
                      onClick={() => void perform("resume", c)}
                    >
                      Nastavi preko PayPala
                    </button>
                    {catalog?.paypalClientId && (
                      <button
                        type="button"
                        className={styles.secondary}
                        disabled={busy}
                        onClick={() => {
                          setCardResume(c.id);
                          setPaymentMethod("card");
                          setError("");
                        }}
                      >
                        Nastavi karticom
                      </button>
                    )}
                  </>
                )}
                {c.status !== "CREATING" && (
                  <button
                    type="button"
                    className={styles.secondary}
                    disabled={busy}
                    onClick={() => void perform("refresh", c)}
                  >
                    Provjeri status
                  </button>
                )}
                {(["ACTIVE", "SUSPENDED", "APPROVED"] as SandboxContractStatus[]).includes(
                  c.status,
                ) &&
                  (confirmCancel === c.id ? (
                    <>
                      <button
                        type="button"
                        className={styles.danger}
                        disabled={busy}
                        onClick={() => void perform("cancel", c)}
                      >
                        Potvrdi otkazivanje
                      </button>
                      <button
                        type="button"
                        className={styles.secondary}
                        disabled={busy}
                        onClick={() => setConfirmCancel("")}
                      >
                        Zadrži pretplatu
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className={styles.secondary}
                      disabled={busy}
                      onClick={() => setConfirmCancel(c.id)}
                    >
                      Otkaži pretplatu
                    </button>
                  ))}
              </div>
              {cardResume === c.id &&
                (c.status === "CREATING" || c.status === "APPROVAL_PENDING") &&
                cardButton(c)}
            </article>
          ))}
        </section>
      )}
    </section>
  );
}
