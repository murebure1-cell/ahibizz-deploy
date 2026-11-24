"use client";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import {
  clearFavoriteIntent,
  type FavoriteIntent,
  readFavoriteIntent,
  writeFavoriteIntent,
} from "../../lib/favorite-recovery";
import {
  createFavoritesApi,
  type FavoriteState,
  type FavoritesApi,
  FavoritesClientError,
} from "../../lib/favorites";
import { msg } from "../../lib/i18n/translate";
import { useT } from "../i18n/LocaleProvider";

type Context = {
  api: FavoritesApi;
  states: ReadonlyMap<string, FavoriteState>;
  status: "checking" | "signed" | "anonymous" | "denied" | "unavailable";
  errors: ReadonlyMap<string, string>;
  busy: ReadonlySet<string>;
  mutation: number;
  register(id: string): () => void;
  refresh(): void;
  toggle(id: string): void;
  retry(id: string): void;
};
const FavoritesContext = createContext<Context | null>(null);
export function useFavorites() {
  return useContext(FavoritesContext);
}
const intentKey = (actor: string, id: string) => `${actor}:${id}`;
const uncertain = msg("Promjena nije potvrđena. Provjeri stanje ili ponovi isti pokušaj.");
export function FavoritesProvider({
  children,
  api: provided,
}: {
  children: ReactNode;
  api?: FavoritesApi;
}) {
  const t = useT();
  const api = useMemo(() => provided ?? createFavoritesApi(), [provided]),
    [states, setStates] = useState<ReadonlyMap<string, FavoriteState>>(new Map()),
    [status, setStatus] = useState<Context["status"]>("checking"),
    [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map()),
    [busy, setBusy] = useState<ReadonlySet<string>>(new Set()),
    [mutation, setMutation] = useState(0);
  const ids = useRef(new Map<string, number>()),
    epoch = useRef(0),
    reads = useRef(0),
    actor = useRef<string | undefined>(undefined),
    stateRef = useRef(states),
    pending = useRef(new Map<string, FavoriteIntent>()),
    writes = useRef(new Map<string, string>()),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    controller = useRef<AbortController | null>(null),
    mounted = useRef(true);
  stateRef.current = states;
  const visibleBusy = useCallback((accountId: string | undefined) => {
    const result = new Set<string>();
    if (accountId)
      for (const id of ids.current.keys())
        if (writes.current.has(intentKey(accountId, id))) result.add(id);
    setBusy(result);
  }, []);
  const refresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      if (!mounted.current || document.visibilityState === "hidden") return;
      const targets = [...ids.current.keys()];
      if (!targets.length) return;
      const run = epoch.current,
        read = ++reads.current;
      controller.current?.abort();
      const request = new AbortController();
      controller.current = request;
      setStatus("checking");
      void (async () => {
        let currentActor = actor.current;
        const next = new Map<string, FavoriteState>();
        for (let offset = 0; offset < targets.length; offset += 50) {
          const result = await api.states(
            targets.slice(offset, offset + 50),
            currentActor,
            request.signal,
          );
          if (
            request.signal.aborted ||
            epoch.current !== run ||
            reads.current !== read ||
            !mounted.current
          )
            return;
          if (currentActor && result.accountId !== currentActor)
            throw new FavoritesClientError("ACCOUNT_IDENTITY_CHANGED", 401);
          currentActor = result.accountId;
          for (const item of result.items) {
            if (!targets.includes(item.businessId)) throw new Error("invalid_favorite_target");
            next.set(item.businessId, item);
          }
        }
        if (
          request.signal.aborted ||
          epoch.current !== run ||
          reads.current !== read ||
          !mounted.current ||
          !currentActor
        )
          return;
        const accountId = currentActor,
          sameActor = accountId === actor.current,
          nextErrors = new Map<string, string>();
        for (const [id, row] of next) {
          const name = intentKey(accountId, id);
          let intent = pending.current.get(name);
          try {
            intent = readFavoriteIntent(localStorage, accountId, id) ?? intent;
          } catch {
            nextErrors.set(id, t("Spremanje trenutno nije dostupno. Pokušaj ponovo."));
            continue;
          }
          if (intent) {
            if (row.version > intent.command.expectedVersion) {
              try {
                clearFavoriteIntent(localStorage, intent);
              } catch {}
              pending.current.delete(name);
              writes.current.delete(name);
            } else {
              pending.current.set(name, intent);
              nextErrors.set(id, uncertain);
            }
          }
        }
        actor.current = accountId;
        setStates((previous) => {
          if (sameActor)
            for (const [id, old] of previous)
              if (next.has(id) && old.version > (next.get(id)?.version ?? -1)) next.set(id, old);
          return next;
        });
        setErrors(nextErrors);
        setStatus("signed");
        visibleBusy(accountId);
      })().catch((error) => {
        if (
          request.signal.aborted ||
          epoch.current !== run ||
          reads.current !== read ||
          !mounted.current
        )
          return;
        actor.current = undefined;
        setStates(new Map());
        setErrors(new Map());
        setBusy(new Set());
        setStatus(
          error instanceof FavoritesClientError && error.status === 401
            ? "anonymous"
            : error instanceof FavoritesClientError && error.status === 403
              ? "denied"
              : "unavailable",
        );
      });
    }, 0);
  }, [api, visibleBusy, t]);
  const register = useCallback(
    (id: string) => {
      ids.current.set(id, (ids.current.get(id) ?? 0) + 1);
      refresh();
      return () => {
        const count = ids.current.get(id) ?? 0;
        if (count <= 1) ids.current.delete(id);
        else ids.current.set(id, count - 1);
      };
    },
    [refresh],
  );
  useLayoutEffect(() => {
    mounted.current = true;
    function conceal(synchronous = true) {
      epoch.current++;
      controller.current?.abort();
      actor.current = undefined;
      const clear = () => {
        setStates(new Map());
        setErrors(new Map());
        setBusy(new Set());
        setStatus("checking");
      };
      if (synchronous) flushSync(clear);
      else clear();
    }
    const suspend = () => conceal(),
      resume = () => {
        conceal();
        refresh();
      },
      visibility = () => (document.visibilityState === "hidden" ? conceal() : resume());
    window.addEventListener("blur", suspend);
    window.addEventListener("pagehide", suspend);
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", visibility);
    conceal(false);
    refresh();
    return () => {
      mounted.current = false;
      epoch.current++;
      controller.current?.abort();
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener("blur", suspend);
      window.removeEventListener("pagehide", suspend);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [refresh]);
  const dispatch = useCallback(
    (intent: FavoriteIntent) => {
      const accountId = actor.current,
        id = intent.businessId;
      if (!accountId || accountId !== intent.accountId) return;
      const name = intentKey(accountId, id),
        key = intent.command.idempotencyKey;
      if (writes.current.has(name)) return;
      try {
        const written = writeFavoriteIntent(localStorage, intent);
        pending.current.set(name, written);
      } catch {
        setErrors((previous) =>
          new Map(previous).set(id, t("Spremanje trenutno nije dostupno. Pokušaj ponovo.")),
        );
        return;
      }
      const run = epoch.current;
      writes.current.set(name, key);
      visibleBusy(accountId);
      setErrors((previous) => {
        const next = new Map(previous);
        next.delete(id);
        return next;
      });
      void api
        .set(id, intent.command, accountId)
        .then((result) => {
          const after = result.items[0];
          if (
            result.accountId !== accountId ||
            result.items.length !== 1 ||
            after?.businessId !== id ||
            after.version !== intent.command.expectedVersion + 1 ||
            after.saved !== intent.command.saved
          )
            throw new Error("invalid_favorite_acknowledgement");
          if (pending.current.get(name)?.command.idempotencyKey === key) {
            try {
              clearFavoriteIntent(localStorage, intent);
            } catch {}
            pending.current.delete(name);
          }
          if (!mounted.current || epoch.current !== run || actor.current !== accountId) return;
          setStates((previous) => {
            const next = new Map(previous);
            if ((next.get(id)?.version ?? -1) <= after.version) next.set(id, after);
            return next;
          });
          setMutation((value) => value + 1);
        })
        .catch((error) => {
          if (!mounted.current || epoch.current !== run || actor.current !== accountId) return;
          if (error instanceof FavoritesClientError && [401, 403].includes(error.status)) {
            actor.current = undefined;
            setStates(new Map());
            setErrors(new Map());
            setStatus(error.status === 401 ? "anonymous" : "denied");
          } else setErrors((previous) => new Map(previous).set(id, uncertain));
        })
        .finally(() => {
          if (writes.current.get(name) === key) writes.current.delete(name);
          if (mounted.current && actor.current === accountId) visibleBusy(accountId);
        });
    },
    [api, visibleBusy, t],
  );
  const toggle = useCallback(
    (id: string) => {
      const accountId = actor.current,
        before = stateRef.current.get(id);
      if (!accountId || !before) return;
      const name = intentKey(accountId, id);
      let stored: FavoriteIntent | null;
      try {
        stored = readFavoriteIntent(localStorage, accountId, id);
      } catch {
        setErrors((previous) =>
          new Map(previous).set(id, t("Spremanje trenutno nije dostupno. Pokušaj ponovo.")),
        );
        return;
      }
      if (stored || pending.current.has(name)) {
        if (stored) pending.current.set(name, stored);
        setErrors((previous) => new Map(previous).set(id, uncertain));
        return;
      }
      dispatch({
        accountId,
        businessId: id,
        command: {
          saved: !before.saved,
          expectedVersion: before.version,
          idempotencyKey: crypto.randomUUID(),
        },
      });
    },
    [dispatch, t],
  );
  const retry = useCallback(
    (id: string) => {
      const accountId = actor.current;
      if (!accountId) return;
      const intent = pending.current.get(intentKey(accountId, id));
      if (intent) dispatch(intent);
      else refresh();
    },
    [dispatch, refresh],
  );
  return (
    <FavoritesContext.Provider
      value={{ api, states, status, errors, busy, mutation, register, refresh, toggle, retry }}
    >
      {children}
    </FavoritesContext.Provider>
  );
}
