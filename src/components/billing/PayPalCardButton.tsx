"use client";

import { useEffect, useRef, useState } from "react";
import { type CardOrder, createPayPalCardFlow } from "../../lib/paypal-card-flow";
import {
  type GuestSession,
  loadPayPalCardSdk,
  type PayPalEnvironment,
} from "../../lib/paypal-card-sdk";
import styles from "./checkout-preview.module.css";

type Props = {
  clientId: string;
  environment: PayPalEnvironment;
  userId: string;
  savedOrder?: CardOrder;
  input: () => { requestId: string; businessId: string };
  onOrder: (order: CardOrder) => void;
  acquire: () => boolean;
  release: () => void;
};

const failure = "Kartični obrazac se nije učitao. Pokušaj ponovo.";
const errors: Record<string, string> = {
  CHECKOUT_FLOW_MISMATCH:
    "Postoji otvorena narudžba s drugim načinom plaćanja. Provjeri njen status.",
  ACCOUNT_IDENTITY_CHANGED: "Nalog je promijenjen. Ponovo učitaj stranicu.",
  AUTHENTICATION_REQUIRED: "Prijavi se za nastavak plaćanja.",
  ORDER_BUSY_OR_EXPIRED: "Narudžba se obrađuje ili je istekla. Osvježi njen status.",
};

export function PayPalCardButton(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState("");
  const [retry, setRetry] = useState(false);
  const { clientId, environment, userId } = props;

  // biome-ignore lint/correctness/useExhaustiveDependencies: Explicit retry recreates the hosted session without creating an order.
  useEffect(() => {
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && latest.current.userId === userId;
    let interaction = 0;
    let session: GuestSession | undefined;
    let container: HTMLElement | undefined;
    const flow = createPayPalCardFlow({
      input: () => latest.current.input(),
      savedOrder: () => latest.current.savedOrder,
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
        if (!response.ok)
          throw new Error(errors[result.code] ?? "Provjeri status narudžbe pa pokušaj ponovo.");
        return result;
      },
    });
    const showError = (message: string) => {
      if (!current()) return;
      interaction++;
      flow.cancel();
      setStatus(message);
      setRetry(true);
    };
    function destroySession(value: GuestSession | undefined) {
      if (value)
        void Promise.resolve()
          .then(() => value.destroy())
          .catch(() => {});
    }

    setStatus("Učitavanje kartičnog obrasca…");
    setRetry(false);
    async function mount() {
      const sdk = await loadPayPalCardSdk(clientId, controller.signal, environment);
      if (!current()) return;
      const instance = await sdk.createInstance({
        clientId,
        components: ["paypal-guest-payments"],
        pageType: "checkout",
      });
      if (!current()) return;
      const methods = await instance.findEligibleMethods({ currencyCode: "EUR" });
      if (!current()) return;
      if (!methods.isEligible("card")) {
        setStatus("PayPal trenutno ne nudi unos kartice na ovom uređaju.");
        return;
      }
      const created = await instance.createPayPalGuestOneTimePaymentSession({
        onApprove: async ({ orderId }) => {
          if (!current()) throw new Error("Kartični pokušaj je zatvoren.");
          const pending = interaction;
          try {
            await flow.approve(orderId);
            if (current()) setStatus("Uplata je potvrđena.");
          } catch (error) {
            if (pending === interaction)
              showError(error instanceof Error ? error.message : "Provjeri status uplate.");
            throw error;
          }
        },
        // The capture response in onApprove is the authority on fulfillment.
        onComplete: () => {},
        onCancel: () => {
          if (!current()) return;
          interaction++;
          flow.cancel();
          setStatus("Unos kartice je zatvoren.");
        },
        onError: () => showError("Kartični pokušaj nije završen. Provjeri status narudžbe."),
      });
      if (!current() || !host.current) {
        destroySession(created);
        return;
      }
      session = created;
      container = document.createElement("paypal-basic-card-container");
      const button = document.createElement("paypal-basic-card-button");
      button.addEventListener(
        "click",
        () => {
          if (!current() || !flow.click()) return;
          const pending = ++interaction;
          setStatus("");
          setRetry(false);
          const order = flow.create().then((orderId) => ({ orderId }));
          void order.catch((error: unknown) => {
            if (pending === interaction)
              showError(error instanceof Error ? error.message : failure);
          });
          void Promise.resolve()
            .then(() => created.start({ presentationMode: "auto", targetElement: button }, order))
            .catch(() => {
              if (pending === interaction)
                showError("Kartični obrazac se nije otvorio. Provjeri status narudžbe.");
            });
        },
        { signal: controller.signal },
      );
      container.append(button);
      host.current.append(container);
      setStatus("");
    }
    void mount().catch(() => showError(failure));
    return () => {
      flow.dispose();
      controller.abort();
      destroySession(session);
      container?.remove();
    };
  }, [clientId, environment, userId, attempt]);

  return (
    <section className={styles.paymentFrame} aria-label="Kartica putem PayPala">
      <div ref={host} className={styles.guestHost} />
      <p className={styles.providerNote} role="status">
        {status}
      </p>
      {retry && (
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          Ponovo učitaj obrazac
        </button>
      )}
    </section>
  );
}
