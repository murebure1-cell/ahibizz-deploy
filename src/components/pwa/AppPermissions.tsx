"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "../Icon";
import { useDeviceLocation } from "../location/DeviceLocation";
import { useAppPwa } from "./AppPwa";
import styles from "./permissions.module.css";

const dismissedKey = "ahibizz.device-permissions.v1";

function dismissSetup() {
  try {
    // This device-only marker contains no account, coordinates or permission claims.
    localStorage.setItem(dismissedKey, "dismissed");
  } catch {}
}

export function AppPermissionPrompt() {
  const { installed } = useAppPwa();
  const pathname = usePathname();
  const attempted = useRef(false);
  const [open, setOpen] = useState(false);
  const excluded =
    !pathname ||
    pathname === "/instaliraj" ||
    pathname === "/pregled" ||
    pathname.startsWith("/pregled/");

  useEffect(() => {
    if (!installed || excluded || attempted.current) return;
    attempted.current = true;
    try {
      if (localStorage.getItem(dismissedKey) === "dismissed") return;
    } catch {}
    setOpen(true);
  }, [installed, excluded]);

  if (!installed || excluded || !open) return null;
  return (
    <aside className={styles.prompt} aria-label="Dozvole uređaja">
      <DevicePermissions
        onConfigured={dismissSetup}
        onDismiss={() => {
          dismissSetup();
          setOpen(false);
        }}
      />
    </aside>
  );
}

export function DevicePermissions({
  onDismiss,
  onConfigured,
}: {
  onDismiss?: () => void;
  onConfigured?: () => void;
}) {
  const pwa = useAppPwa();
  const location = useDeviceLocation();
  const heading = useId();
  const [availableLocation, setAvailableLocation] = useState<boolean | null>(null);
  const [notification, setNotification] = useState<NotificationPermission | null>(null);
  const [notificationAvailable, setNotificationAvailable] = useState<boolean | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [note, setNote] = useState("");
  const busy = useRef(false);
  const live = useRef(false);

  useEffect(() => {
    live.current = true;
    const read = () => {
      if (document.visibilityState === "hidden") return;
      setAvailableLocation(
        window.isSecureContext && typeof navigator.geolocation?.getCurrentPosition === "function",
      );
      const supported =
        window.isSecureContext &&
        typeof window.Notification?.requestPermission === "function" &&
        !pwa.embedded &&
        (pwa.platform !== "ios" || pwa.installed);
      setNotificationAvailable(supported);
      setNotification(supported ? Notification.permission : null);
    };
    read();
    window.addEventListener("focus", read);
    document.addEventListener("visibilitychange", read);
    return () => {
      live.current = false;
      window.removeEventListener("focus", read);
      document.removeEventListener("visibilitychange", read);
    };
  }, [pwa.embedded, pwa.platform, pwa.installed]);

  async function requestNotifications() {
    if (busy.current || !notificationAvailable) return;
    if (Notification.permission !== "default") {
      setNotification(Notification.permission);
      return;
    }
    busy.current = true;
    setRequesting(true);
    setNote("");
    try {
      // Call before any await: browsers require this request in the actual tap's activation.
      await Notification.requestPermission();
      if (live.current) setNotification(Notification.permission);
    } catch {
      if (live.current) setNote("Dozvolu možeš promijeniti u postavkama uređaja.");
    } finally {
      busy.current = false;
      if (live.current) setRequesting(false);
    }
  }

  const locationGranted = availableLocation === true && location.permission === "granted";
  useEffect(() => {
    if (locationGranted && notification === "granted") onConfigured?.();
  }, [locationGranted, notification, onConfigured]);
  return (
    <section className={styles.permissions} aria-labelledby={heading}>
      <h2 id={heading}>Dozvole uređaja</h2>
      <div className={styles.row}>
        <span className={styles.icon} aria-hidden="true">
          <Icon name="pin" />
        </span>
        <div className={styles.description}>
          <h3>Lokacija</h3>
          <p>
            {availableLocation === false
              ? "Nije dostupna na ovom uređaju."
              : location.permission === "denied"
                ? "Uključi je u postavkama uređaja."
                : locationGranted
                  ? "Dozvoljena"
                  : "Djelatnosti u tvojoj blizini."}
          </p>
        </div>
        {availableLocation && location.permission !== "denied" && !locationGranted && (
          <button
            type="button"
            disabled={location.status === "locating"}
            onClick={location.requestLocation}
          >
            {location.status === "locating" ? "Tražim…" : "Dozvoli lokaciju"}
          </button>
        )}
        {locationGranted && <Icon name="check" />}
      </div>
      <div className={styles.row}>
        <span className={styles.icon} aria-hidden="true">
          <Icon name="message" />
        </span>
        <div className={styles.description}>
          <h3>Obavijesti</h3>
          <p role="status">
            {notificationAvailable === false
              ? "Nisu dostupne u ovom pregledniku."
              : notification === "denied"
                ? "Uključi ih u postavkama uređaja."
                : notification === "granted"
                  ? "Dozvoljene"
                  : "Izaberi dozvolu za ovaj uređaj."}
          </p>
        </div>
        {notificationAvailable && notification === "default" && (
          <button type="button" disabled={requesting} onClick={() => void requestNotifications()}>
            {requesting ? "Potvrdi…" : "Dozvoli obavijesti"}
          </button>
        )}
        {notification === "granted" && <Icon name="check" />}
      </div>
      {note && (
        <p className={styles.note} role="status">
          {note}
        </p>
      )}
      {onDismiss && (
        <button className={styles.dismiss} type="button" onClick={onDismiss}>
          {locationGranted && notification === "granted" ? "Gotovo" : "Kasnije"}
        </button>
      )}
    </section>
  );
}
