"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createDeviceLocationController,
  type DeviceLocationState,
  initialDeviceLocation,
} from "../../lib/device-location";

type LocationContext = DeviceLocationState & {
  requestLocation: () => void;
  activate: () => () => void;
};
const Context = createContext<LocationContext | null>(null);

export function DeviceLocationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(initialDeviceLocation);
  const [consumers, setConsumers] = useState(0);
  const controller = useRef<ReturnType<typeof createDeviceLocationController> | null>(null);
  useEffect(() => {
    const location = createDeviceLocationController(
      {
        gps: window.isSecureContext ? navigator.geolocation : undefined,
        permission: navigator.permissions
          ? () => navigator.permissions.query({ name: "geolocation" })
          : undefined,
        visible: () => document.visibilityState === "visible",
        observeVisibility(listener) {
          document.addEventListener("visibilitychange", listener);
          window.addEventListener("focus", listener);
          return () => {
            document.removeEventListener("visibilitychange", listener);
            window.removeEventListener("focus", listener);
          };
        },
        now: Date.now,
        schedule: (callback, delay) => window.setTimeout(callback, delay),
        cancel: (id) => window.clearTimeout(id),
        remembered() {
          try {
            return window.localStorage.getItem("ahibizz.location.allowed.v1") === "1";
          } catch {
            return false;
          }
        },
        remember(allowed) {
          try {
            if (allowed) window.localStorage.setItem("ahibizz.location.allowed.v1", "1");
            else window.localStorage.removeItem("ahibizz.location.allowed.v1");
          } catch {
            /* Optional preference storage may be unavailable. */
          }
        },
      },
      setState,
    );
    controller.current = location;
    location.start();
    return () => {
      location.stop();
      controller.current = null;
    };
  }, []);
  useEffect(() => {
    controller.current?.setActive(consumers > 0);
  }, [consumers]);
  const activate = useCallback(() => {
    setConsumers((value) => value + 1);
    return () => setConsumers((value) => Math.max(0, value - 1));
  }, []);
  const requestLocation = useCallback(() => controller.current?.requestLocation(), []);
  const value = useMemo(
    () => ({ ...state, activate, requestLocation }),
    [state, activate, requestLocation],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useDeviceLocation({ active = false }: { active?: boolean } = {}) {
  const context = useContext(Context);
  if (!context) throw new Error("Device location provider is missing");
  const activate = context.activate;
  useEffect(() => (active ? activate() : undefined), [active, activate]);
  return context;
}
