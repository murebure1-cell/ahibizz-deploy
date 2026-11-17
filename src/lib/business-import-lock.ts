import { importFail } from "./business-import";

export type ImportLock = (
  actor: string,
  signal: AbortSignal,
  action: () => Promise<void>,
) => Promise<void>;

/** Immediate cross-tab exclusion. ifAvailable cannot be combined with a native abort signal. */
export const browserImportLock: ImportLock = async (actor, signal, action) => {
  if (signal.aborted) importFail("STOPPED");
  if (!navigator.locks) importFail("LOCK_UNAVAILABLE");
  await navigator.locks.request(
    `ahibizz-business-import:${actor}`,
    { mode: "exclusive", ifAvailable: true },
    async (lock) => {
      if (signal.aborted) importFail("STOPPED");
      if (!lock) importFail("IMPORT_RUNNING");
      await action();
    },
  );
};
