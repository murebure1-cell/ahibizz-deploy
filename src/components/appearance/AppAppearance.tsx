"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  type Appearance,
  appearanceStorageKey,
  isAppearance,
  resolveAppearance,
} from "../../lib/appearance";

type AppearanceContextValue = {
  appearance: Appearance;
  setAppearance: (appearance: Appearance) => void;
  resetAppearance: () => void;
};
const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function AppAppearance({ children }: { children: ReactNode }) {
  const [appearance, setState] = useState<Appearance>("system");
  const current = useRef<Appearance>("system");
  const apply = useCallback((value: Appearance) => {
    current.current = value;
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.appearance = value;
    document.documentElement.dataset.theme = resolveAppearance(value, systemDark);
    setState(value);
  }, []);
  const setAppearance = useCallback(
    (value: Appearance) => {
      if (!isAppearance(value)) return;
      try {
        window.localStorage.setItem(appearanceStorageKey, value);
      } catch {
        // Theme changes still work when browser storage is unavailable.
      }
      apply(value);
    },
    [apply],
  );
  const resetAppearance = useCallback(() => {
    try {
      window.localStorage.removeItem(appearanceStorageKey);
    } catch {
      // Storage is optional; never block logout on it.
    }
    apply("system");
  }, [apply]);

  useEffect(() => {
    let cached: unknown;
    try {
      cached = window.localStorage.getItem(appearanceStorageKey);
    } catch {}
    apply(isAppearance(cached) ? cached : "system");
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const systemChanged = () => apply(current.current);
    const storageChanged = (event: StorageEvent) => {
      if (
        (event.key === appearanceStorageKey || event.key === null) &&
        event.storageArea === window.localStorage
      )
        apply(isAppearance(event.newValue) ? event.newValue : "system");
    };
    media.addEventListener("change", systemChanged);
    window.addEventListener("storage", storageChanged);
    return () => {
      media.removeEventListener("change", systemChanged);
      window.removeEventListener("storage", storageChanged);
    };
  }, [apply]);

  return (
    <AppearanceContext.Provider value={{ appearance, setAppearance, resetAppearance }}>
      {children}
    </AppearanceContext.Provider>
  );
}

export function useAppAppearance(): AppearanceContextValue {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error("appearance_provider_required");
  return value;
}
