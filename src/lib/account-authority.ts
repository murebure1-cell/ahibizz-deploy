import type { SafeAccountProfile } from "../server/auth/accounts";
import {
  AccountSettingsError,
  accountSettingsActorRequest,
  accountSettingsRequest,
  readAccountSettings,
} from "./account-settings";

export type AccountAuthorityState = Readonly<{
  visible: boolean;
  checking: boolean;
  denied: boolean;
  unavailable: boolean;
}>;

/** Browser presentation only. Every private server operation still checks its signed actor. */
export function createAccountAuthorityBoundary({
  accountId,
  expectedRole,
  request = accountSettingsRequest,
  initialVisible = true,
  changed,
  confirmed,
  timeoutMs = 20_000,
}: {
  accountId: string;
  expectedRole?: SafeAccountProfile["role"];
  request?: typeof accountSettingsRequest;
  initialVisible?: boolean;
  changed: (state: AccountAuthorityState) => void;
  confirmed?: (account: SafeAccountProfile) => void;
  timeoutMs?: number;
}) {
  const read = accountSettingsActorRequest(accountId, request);
  let state: AccountAuthorityState = {
      visible: initialVisible,
      checking: false,
      denied: false,
      unavailable: false,
    },
    epoch = 0,
    disposed = false,
    controller: AbortController | null = null,
    timer: ReturnType<typeof setTimeout> | null = null;
  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const update = (next: AccountAuthorityState) => {
    state = Object.freeze(next);
    changed(state);
  };
  const conceal = () => {
    if (disposed) return;
    epoch++;
    clearTimer();
    controller?.abort();
    controller = null;
    update({ visible: false, checking: false, denied: false, unavailable: false });
  };
  const revalidate = async () => {
    if (disposed || state.visible || controller) return;
    const current = ++epoch,
      abort = new AbortController();
    controller = abort;
    update({ visible: false, checking: true, denied: false, unavailable: false });
    timer = setTimeout(() => {
      if (disposed || current !== epoch) return;
      epoch++;
      abort.abort();
      controller = null;
      timer = null;
      update({ visible: false, checking: false, denied: false, unavailable: true });
    }, timeoutMs);
    try {
      const account = readAccountSettings(await read({ signal: abort.signal }), accountId);
      if (disposed || abort.signal.aborted || current !== epoch) return;
      if (expectedRole !== undefined && account.role !== expectedRole)
        throw new AccountSettingsError(403, "ACCOUNT_ROLE_CHANGED");
      confirmed?.(account);
      if (disposed || abort.signal.aborted || current !== epoch) return;
      update({ visible: true, checking: false, denied: false, unavailable: false });
    } catch (failure) {
      if (disposed || abort.signal.aborted || current !== epoch) return;
      const denied = failure instanceof AccountSettingsError && [401, 403].includes(failure.status);
      update({ visible: false, checking: false, denied, unavailable: !denied });
    } finally {
      if (current === epoch) {
        clearTimer();
        if (controller === abort) controller = null;
      }
    }
  };
  return {
    conceal,
    revalidate,
    state: () => state,
    dispose: () => {
      disposed = true;
      epoch++;
      clearTimer();
      controller?.abort();
      controller = null;
    },
  };
}
