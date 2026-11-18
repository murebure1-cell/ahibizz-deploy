"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "../Icon";
import { useDeviceLocation } from "../location/DeviceLocation";
import { useAppPwa } from "./AppPwa";
import { DevicePush } from "./DevicePush";
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
  const location = useDeviceLocation();
  const heading = useId();
  const [availableLocation, setAvailableLocation] = useState<boolean | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);

  useEffect(() => {
    const read = () => {
      if (document.visibilityState === "hidden") return;
      setAvailableLocation(
        window.isSecureContext && typeof navigator.geolocation?.getCurrentPosition === "function",
      );
    };
    read();
    window.addEventListener("focus", read);
    document.addEventListener("visibilitychange", read);
    return () => {
      window.removeEventListener("focus", read);
      document.removeEventListener("visibilitychange", read);
    };
  }, []);

  const locationGranted = availableLocation === true && location.permission === "granted";
  useEffect(() => {
    if (locationGranted && pushEnabled) onConfigured?.();
  }, [locationGranted, pushEnabled, onConfigured]);
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
      <DevicePush onEnabled={setPushEnabled} />
      {onDismiss && (
        <button className={styles.dismiss} type="button" onClick={onDismiss}>
          {locationGranted && pushEnabled ? "Gotovo" : "Kasnije"}
        </button>
      )}
    </section>
  );
}
