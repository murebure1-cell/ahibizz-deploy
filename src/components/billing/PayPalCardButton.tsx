"use client";

import { useEffect, useRef, useState } from "react";
import {
  type CardOrder,
  type CardPurchaseInput,
  createPayPalCardFlow,
} from "../../lib/paypal-card-flow";
import {
  type AdvancedSession,
  type CardSdkInstance,
  type GuestSession,
  loadPayPalCardSdk,
  type PayPalEnvironment,
} from "../../lib/paypal-card-sdk";
import { AdvancedCardForm } from "./AdvancedCardForm";
import styles from "./checkout-preview.module.css";

type Props = {
  clientId: string;
  environment: PayPalEnvironment;
  amountMinor: number;
  userId: string;
  savedOrder?: CardOrder;
  input: () => CardPurchaseInput;
  onOrder: (order: CardOrder) => void;
  acquire: () => boolean;
  release: () => void;
  onOrderRecoveryNeeded?: () => void;
};

const failure = "Kartični obrazac se nije učitao. Pokušaj ponovo.";
const errors: Record<string, string> = {
  CHECKOUT_FLOW_MISMATCH:
    "Postoji otvorena narudžba s drugim načinom plaćanja. Provjeri njen status prije nove uplate.",
  PAYPAL_PENDING:
    "PayPal još nije potvrdio ishod. Provjeri sačuvanu narudžbu prije drugog načina plaćanja.",
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
  const [advanced, setAdvanced] = useState<{
    newSession: () => AdvancedSession;
    submit: (session: AdvancedSession) => Promise<void>;
    onUnavailable: () => void;
  } | null>(null);
  const selectedMode = useRef<"advanced" | "guest" | null>(null);
  const savedFlow = props.savedOrder?.flow;
  useEffect(() => {
    if (
      savedFlow &&
      selectedMode.current &&
      (savedFlow === "card-fields") !== (selectedMode.current === "advanced")
    ) {
      selectedMode.current = null;
      setAttempt((value) => value + 1);
    }
  }, [savedFlow]);
  const { clientId, environment, userId } = props;

  // biome-ignore lint/correctness/useExhaustiveDependencies: Explicit retry recreates the hosted session without creating an order.
  useEffect(() => {
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && latest.current.userId === userId;
    let interaction = 0;
    let guestState: "idle" | "open" | "approving" | "confirmed" | "unconfirmed" = "idle";
    let guestApproval: { orderId: string; promise: Promise<void> } | null = null;
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
        if (!response.ok) {
          const recoveryNeeded =
            current() &&
            latest.current.onOrderRecoveryNeeded &&
            ["CHECKOUT_FLOW_MISMATCH", "PAYPAL_PENDING"].includes(result.code);
          if (recoveryNeeded) latest.current.onOrderRecoveryNeeded?.();
          throw new Error(
            recoveryNeeded && result.code === "CHECKOUT_FLOW_MISMATCH"
              ? "Postoji narudžba za drugi način plaćanja. Odaberi „Pronađi otvorenu narudžbu“ ispod obrasca; ne pokreći novu uplatu."
              : (errors[result.code] ?? "Provjeri status narudžbe pa pokušaj ponovo."),
          );
        }
        return result;
      },
    });
    const showError = (message: string) => {
      if (!current()) return;
      interaction++;
      flow.cancel();
      guestState = "unconfirmed";
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
    setAdvanced(null);
    selectedMode.current = null;
    async function mount() {
      const sdk = await loadPayPalCardSdk(clientId, controller.signal, environment);
      if (!current()) return;
      const saved = latest.current.savedOrder;
      const originalGuest = saved?.flow === "guest" || saved?.flow === "sdk";
      let instance: CardSdkInstance;
      try {
        instance = await sdk.createInstance({
          clientId,
          components: originalGuest
            ? ["paypal-guest-payments"]
            : ["card-fields", "paypal-guest-payments"],
          pageType: "checkout",
        });
      } catch (error) {
        if (originalGuest || saved?.flow === "card-fields") throw error;
        instance = await sdk.createInstance({
          clientId,
          components: ["paypal-guest-payments"],
          pageType: "checkout",
        });
      }
      if (!current()) return;
      const amount = latest.current.savedOrder?.amountMinor ?? latest.current.amountMinor;
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(failure);
      const methods = await instance.findEligibleMethods({
        currencyCode: "EUR",
        amount: (amount / 100).toFixed(2),
      });
      if (!current()) return;
      const guestAvailable = methods.isEligible("card") && saved?.flow !== "card-fields";
      if (
        !originalGuest &&
        methods.isEligible("advanced_cards") &&
        instance.createCardFieldsOneTimePaymentSession
      ) {
        selectedMode.current = "advanced";
        const factory = instance.createCardFieldsOneTimePaymentSession.bind(instance);
        setStatus("");
        setAdvanced({
          newSession: factory,
          onUnavailable: () => {
            if (!current()) return;
            setAdvanced(null);
            if (guestAvailable && !latest.current.savedOrder) {
              void mountGuest(instance).catch(() => showError(failure));
            } else showError(failure);
          },
          submit: async (fields) => {
            if (!current() || !flow.click()) return;
            const pending = ++interaction;
            setStatus("");
            setRetry(false);
            try {
              const orderId = await flow.create("card-fields");
              if (!current() || pending !== interaction) return;
              const result = await fields.submit(orderId).catch(() => {
                throw new Error("Kartica nije potvrđena. Provjeri status narudžbe.");
              });
              if (!current() || pending !== interaction) return;
              if (result.state === "canceled" || result.state === "failed") {
                flow.cancel();
                setStatus(
                  result.state === "canceled"
                    ? "Potvrda kartice je prekinuta. Narudžba time nije otkazana; provjeri njen status prije drugog načina plaćanja."
                    : "Kartica nije potvrđena. Provjeri status sačuvane narudžbe prije novog pokušaja.",
                );
                return;
              }
              if (result.state !== "succeeded" || result.data?.orderId !== orderId)
                throw new Error("Odobrenje ne odgovara narudžbi. Provjeri status uplate.");
              await flow.approve(orderId);
              if (current()) setStatus("Uplata je potvrđena.");
            } catch (error) {
              if (current() && pending === interaction) {
                flow.cancel();
                setStatus(
                  error instanceof Error
                    ? error.message
                    : "Uplata nije potvrđena. Provjeri status narudžbe.",
                );
              }
            }
          },
        });
        return;
      }
      if (!guestAvailable) {
        setStatus(
          saved?.flow === "card-fields"
            ? "Ovaj kartični obrazac trenutno nije dostupan. Provjeri status sačuvane narudžbe."
            : "PayPal trenutno ne nudi unos kartice na ovom uređaju.",
        );
        return;
      }
      await mountGuest(instance);
    }
    async function mountGuest(instance: CardSdkInstance) {
      selectedMode.current = "guest";
      const pendingMessage =
        "Čekam potvrdu naplate. Ne pokreći novu uplatu; provjeri status sačuvane narudžbe.";
      function endedWithoutConfirmation() {
        if (!current()) return;
        if (guestState === "approving") {
          setStatus(pendingMessage);
        } else if (guestState === "open") {
          interaction++;
          flow.cancel();
          guestState = "unconfirmed";
          setStatus(
            "Kartični prozor je završen bez potvrde naplate. Osvježi status sačuvane narudžbe prije novog pokušaja.",
          );
          setRetry(false);
        }
      }
      const created = await instance.createPayPalGuestOneTimePaymentSession({
        onApprove: ({ orderId }) => {
          if (!current()) return Promise.reject(new Error("Kartični pokušaj je zatvoren."));
          if (guestApproval) {
            if (guestApproval.orderId === orderId) return guestApproval.promise;
            return Promise.reject(new Error("Odobrenje ne odgovara ovoj narudžbi."));
          }
          const pending = interaction;
          guestState = "approving";
          setStatus(pendingMessage);
          const promise = flow.approve(orderId).then(
            () => {
              if (current() && pending === interaction) {
                guestState = "confirmed";
                setStatus("Uplata je potvrđena.");
              }
            },
            (error: unknown) => {
              if (pending === interaction)
                showError(error instanceof Error ? error.message : "Provjeri status uplate.");
              throw error;
            },
          );
          guestApproval = { orderId, promise };
          return promise;
        },
        // The capture response in onApprove is the authority on fulfillment.
        onComplete: endedWithoutConfirmation,
        onCancel: () => {
          if (!current()) return;
          if (guestState === "confirmed") return;
          if (guestState === "approving") {
            setStatus(pendingMessage);
            return;
          }
          interaction++;
          flow.cancel();
          guestState = "unconfirmed";
          if (!latest.current.savedOrder) latest.current.onOrderRecoveryNeeded?.();
          setStatus(
            latest.current.savedOrder
              ? "Unos kartice je zatvoren. Time narudžba nije otkazana; osvježi njen status prije drugog načina plaćanja."
              : latest.current.onOrderRecoveryNeeded
                ? "Unos kartice je zatvoren. Odaberi Pronađi otvorenu narudžbu prije drugog načina plaćanja."
                : "Unos kartice je zatvoren. Provjeri status uplate prije novog pokušaja.",
          );
        },
        onError: () => {
          if (!current()) return;
          if (guestState === "confirmed") return;
          if (guestState === "approving") setStatus(pendingMessage);
          else showError("Kartični pokušaj nije završen. Provjeri status narudžbe.");
        },
        onWarn: () => {
          if (current() && guestState === "open")
            setStatus(
              "PayPal traži provjeru unosa u otvorenom kartičnom obrascu. Ispravi podatke tamo i pokušaj ponovo. Uplata još nije potvrđena.",
            );
        },
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
          guestState = "open";
          guestApproval = null;
          setStatus("Čekam odgovor iz kartičnog obrasca…");
          setRetry(false);
          const order = flow.create().then((orderId) => ({ orderId }));
          void order.catch((error: unknown) => {
            if (pending === interaction)
              showError(error instanceof Error ? error.message : failure);
          });
          void Promise.resolve()
            .then(() => created.start({ presentationMode: "auto", targetElement: button }, order))
            .then(() => {
              if (pending === interaction) endedWithoutConfirmation();
            })
            .catch(() => {
              if (pending !== interaction || !current() || guestState === "confirmed") return;
              if (guestState === "approving") setStatus(pendingMessage);
              else showError("Kartični obrazac se nije otvorio. Provjeri status narudžbe.");
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
      {advanced && <AdvancedCardForm amountMinor={props.amountMinor} {...advanced} />}
      <div ref={host} className={styles.guestHost} />
      {status && (
        <p className={styles.providerNote} role="status">
          {status}
        </p>
      )}
      {retry && (
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          Ponovo učitaj obrazac
        </button>
      )}
    </section>
  );
}
