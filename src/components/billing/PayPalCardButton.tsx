"use client";
import { useEffect, useRef, useState } from "react";
import { type CardOrder, createPayPalCardFlow } from "../../lib/paypal-card-flow";
import { loadPayPalCardSdk } from "../../lib/paypal-card-sdk";
import styles from "./checkout-preview.module.css";

type Props = {
  clientId: string;
  userId: string;
  input: () => { requestId: string; businessId: string };
  onOrder: (order: CardOrder) => void;
  acquire: () => boolean;
  release: () => void;
};
const failure =
  "Kartično plaćanje trenutno nije dostupno. Možeš koristiti PayPal opciju. Ako si već pokušao platiti, prvo osvježi status sačuvane narudžbe.";
const errors: Record<string, string> = {
  CHECKOUT_FLOW_MISMATCH:
    "Već postoji otvorena narudžba za drugi način plaćanja. Nastavi prethodni PayPal pokušaj pomoću opcije Nastavi na PayPal. Ne otvaraj novu narudžbu.",
  ACCOUNT_IDENTITY_CHANGED: "Nalog je promijenjen. Ponovo učitaj stranicu prije nastavka.",
  AUTHENTICATION_REQUIRED: "Ponovo se prijavi prije nastavka plaćanja.",
  ORDER_BUSY_OR_EXPIRED: "Narudžba se obrađuje ili je istekla. Prvo osvježi njen status.",
};
export function PayPalCardButton(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState("Učitavam PayPal opciju za kartice…");
  const [retry, setRetry] = useState(false);
  const { clientId, userId } = props;
  // biome-ignore lint/correctness/useExhaustiveDependencies: Explicit retry reloads the SDK button, not payment requests.
  useEffect(() => {
    const controller = new AbortController();
    let close: (() => void | Promise<void>) | undefined;
    setStatus("Učitavam PayPal opciju za kartice…");
    setRetry(false);
    const current = () => !controller.signal.aborted && latest.current.userId === userId;
    const flow = createPayPalCardFlow({
      input: () => latest.current.input(),
      acquire: () => current() && latest.current.acquire(),
      release: () => {
        if (current()) latest.current.release();
      },
      onOrder: (order) => {
        if (current()) latest.current.onOrder(order);
      },
      send: async (path, body, signal) => {
        if (!current()) throw new Error("Nalog je promijenjen. Ponovo učitaj stranicu.");
        const response = await fetch(`/api/checkout/${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-AhiBizz-Account-ID": userId },
          body: JSON.stringify(body),
          cache: "no-store",
          signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(errors[result.code] ?? failure);
        return result;
      },
    });
    const report = (error: unknown) => {
      if (!current()) return;
      flow.cancel();
      setStatus(error instanceof Error ? error.message : failure);
      setRetry(true);
    };
    loadPayPalCardSdk(clientId, controller.signal)
      .then(async (sdk) => {
        if (!current() || !host.current) return;
        const buttons = sdk.Buttons({
          fundingSource: sdk.FUNDING.CARD,
          onClick: (_data, actions) => (flow.click() ? actions.resolve() : actions.reject()),
          createOrder: () =>
            flow.create().catch((error) => {
              report(error);
              throw error;
            }),
          onApprove: async (data) => {
            try {
              await flow.approve(data.orderID);
              if (current()) setStatus("Server je potvrdio uplatu.");
            } catch (error) {
              report(error);
            }
          },
          onCancel: () => {
            flow.cancel();
            if (current())
              setStatus(
                "Odustao si od kartičnog pokušaja. Odustajanje nije dokaz naplate; provjeri status sačuvane narudžbe prije novog pokušaja.",
              );
          },
          onError: report,
        });
        close = () => buttons.close();
        if (!buttons.isEligible()) {
          setStatus(
            "PayPal za ovaj uređaj ili kupca ne nudi kartično dugme. Koristi PayPal opciju iznad.",
          );
          return;
        }
        await buttons.render(host.current);
        if (current())
          setStatus(
            "Karticu obrađuje PayPal. Dostupnost plaćanja bez PayPal naloga zavisi od kupca i PayPala.",
          );
      })
      .catch(() => {
        if (current()) {
          setStatus(failure);
          setRetry(true);
        }
      });
    return () => {
      // Dispose releases the parent lock before invalidating this identity's callbacks.
      flow.dispose();
      controller.abort();
      if (close) void Promise.resolve(close()).catch(() => {});
    };
  }, [clientId, userId, attempt]);
  return (
    <section className={styles.card} aria-label="Kartica putem PayPala">
      <h2>Plati karticom putem PayPala</h2>
      <p>
        Jednokratno 5,11 EUR za 7 dana isticanja. Podatke kartice unosiš samo u PayPalov obrazac, ne
        na AhiBizz.
      </p>
      <div ref={host} />
      <p role="status">{status}</p>
      {retry && (
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          Ponovo učitaj kartično dugme
        </button>
      )}
    </section>
  );
}
