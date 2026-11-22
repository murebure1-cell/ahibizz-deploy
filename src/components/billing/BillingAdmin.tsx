"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type BillingAdjustmentInput,
  type BillingDevelopmentEntry,
  type BillingReceipt,
  type BillingReceiptInput,
  type BillingReply,
  type BillingRequest,
  BillingRequestError,
  type BillingSummary,
  billingActorRequest,
  billingMoney,
  billingPackages,
  billingRequest,
} from "../../lib/billing";
import { bosnianDateTime } from "../../lib/display-date";
import { IS_PLAY_EDITION } from "../../lib/distribution";
import styles from "./billing.module.css";
import {
  assertBillingOwner,
  billingDenied,
  billingUiError,
  billingUncertain,
  billingUuid,
  readBillingEntries,
  readBillingReceipt,
  readBillingSummary,
} from "./model";
import { PackageSetup } from "./PackageSetup";
import { type BillingBusinessChoice, ReceiptForm } from "./ReceiptForm";

type Props = {
  expectedAccountId?: string;
  request?: BillingRequest;
  active?: boolean;
  embedded?: boolean;
  pendingOnly?: boolean;
};
type Pending = { kind: "create"; key: string } | { kind: "adjust"; id: string; version: number };
const kindLabels = { subscription: "Pretplata", photo_video: "Foto i video" };
const sources = { bank: "Bankovna uplata", paypal: "PayPal", cash: "Gotovina", other: "Drugo" };
const amount = (value: number | null) => (value === null ? "Nepoznato" : billingMoney(value));
const invalid = () => new BillingRequestError("BILLING_UNAVAILABLE", 502);
const json = (method: string, input: unknown, key?: string): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
  body: JSON.stringify(input),
});

export function BillingAdmin(props: Props) {
  const boundary = useMemo(
    () => ({ id: props.expectedAccountId, request: props.request }),
    [props.expectedAccountId, props.request],
  );
  const mounted = useRef({ boundary, key: 0 });
  if (mounted.current.boundary !== boundary)
    mounted.current = { boundary, key: mounted.current.key + 1 };
  return <BillingWorkspace key={mounted.current.key} {...props} />;
}
function BillingWorkspace({
  expectedAccountId,
  request: rawRequest = billingRequest,
  active = true,
  embedded = false,
  pendingOnly = false,
}: Props) {
  const request = useMemo(
    () => billingActorRequest(expectedAccountId, rawRequest),
    [expectedAccountId, rawRequest],
  );
  const [tab, setTab] = useState<"receipts" | "development">("receipts"),
    [page, setPage] = useState(1),
    [developmentPage, setDevelopmentPage] = useState(1);
  const [rows, setRows] = useState<BillingReceipt[] | null>(null),
    [rowPage, setRowPage] = useState(1),
    [summary, setSummary] = useState<BillingSummary | null>(null);
  const [entries, setEntries] = useState<BillingDevelopmentEntry[] | null>(null),
    [entryPage, setEntryPage] = useState(1),
    [hasMore, setHasMore] = useState(false),
    [developmentMore, setDevelopmentMore] = useState(false);
  const [authorized, setAuthorized] = useState(false),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [form, setForm] = useState<"new" | BillingReceipt | null>(null),
    [pending, setPending] = useState<Pending | null>(null);
  const [businesses, setBusinesses] = useState<BillingBusinessChoice[]>([]),
    [businessLoading, setBusinessLoading] = useState(false),
    [businessPage, setBusinessPage] = useState(1),
    [businessMore, setBusinessMore] = useState(false),
    [businessQuery, setBusinessQuery] = useState("");
  const live = useRef(false),
    epoch = useRef(0),
    reads = useRef(0),
    businessReads = useRef(0),
    writing = useRef(false),
    pendingRef = useRef<Pending | null>(null);
  const readController = useRef<AbortController | null>(null),
    businessController = useRef<AbortController | null>(null),
    writeController = useRef<AbortController | null>(null);
  const current = useCallback((access: number) => live.current && epoch.current === access, []);
  const clearDenied = useCallback(() => {
    epoch.current++;
    reads.current++;
    businessReads.current++;
    readController.current?.abort();
    businessController.current?.abort();
    writeController.current?.abort();
    writing.current = false;
    writeController.current = null;
    setRows(null);
    setEntries(null);
    setSummary(null);
    setBusinesses([]);
    setForm(null);
    setAuthorized(false);
    setNotice("");
    setHasMore(false);
    setDevelopmentMore(false);
    setBusinessMore(false);
    setBusinessQuery("");
    setBusinessLoading(false);
    setBusy(false);
    setLoading(false);
    setPending(pendingRef.current);
    setError("Prijava ili administratorski pristup više nije dostupan.");
  }, []);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      epoch.current++;
      readController.current?.abort();
      businessController.current?.abort();
      writeController.current?.abort();
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh explicitly requests a fresh, actor-checked ledger snapshot.
  useEffect(() => {
    if (!active || writing.current) return;
    readController.current?.abort();
    const controller = new AbortController(),
      revision = ++reads.current,
      access = epoch.current;
    readController.current = controller;
    setLoading(true);
    void request(
      tab === "receipts"
        ? `admin${pendingOnly ? "/pending" : ""}?page=${page}`
        : `admin/development?page=${developmentPage}`,
      { signal: controller.signal },
    )
      .then((reply) => {
        assertBillingOwner(reply, expectedAccountId);
        if (!current(access) || controller.signal.aborted || revision !== reads.current) return;
        if (
          typeof reply.hasMore !== "boolean" ||
          reply.page !== (tab === "receipts" ? page : developmentPage)
        )
          throw invalid();
        if (tab === "receipts") {
          if (!Array.isArray(reply.receipts) || reply.receipts.length > 30) throw invalid();
          const next = reply.receipts.map(readBillingReceipt);
          if (new Set(next.map((row) => row.id)).size !== next.length) throw invalid();
          setRows(next);
          setRowPage(page);
          setSummary(readBillingSummary(reply.summary));
          setHasMore(reply.hasMore);
        } else {
          setEntries(readBillingEntries(reply.developmentEntries));
          setEntryPage(developmentPage);
          setDevelopmentMore(reply.hasMore);
        }
        setAuthorized(true);
      })
      .catch((failure) => {
        if (!current(access)) return;
        if (billingDenied(failure)) {
          clearDenied();
          return;
        }
        if (!controller.signal.aborted && revision === reads.current)
          setError(billingUiError(failure));
      })
      .finally(() => {
        if (current(access) && !controller.signal.aborted && revision === reads.current)
          setLoading(false);
      });
    return () => controller.abort();
  }, [
    active,
    tab,
    page,
    developmentPage,
    pendingOnly,
    refresh,
    request,
    expectedAccountId,
    clearDenied,
    current,
  ]);

  async function findBusiness(query: string, nextPage: number) {
    if (!active || !authorized || writing.current) return;
    if (query.length > 80 || nextPage < 1 || nextPage > 999) return;
    businessController.current?.abort();
    const controller = new AbortController(),
      revision = ++businessReads.current,
      access = epoch.current;
    businessController.current = controller;
    setBusinessLoading(true);
    try {
      const reply = await request(
        `admin/businesses?page=${nextPage}&q=${encodeURIComponent(query)}`,
        { signal: controller.signal },
      );
      assertBillingOwner(reply, expectedAccountId);
      if (!current(access) || controller.signal.aborted || revision !== businessReads.current)
        return;
      const choices = (reply as BillingReply & { businesses?: BillingBusinessChoice[] }).businesses;
      if (
        reply.page !== nextPage ||
        typeof reply.hasMore !== "boolean" ||
        !Array.isArray(choices) ||
        choices.length > 30 ||
        choices.some(
          (row) =>
            !row || !billingUuid.test(row.id) || typeof row.title !== "string" || !row.title.trim(),
        ) ||
        new Set(choices.map((row) => row.id)).size !== choices.length
      )
        throw invalid();
      setBusinesses(choices);
      setBusinessPage(nextPage);
      setBusinessMore(reply.hasMore);
      setBusinessQuery(query);
    } catch (failure) {
      if (!current(access)) return;
      if (billingDenied(failure)) {
        clearDenied();
        return;
      }
      if (!controller.signal.aborted && revision === businessReads.current)
        setError("Djelatnosti trenutno nisu dostupne.");
    } finally {
      if (current(access) && !controller.signal.aborted && revision === businessReads.current)
        setBusinessLoading(false);
    }
  }
  function forgetPending() {
    pendingRef.current = null;
    setPending(null);
  }
  function acceptReceipt(receipt: BillingReceipt) {
    reads.current++;
    readController.current?.abort();
    setRows((previous) => {
      if (!previous) return page === 1 ? [receipt] : null;
      const old = previous.find((row) => row.id === receipt.id);
      if (old && old.version > receipt.version) return previous;
      return old
        ? previous.map((row) => (row.id === receipt.id ? receipt : row))
        : page === 1
          ? [receipt, ...previous].slice(0, 30)
          : previous;
    });
    setRowPage(page);
    setSummary(null);
    setEntries(null);
    setForm(null);
    setBusinesses([]);
  }
  async function reconcile(command: Pending, controller: AbortController, access: number) {
    try {
      const reply = await request(
        command.kind === "create"
          ? `admin/commands/${command.key}`
          : `admin/receipts/${command.id}`,
        { signal: controller.signal },
      );
      assertBillingOwner(reply, expectedAccountId);
      if (!current(access) || controller.signal.aborted || pendingRef.current !== command) return;
      if (reply.receipt === null && command.kind === "create") {
        setError("Prethodna evidencija još nije potvrđena. Provjeri ponovo.");
        return;
      }
      const receipt = readBillingReceipt(reply.receipt);
      if (command.kind === "adjust") {
        if (receipt.id !== command.id || receipt.version < command.version) throw invalid();
        if (receipt.version === command.version) {
          setError("Prethodna ispravka još nije potvrđena. Provjeri ponovo.");
          return;
        }
      }
      acceptReceipt(receipt);
      forgetPending();
      setAuthorized(true);
      setError("");
      setNotice("Trenutno stanje je učitano. Provjeri evidentirane iznose.");
    } catch (failure) {
      if (!current(access) || controller.signal.aborted || pendingRef.current !== command) return;
      if (billingDenied(failure)) {
        clearDenied();
        return;
      }
      setError("Ishod prethodne radnje još nije potvrđen. Provjeri ponovo.");
    }
  }
  async function checkPending() {
    const command = pendingRef.current;
    if (!command || writing.current || !active) return;
    const controller = new AbortController(),
      access = epoch.current;
    writing.current = true;
    writeController.current = controller;
    setBusy(true);
    setError("");
    try {
      await reconcile(command, controller, access);
    } finally {
      if (writeController.current === controller) {
        writeController.current = null;
        writing.current = false;
        if (current(access) && !controller.signal.aborted) {
          setBusy(false);
          setRefresh((value) => value + 1);
        }
      }
    }
  }
  async function submit(
    input: BillingReceiptInput | BillingAdjustmentInput,
    receipt?: BillingReceipt,
  ) {
    if (!active || !authorized || writing.current || pendingRef.current) return;
    const controller = new AbortController(),
      access = epoch.current;
    const command: Pending = receipt
      ? { kind: "adjust", id: receipt.id, version: receipt.version }
      : { kind: "create", key: crypto.randomUUID() };
    writing.current = true;
    pendingRef.current = command;
    writeController.current = controller;
    reads.current++;
    readController.current?.abort();
    setBusy(true);
    setLoading(false);
    setError("");
    setNotice("");
    try {
      const reply = await request(receipt ? `admin/receipts/${receipt.id}` : "admin/receipts", {
        ...json(
          receipt ? "PATCH" : "POST",
          input,
          command.kind === "create" ? command.key : undefined,
        ),
        signal: controller.signal,
      });
      assertBillingOwner(reply, expectedAccountId);
      if (!current(access) || controller.signal.aborted) return;
      const next = readBillingReceipt(reply.receipt);
      if (receipt) {
        if (next.id !== receipt.id || next.version !== receipt.version + 1) throw invalid();
        const adjustment = input as BillingAdjustmentInput;
        if (
          next.refundedMinor !== adjustment.refundedMinor ||
          next.taxMinor !== adjustment.taxMinor ||
          next.feeMinor !== adjustment.feeMinor ||
          next.serviceStartsOn !==
            (adjustment.serviceStartsOn === undefined
              ? receipt.serviceStartsOn
              : adjustment.serviceStartsOn) ||
          next.serviceEndsOn !==
            (adjustment.serviceEndsOn === undefined
              ? receipt.serviceEndsOn
              : adjustment.serviceEndsOn)
        )
          throw invalid();
      } else {
        const created = input as BillingReceiptInput;
        if (
          next.kind !== created.kind ||
          next.grossMinor !== created.grossMinor ||
          next.taxMinor !== created.taxMinor ||
          next.feeMinor !== created.feeMinor ||
          next.externalReference !== created.externalReference ||
          next.source !== created.source ||
          Date.parse(next.receivedAt) !== Date.parse(created.receivedAt) ||
          next.businessId !== created.businessId ||
          next.packageId !== created.packageId ||
          next.period !== created.period ||
          next.serviceStartsOn !== created.serviceStartsOn ||
          next.serviceEndsOn !== created.serviceEndsOn
        )
          throw invalid();
      }
      acceptReceipt(next);
      forgetPending();
      setNotice(receipt ? "Ispravka je evidentirana." : "Uplata je evidentirana.");
    } catch (failure) {
      if (!current(access) || controller.signal.aborted) return;
      if (!billingUncertain(failure)) forgetPending();
      if (billingDenied(failure)) {
        clearDenied();
        return;
      }
      if (pendingRef.current) {
        setPending(command);
        setForm(null);
        setBusinesses([]);
        await reconcile(command, controller, access);
      } else {
        setError(billingUiError(failure));
        if (receipt && failure instanceof BillingRequestError && failure.status === 409) {
          try {
            const reply = await request(`admin/receipts/${receipt.id}`, {
              signal: controller.signal,
            });
            assertBillingOwner(reply, expectedAccountId);
            if (!current(access) || controller.signal.aborted) return;
            const fresh = readBillingReceipt(reply.receipt);
            if (fresh.id !== receipt.id || fresh.version < receipt.version) throw invalid();
            acceptReceipt(fresh);
            setForm(fresh);
          } catch (readFailure) {
            if (current(access) && !controller.signal.aborted && billingDenied(readFailure))
              clearDenied();
          }
        }
      }
    } finally {
      if (writeController.current === controller) {
        writeController.current = null;
        writing.current = false;
        if (current(access) && !controller.signal.aborted) {
          setBusy(false);
          setRefresh((value) => value + 1);
        }
      }
    }
  }
  const locked = busy || pending !== null;
  const visibleRows = rowPage === page ? rows : null,
    visibleEntries = entryPage === developmentPage ? entries : null;
  const counts = [
    [
      "Primljeno · bruto",
      summary?.grossMinor === undefined ? "—" : billingMoney(summary.grossMinor),
      "",
    ],
    [
      "Izvršeni povrati",
      summary?.refundedMinor === undefined ? "—" : billingMoney(summary.refundedMinor),
      "",
    ],
    [
      "Poznata neto osnovica",
      summary?.knownNetBaseMinor === undefined ? "—" : billingMoney(summary.knownNetBaseMinor),
      summary?.unknownNetCount
        ? `${summary.unknownNetCount} uplata bez poznate osnovice · ${billingMoney(summary.unknownNetCashMinor)} preostalih primitaka nije obuhvaćeno`
        : "",
    ],
    [
      "Obračunato za razvoj",
      summary?.developmentPostedMinor === undefined
        ? "—"
        : billingMoney(summary.developmentPostedMinor),
      "Namjenski obračun · nije isplata",
    ],
    [
      "Obračun na čekanju",
      summary?.allocationPendingCount?.toString() ?? "—",
      "Nepoznati porezi ili naknade",
    ],
    [
      "Foto i video · bruto",
      summary?.photoVideoGrossMinor === undefined
        ? "—"
        : billingMoney(summary.photoVideoGrossMinor),
      "Odvojeno od razvoja pretplata",
    ],
  ];
  return (
    <section className={styles.workspace} aria-label="Naplata i razvoj">
      <header className={styles.heading}>
        {!embedded && <h1>Naplata i razvoj</h1>}
        <span className={styles.badge}>Ručna evidencija</span>
      </header>
      {authorized &&
        active &&
        expectedAccountId &&
        rawRequest === billingRequest &&
        !pendingOnly &&
        !IS_PLAY_EDITION && <PackageSetup accountId={expectedAccountId} />}
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
      {pending && !busy && (
        <div className={`${styles.notice} ${styles.recovery}`} role="status">
          <p>Ishod prethodne evidencije još nije potvrđen.</p>
          <button
            type="button"
            className={styles.primary}
            disabled={!active}
            onClick={() => void checkPending()}
          >
            Provjeri prethodnu radnju
          </button>
        </div>
      )}
      {!pendingOnly && (
        <dl className={styles.summary}>
          {counts.map(([label, value, note]) => (
            <div key={label} className={styles.metric}>
              <dt>{label}</dt>
              <dd>{value}</dd>
              {note && <small>{note}</small>}
            </div>
          ))}
        </dl>
      )}
      <div className={styles.toolbar}>
        {!pendingOnly && (
          <div className={styles.actions} style={{ marginTop: 0 }}>
            <button
              type="button"
              className={styles.secondary}
              aria-pressed={tab === "receipts"}
              disabled={locked || !!form || !authorized}
              onClick={() => {
                setTab("receipts");
                setError("");
              }}
            >
              Uplate
            </button>
            <button
              type="button"
              className={styles.secondary}
              aria-pressed={tab === "development"}
              disabled={locked || !!form || !authorized}
              onClick={() => {
                setTab("development");
                setError("");
              }}
            >
              Obračunska izdvajanja
            </button>
          </div>
        )}
        <div className={styles.actions} style={{ marginTop: 0 }}>
          <button
            type="button"
            className={styles.secondary}
            disabled={locked || !active}
            onClick={() => {
              setError("");
              setRefresh((value) => value + 1);
            }}
          >
            Osvježi evidenciju
          </button>
          {!pendingOnly && (
            <button
              type="button"
              className={styles.primary}
              disabled={locked || !!form || !authorized || !active}
              onClick={() => {
                setTab("receipts");
                setForm("new");
                setError("");
                setNotice("");
                void findBusiness("", 1);
              }}
            >
              Nova uplata
            </button>
          )}
        </div>
      </div>
      {form && (
        <ReceiptForm
          key={form === "new" ? "new" : `${form.id}:${form.version}`}
          receipt={form === "new" ? undefined : form}
          disabled={locked || !active}
          businesses={businesses}
          businessLoading={businessLoading}
          businessPage={businessPage}
          businessHasMore={businessMore}
          businessQuery={businessQuery}
          onFindBusiness={(query, page) => void findBusiness(query, page)}
          onCreate={(input) => void submit(input)}
          onAdjust={(input) => {
            if (form && form !== "new") void submit(input, form);
          }}
          onCancel={() => {
            if (!locked) {
              setForm(null);
              setBusinesses([]);
              setError("");
            }
          }}
        />
      )}
      {loading && !visibleRows && !visibleEntries && (
        <p role="status" className={styles.empty}>
          Dohvaćanje evidencije…
        </p>
      )}
      {tab === "receipts" ? (
        <>
          {visibleRows?.length === 0 && (
            <p className={styles.empty}>
              {pendingOnly ? "Nema obračuna na čekanju." : "Nema evidentiranih uplata."}
            </p>
          )}
          <div className={styles.list}>
            {visibleRows?.map((receipt) => (
              <article className={styles.receipt} key={receipt.id}>
                <header className={styles.receiptHeader}>
                  <div>
                    <h3>{receipt.externalReference}</h3>
                    <p>
                      {kindLabels[receipt.kind]}
                      {receipt.businessTitle ? ` · ${receipt.businessTitle}` : ""}
                      {receipt.packageId
                        ? ` · ${billingPackages.find((plan) => plan.id === receipt.packageId)?.name}`
                        : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={styles.secondary}
                    disabled={locked || !!form || !authorized || !active}
                    onClick={() => {
                      setForm(receipt);
                      setError("");
                      setNotice("");
                    }}
                  >
                    Ispravka evidencije
                  </button>
                </header>
                {receipt.processorCorrectionPending && (
                  <p role="status">PayPal još provjerava iznos korekcije.</p>
                )}
                <dl className={styles.details}>
                  {[
                    ["Primljeno", billingMoney(receipt.grossMinor)],
                    ["Ukupno vraćeno", billingMoney(receipt.refundedMinor)],
                    ["Porezni iznos", amount(receipt.taxMinor)],
                    ["Naknade", amount(receipt.feeMinor)],
                    ["Neto osnovica", amount(receipt.netBaseMinor)],
                    [
                      "Razvoj",
                      receipt.kind === "photo_video"
                        ? "Ne primjenjuje se"
                        : amount(receipt.developmentMinor),
                    ],
                    ["Način primitka", sources[receipt.source]],
                    ["Datum uplate", bosnianDateTime(receipt.receivedAt)],
                    ...(receipt.serviceStartsOn
                      ? [["Period usluge", `${receipt.serviceStartsOn} – ${receipt.serviceEndsOn}`]]
                      : []),
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                {receipt.allocationStatus === "pending" && (
                  <p className={styles.footnote}>Obračun čeka poznate poreze i naknade.</p>
                )}
              </article>
            ))}
          </div>
          {(page > 1 || hasMore) && (
            <nav className={styles.pagination} aria-label="Stranice uplata">
              <button
                type="button"
                className={styles.secondary}
                disabled={locked || loading || !!form || page === 1}
                onClick={() => setPage(page - 1)}
              >
                Prethodna
              </button>
              <span>{page}</span>
              <button
                type="button"
                className={styles.secondary}
                disabled={locked || loading || !!form || !hasMore}
                onClick={() => setPage(page + 1)}
              >
                Sljedeća
              </button>
            </nav>
          )}
        </>
      ) : (
        <>
          {visibleEntries?.length === 0 && (
            <p className={styles.empty}>Nema obračunskih izdvajanja.</p>
          )}
          <div className={styles.list}>
            {visibleEntries?.map((entry) => (
              <article className={styles.receipt} key={entry.id}>
                <header className={styles.receiptHeader}>
                  <div>
                    <h3>{entry.externalReference}</h3>
                    <p>Verzija uplate {entry.receiptVersion}</p>
                  </div>
                  <strong>{billingMoney(entry.deltaMinor)}</strong>
                </header>
                <p className={styles.footnote}>
                  {entry.reason} · {bosnianDateTime(entry.createdAt)}
                </p>
              </article>
            ))}
          </div>
          {(developmentPage > 1 || developmentMore) && (
            <nav className={styles.pagination} aria-label="Stranice izdvajanja">
              <button
                type="button"
                className={styles.secondary}
                disabled={locked || loading || developmentPage === 1}
                onClick={() => setDevelopmentPage(developmentPage - 1)}
              >
                Prethodna
              </button>
              <span>{developmentPage}</span>
              <button
                type="button"
                className={styles.secondary}
                disabled={locked || loading || !developmentMore}
                onClick={() => setDevelopmentPage(developmentPage + 1)}
              >
                Sljedeća
              </button>
            </nav>
          )}
        </>
      )}
      <p className={styles.footnote}>
        Razvoj: 20% poznate neto osnovice pretplate. Obračunska izdvajanja nisu raspoloživa dobit
        niti potvrđene isplate Foundationu. Ovdje se ne naplaćuje niti šalje novac.
      </p>
    </section>
  );
}
