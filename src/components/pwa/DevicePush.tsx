"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../Icon";
import styles from "./permissions.module.css";

type Device = {
  accountId: string;
  publicKey: string;
  reg: ServiceWorkerRegistration;
  sub: PushSubscription | null;
  enabled: boolean;
  test: string | null;
};
const settings = "/nalog?odjeljak=postavke";
const tests: Record<string, string> = {
  scheduled: "Zatvori aplikaciju. Probna obavijest je zakazana za 30 sekundi.",
  accepted: "Servis je preuzeo obavijest. Čekamo potvrdu uređaja.",
  unconfirmed: "Servis je preuzeo obavijest. Uređaj još nije potvrdio prikaz.",
  shown: "Uređaj je prikazao probnu obavijest.",
  opened: "Probna obavijest je otvorena.",
  failed: "Slanje probne obavijesti nije uspjelo.",
};
async function api(action: string, actor?: string, sub?: PushSubscription) {
  const headers = new Headers();
  if (actor) headers.set("X-AhiBizz-Account-ID", actor);
  if (sub) headers.set("Content-Type", "application/json");
  const response = await fetch(`/api/push/${action}`, {
    method: sub ? "POST" : "GET",
    headers,
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
    ...(sub && { body: JSON.stringify({ subscription: sub.toJSON() }) }),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(String(value.code || "PUSH_UNAVAILABLE"));
  return value;
}

export function DevicePush({
  actor,
  onEnabled,
}: {
  actor?: string;
  onEnabled?: (enabled: boolean) => void;
}) {
  const [device, setDevice] = useState<Device | null>(null),
    [status, setStatus] = useState("loading"),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0);
  const lock = useRef(false),
    epoch = useRef(0),
    revision = useRef(0);
  const refreshTest = useRef<(() => void) | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a successful enrollment or retry starts a fresh read of device and server state.
  useEffect(() => {
    const current = ++epoch.current;
    lock.current = false;
    setBusy(false);
    setDevice(null);
    setStatus("loading");
    async function read(background = false) {
      if (document.visibilityState === "hidden" || lock.current) return;
      const ticket = ++revision.current;
      const valid = () => epoch.current === current && revision.current === ticket && !lock.current;
      const ios =
        /iPhone|iPad|iPod/.test(navigator.userAgent) ||
        (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
      if (
        ios &&
        !matchMedia("(display-mode: standalone)").matches &&
        !(navigator as Navigator & { standalone?: boolean }).standalone
      ) {
        setStatus("ios");
        return;
      }
      if (
        !window.isSecureContext ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        setStatus("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setStatus("denied");
        setDevice(null);
        return;
      }
      try {
        const config = await api("config", actor);
        if (
          typeof config.accountId !== "string" ||
          (actor && actor !== config.accountId) ||
          typeof config.publicKey !== "string"
        )
          throw new Error("ACCOUNT_IDENTITY_CHANGED");
        const registration =
          (await navigator.serviceWorker.getRegistration("/")) ??
          (await navigator.serviceWorker.register("/sw.js", {
            scope: "/",
            updateViaCache: "none",
          }));
        const reg = registration.active
          ? registration
          : await Promise.race([
              navigator.serviceWorker.ready,
              new Promise<never>((_, reject) => {
                const timer = window.setTimeout(() => reject(new Error("PUSH_UNAVAILABLE")), 10000);
                void navigator.serviceWorker.ready.then(() => window.clearTimeout(timer));
              }),
            ]);
        const sub = await reg.pushManager.getSubscription();
        const saved = sub
          ? await api("status", config.accountId, sub)
          : { enabled: false, test: null };
        if (!valid()) return;
        setDevice({
          accountId: config.accountId,
          publicKey: config.publicKey,
          reg,
          sub,
          enabled: saved.enabled === true,
          test: saved.test,
        });
        setStatus("ready");
      } catch (error) {
        if (!valid()) return;
        const requiresLogin =
          error instanceof Error &&
          ["AUTHENTICATION_REQUIRED", "ACCOUNT_IDENTITY_CHANGED"].includes(error.message);
        if (background && !requiresLogin) return;
        setDevice(null);
        setStatus(requiresLogin ? "login" : "error");
      }
    }
    const visible = () => {
      void read();
    };
    refreshTest.current = () => void read(true);
    visible();
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      epoch.current++;
      refreshTest.current = null;
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [actor, reload]);
  const testPhase = device?.test;
  useEffect(() => {
    if (testPhase !== "scheduled" && testPhase !== "accepted") return;
    const timer = window.setInterval(() => refreshTest.current?.(), 10000);
    const stop = window.setTimeout(() => window.clearInterval(timer), 150000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, [testPhase]);
  const enabled = device?.enabled === true && status === "ready";
  useEffect(() => {
    onEnabled?.(enabled);
  }, [enabled, onEnabled]);

  async function change(action: "enable" | "test" | "disable") {
    if (!device || lock.current) return;
    const current = epoch.current;
    revision.current++;
    lock.current = true;
    setBusy(true);
    setNote("");
    let sub = device.sub;
    try {
      if (action === "enable") {
        // subscribe is called directly from the tap: Safari requires transient user activation.
        if (!sub)
          sub = await device.reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: device.publicKey,
          });
        await api("subscribe", device.accountId, sub);
      } else if (sub) {
        if (action === "test") {
          const result = await api("test", device.accountId, sub);
          if (current === epoch.current) setDevice({ ...device, test: result.test });
        } else {
          await api("unsubscribe", device.accountId, sub);
          await sub.unsubscribe();
        }
      }
      if (current === epoch.current && action !== "test") setReload((n) => n + 1);
    } catch (error) {
      if (current !== epoch.current) return;
      const code = error instanceof Error ? error.message : "";
      if (code === "PUSH_REBIND" && sub) {
        if (await sub.unsubscribe().catch(() => false)) setReload((n) => n + 1);
        setNote("Ponovo odaberi uključenje da povežeš ovaj nalog.");
      } else if (Notification.permission === "denied") {
        setStatus("denied");
        setDevice(null);
      } else
        setNote(
          code === "PUSH_TEST_LIMIT"
            ? "Za novu probu pričekaj jednu minutu."
            : code === "TOO_MANY_DEVICES"
              ? "Dostignut je broj povezanih uređaja."
              : "Promjena nije potvrđena. Pokušaj ponovo.",
        );
    } finally {
      if (current === epoch.current) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  const detail =
    status === "ios"
      ? "Dodaj AhiBizz na početni ekran iPhonea i otvori ga odatle (iOS 16.4 ili noviji)."
      : status === "unsupported"
        ? "Ovaj preglednik ne podržava push obavijesti."
        : status === "denied"
          ? "Dozvoli obavijesti u postavkama uređaja."
          : status === "login"
            ? "Prijavi se za obavijesti o porukama."
            : status === "error"
              ? "Trenutno ne možemo provjeriti obavijesti."
              : enabled
                ? "Uključene na ovom uređaju."
                : status === "ready"
                  ? "Nove poruke na ovom uređaju."
                  : "";
  return (
    <>
      <div className={styles.row}>
        <span className={styles.icon} aria-hidden="true">
          <Icon name="message" />
        </span>
        <div className={styles.description}>
          <h3>Obavijesti</h3>
          <p role="status">{detail}</p>
        </div>
        {status === "ready" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void change(enabled ? "disable" : "enable")}
          >
            {enabled ? "Isključi" : "Dozvoli obavijesti"}
          </button>
        )}
        {status === "login" && (
          <Link href={`/prijava?nastavi=${encodeURIComponent(settings)}`}>Prijava</Link>
        )}
        {status === "error" && (
          <button type="button" onClick={() => setReload((n) => n + 1)}>
            Pokušaj ponovo
          </button>
        )}
      </div>
      {enabled && (
        <button
          type="button"
          className={styles.dismiss}
          disabled={busy}
          onClick={() => void change("test")}
        >
          Probaj za 30 s
        </button>
      )}
      {(note || (enabled && device?.test && tests[device.test])) && (
        <p className={styles.note} role="status">
          {note || tests[device?.test ?? ""]}
        </p>
      )}
    </>
  );
}
