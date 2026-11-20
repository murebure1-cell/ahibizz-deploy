"use client";

import { useEffect, useRef, useState } from "react";
import {
  loadSubscriptionCardSdk,
  type PayPalEnvironment,
  type SubscriptionButtons,
} from "../../lib/paypal-card-sdk";
import styles from "./billing.module.css";

type Props = {
  clientId: string;
  environment: PayPalEnvironment;
  accepted: boolean;
  create(): Promise<{ localId: string; subscriptionId: string }>;
  approved(id: string): void;
  finished(message: string): void;
};

export function SubscriptionCardButton(props: Props) {
  const latest = useRef(props);
  latest.current = props;
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable" | "error">("loading");
  const [attempt, retry] = useState(0);
  const { clientId, environment } = props;
  // biome-ignore lint/correctness/useExhaustiveDependencies: Manual retry remounts the provider button without creating a contract.
  useEffect(() => {
    const controller = new AbortController();
    let buttons: SubscriptionButtons | undefined;
    let contract: { localId: string; subscriptionId: string } | null = null;
    let generation = 0;
    let clicked = false;
    const element = document.createElement("div");
    const end = (message: string) => {
      if (controller.signal.aborted) return;
      generation++;
      contract = null;
      clicked = false;
      latest.current.finished(message);
    };
    setStatus("loading");
    async function mount() {
      const sdk = await loadSubscriptionCardSdk(clientId, controller.signal, environment);
      if (controller.signal.aborted || !host.current) return;
      buttons = sdk.Buttons({
        fundingSource: "card",
        style: { layout: "vertical", shape: "rect", height: 45 },
        onClick: (_data, actions) => {
          if (controller.signal.aborted || clicked || !latest.current.accepted)
            return actions.reject();
          clicked = true;
          return actions.resolve();
        },
        createSubscription: async () => {
          if (!clicked || controller.signal.aborted || !latest.current.accepted)
            throw new Error("Prihvati uslove paketa.");
          const started = generation;
          const result = await latest.current.create();
          if (controller.signal.aborted || started !== generation)
            throw new Error("Plaćanje je zatvoreno.");
          contract = result;
          return result.subscriptionId;
        },
        onApprove: async (data) => {
          if (controller.signal.aborted) return;
          if (!contract || data.subscriptionID !== contract.subscriptionId) {
            end("Provjeri status pretplate u svom nalogu.");
            return;
          }
          latest.current.approved(contract.localId);
        },
        onCancel: () => end("Plaćanje karticom je zatvoreno. Provjeri status pretplate."),
        onError: () => end("Kartično plaćanje nije završeno. Provjeri status pretplate."),
      });
      if (!buttons.isEligible()) {
        setStatus("unavailable");
        return;
      }
      host.current.append(element);
      await buttons.render(element);
      if (!controller.signal.aborted) setStatus("ready");
    }
    void mount().catch(() => {
      if (!controller.signal.aborted) setStatus("error");
    });
    return () => {
      controller.abort();
      element.remove();
      if (buttons)
        void Promise.resolve()
          .then(() => buttons?.close())
          .catch(() => {});
    };
  }, [clientId, environment, attempt]);
  return (
    <div className={styles.subscriptionCard}>
      {status === "loading" && <p role="status">Provjera dostupnosti kartice…</p>}
      {status === "unavailable" && (
        <p role="status">Kartica za ovaj paket trenutno nije dostupna. Možeš odabrati PayPal.</p>
      )}
      {status === "error" && (
        <>
          <p role="status">Kartični obrazac se nije učitao.</p>
          <button type="button" onClick={() => retry((a) => a + 1)}>
            Pokušaj ponovo
          </button>
        </>
      )}
      {status === "ready" && !props.accepted && <p>Prihvati uslove paketa za nastavak.</p>}
      <div ref={host} hidden={!props.accepted} />
    </div>
  );
}
