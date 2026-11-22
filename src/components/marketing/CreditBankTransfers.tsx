"use client";

import { useEffect, useRef, useState } from "react";
import type {
  BankTopUpCreate,
  BankTopUpData,
  BankTopUpRequest,
  BankTopUpStatus,
  CreditBankCurrency,
} from "../../lib/bank-credit-topup";
import { CopyPaymentDetails } from "../support/CopyPaymentDetails";
import styles from "./marketing.module.css";

const statusLabels: Record<BankTopUpStatus, string> = {
  pending: "Čeka bankovnu uplatu",
  approved: "Uplata potvrđena",
  cancelled: "Zahtjev otkazan",
};
const bankErrors: Record<string, string> = {
  BANK_TOPUP_UNAVAILABLE: "Bankovna dopuna trenutno nije dostupna.",
  BANK_TOPUP_CHANGED: "Zahtjev je izmijenjen. Provjeri njegov aktuelni status.",
  BANK_TOPUP_PENDING: "Već imaš otvoren zahtjev za dopunu.",
  BANK_REFERENCE_USED: "Ova transakcija s bankovnog izvoda već je evidentirana.",
  AMOUNT_MISMATCH: "Iznos, valuta i referenca uplate moraju odgovarati zahtjevu.",
  INVALID_BANK_TOPUP: "Osvježi zahtjev i pokušaj ponovo.",
  INVALID_CREDIT_BUNDLE: "Odaberi jednu od ponuđenih dopuna.",
  BANK_TOPUP_NOT_FOUND: "Zahtjev za dopunu više nije dostupan.",
  ACCOUNT_CHANGED: "Provjeri status naloga prije evidentiranja uplate.",
  QUOTE_PAYMENT_PENDING: "Za ovu dopunu već postoji otvorena PayPal uplata.",
  ACCOUNT_IDENTITY_CHANGED: "Prijavi se ponovo i osvježi ovu stranicu.",
};
const endpoint = "/api/wallet/bank-topups";
const number = new Intl.NumberFormat("bs-BA");

export function marketingAmount(value: FormDataEntryValue | null) {
  const raw = String(value ?? "")
    .trim()
    .replace(",", ".");
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(raw)) return 0;
  const [units, fraction = ""] = raw.split(".");
  return Number(units) * 100 + Number(fraction.padEnd(2, "0"));
}

export function creditBankAmount(amount: number, currency: CreditBankCurrency) {
  if (!Number.isSafeInteger(amount) || amount < 0) return "—";
  const whole = String(Math.floor(amount / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const fraction = String(amount % 100).padStart(2, "0");
  return `${whole},${fraction} ${currency === "BAM" ? "KM" : "EUR"}`;
}

export function useBankTopUps(
  accountId: string,
  scope: "mine" | "admin" | null,
  onChange: () => void,
) {
  const [data, setData] = useState<BankTopUpData | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<BankTopUpStatus>("pending");
  const [refresh, setRefresh] = useState(0);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const writing = useRef(false);
  const readEpoch = useRef(0);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh repeats this read.
  useEffect(() => {
    if (!scope) return;
    const controller = new AbortController();
    const epoch = ++readEpoch.current;
    const search = new URLSearchParams({ scope, page: String(page) });
    if (scope === "admin") search.set("status", status);
    setFailed(false);
    void fetch(`${endpoint}?${search}`, {
      headers: { "X-AhiBizz-Account-ID": accountId },
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw Error("bank_topup_read");
        const value: BankTopUpData = await response.json();
        if (!Array.isArray(value.requests)) throw Error("bank_topup_read");
        if (!controller.signal.aborted && epoch === readEpoch.current) setData(value);
      })
      .catch(() => {
        if (!controller.signal.aborted && epoch === readEpoch.current) {
          setData(null);
          setFailed(true);
        }
      });
    return () => controller.abort();
  }, [accountId, page, refresh, scope, status]);

  function reread() {
    setRefresh((value) => value + 1);
    if (scope === "mine") onChange();
  }
  async function write(path: string, body: object, success: string) {
    if (!scope || writing.current) return null;
    writing.current = true;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${endpoint}${path}`, {
        method: "POST",
        headers: { "X-AhiBizz-Account-ID": accountId, "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        body: JSON.stringify(body),
      });
      const value = await response.json();
      if (!response.ok) throw Error(value.code);
      const request = value.request as BankTopUpRequest | undefined;
      if (!request?.id || !Object.hasOwn(statusLabels, request.status))
        throw Error("invalid_bank_topup_response");
      if (active.current) {
        readEpoch.current++;
        setData((previous) => {
          if (!previous || (scope === "admin" && status !== request.status)) {
            return previous
              ? { ...previous, requests: previous.requests.filter((row) => row.id !== request.id) }
              : previous;
          }
          return {
            ...previous,
            requests: [request, ...previous.requests.filter((row) => row.id !== request.id)],
          };
        });
        setMessage(success);
        setPage(1);
        if (scope === "admin") onChange();
      }
      return request;
    } catch (error) {
      if (active.current)
        setMessage(
          (error instanceof Error ? bankErrors[error.message] : null) ??
            "Ishod nije potvrđen. Provjeri status dopune.",
        );
      return null;
    } finally {
      writing.current = false;
      if (active.current) {
        setBusy(false);
        reread();
      }
    }
  }
  return {
    data,
    page,
    status,
    failed,
    busy,
    message,
    setPage,
    selectStatus(next: BankTopUpStatus) {
      setPage(1);
      setStatus(next);
      setData(null);
      setMessage("");
    },
    reread,
    start(input: BankTopUpCreate) {
      return write("", input, "Podaci za uplatu su spremni.");
    },
    approve(request: BankTopUpRequest) {
      return write(
        `/${encodeURIComponent(request.id)}/approve`,
        {
          amountMinor: request.amountMinor,
          paymentReference: request.paymentReference,
          currency: request.currency,
          expectedVersion: request.version,
          statementMatched: true,
        },
        "Uplata je potvrđena i krediti su dodani na račun.",
      );
    },
    cancel(request: BankTopUpRequest) {
      return write(
        `/${encodeURIComponent(request.id)}/cancel`,
        { expectedVersion: request.version },
        "Zahtjev za bankovnu dopunu je otkazan.",
      );
    },
  };
}

type BankWorkspace = ReturnType<typeof useBankTopUps>;

export function CreditBankTransfer({
  request,
  workspace,
}: {
  request: BankTopUpRequest;
  workspace: BankWorkspace;
}) {
  const bank = request.instructionsAvailable ? request.bank : null;
  const amount = creditBankAmount(request.amountMinor, request.currency);
  const purpose = bank && `${bank.purpose} ${request.paymentReference}`;
  const details = [
    ["Iznos", amount],
    ["Referenca uplate", request.paymentReference],
    ...(bank && purpose
      ? [
          ["Primalac", bank.recipient],
          ["Banka", bank.name],
          ...(bank.accountNumber ? [["Broj računa", bank.accountNumber]] : []),
          ...(bank.iban ? [["IBAN", bank.iban]] : []),
          ...(bank.bic ? [["SWIFT/BIC", bank.bic]] : []),
          ...(bank.address ? [["Adresa banke", bank.address]] : []),
          ["Svrha uplate", purpose],
        ]
      : []),
  ];
  const copy = details.map(([label, value]) => `${label}: ${value}`).join("\n");
  return (
    <section className={styles.instructions} aria-label="Podaci za bankovnu dopunu">
      <h3>
        {number.format(request.quantity)} kredita · {statusLabels[request.status]}
      </h3>
      <dl className={styles.bankDetails}>
        {details.map(([label, value]) => (
          <div className={styles.bankDetail} key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {bank ? (
        <>
          <p>Krediti se dodaju nakon što administracija provjeri uplatu na bankovnom izvodu.</p>
          <CopyPaymentDetails key={copy} text={copy} />
        </>
      ) : (
        <p>Upute su trenutno nedostupne. Za već poslanu uplatu sačuvaj bankovnu potvrdu.</p>
      )}
      <button type="button" className={styles.secondary} onClick={workspace.reread}>
        Provjeri status
      </button>
      <details>
        <summary>Otkaži zahtjev</summary>
        <p>Već poslana uplata ostaje kod banke. Sačuvaj potvrdu i javi se podršci.</p>
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void workspace.cancel(request);
          }}
        >
          <label className={styles.statementCheck}>
            <input type="checkbox" required />
            Otkazujem zahtjev prije slanja uplate.
          </label>
          <button type="submit" className={styles.secondary} disabled={workspace.busy}>
            Potvrdi otkazivanje
          </button>
        </form>
      </details>
    </section>
  );
}

export function BankTopUpAdmin({ workspace }: { workspace: BankWorkspace }) {
  return (
    <section className={styles.order} aria-label="Bankovne dopune kredita">
      <h2>Bankovne dopune kredita</h2>
      <fieldset className={styles.paymentMethods} aria-label="Status bankovnih dopuna">
        {(["pending", "approved", "cancelled"] as const).map((status) => (
          <button
            type="button"
            className={`${styles.secondary} ${styles.bankFilter}`}
            aria-pressed={workspace.status === status}
            key={status}
            disabled={workspace.busy}
            onClick={() => {
              if (workspace.status !== status) workspace.selectStatus(status);
            }}
          >
            {status === "pending" ? "Na čekanju" : status === "approved" ? "Potvrđene" : "Otkazane"}
          </button>
        ))}
      </fieldset>
      {workspace.message && <p role="status">{workspace.message}</p>}
      {workspace.failed && (
        <button type="button" className={styles.secondary} onClick={workspace.reread}>
          Ponovo učitaj bankovne dopune
        </button>
      )}
      {workspace.data &&
        (workspace.data.requests.length ? (
          <ul className={styles.bankList}>
            {workspace.data.requests.map((request) => (
              <li className={styles.bankOrder} key={request.id}>
                <strong>
                  {number.format(request.quantity)} kredita ·{" "}
                  {creditBankAmount(request.amountMinor, request.currency)}
                </strong>
                {(request.customer || request.email) && (
                  <small>{[request.customer, request.email].filter(Boolean).join(" · ")}</small>
                )}
                <p>Referenca uplate: {request.paymentReference}</p>
                {request.instructionsAvailable &&
                  (request.bank.iban || request.bank.accountNumber) && (
                    <p>
                      {request.bank.name} · račun završava na{" "}
                      {(request.bank.iban || request.bank.accountNumber)?.slice(-4)}
                    </p>
                  )}
                {request.status !== "approved" && (
                  <>
                    <p>Odobri kad se iznos, valuta i referenca poklope s bankovnim izvodom.</p>
                    <button
                      disabled={workspace.busy}
                      type="button"
                      onClick={() => void workspace.approve(request)}
                    >
                      {request.status === "cancelled" ? "Odobri naknadnu uplatu" : "Odobri uplatu"}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p>Nema bankovnih dopuna u ovom prikazu.</p>
        ))}
      {workspace.data && (workspace.page > 1 || workspace.data.hasMore) && (
        <nav aria-label="Stranice bankovnih dopuna" className={styles.bankPager}>
          {workspace.page > 1 && (
            <button
              type="button"
              className={styles.secondary}
              onClick={() => workspace.setPage(workspace.page - 1)}
            >
              Prethodna
            </button>
          )}
          {workspace.data.hasMore && (
            <button
              type="button"
              className={styles.secondary}
              onClick={() => workspace.setPage(workspace.page + 1)}
            >
              Sljedeća
            </button>
          )}
        </nav>
      )}
    </section>
  );
}
