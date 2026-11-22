/** Both PayPal v6 card integrations keep card details inside provider-owned frames. */
export type PayPalEnvironment = "sandbox" | "live";
export type GuestSession = {
  start(
    options: { presentationMode: "auto"; targetElement: HTMLElement },
    order: Promise<{ orderId: string }>,
  ): Promise<void>;
  destroy(): void | Promise<void>;
};
export type GuestCallbacks = {
  onApprove(data: { orderId: string }): Promise<void>;
  onComplete(): void;
  onCancel(): void;
  onError(error: unknown): void;
  onWarn?(warning: unknown): void;
};
export type CardFieldType = "number" | "expiry" | "cvv";
export type HostedField = HTMLElement & { destroy?: () => void | Promise<void> };
export type HostedFieldState = { isEmpty: boolean; isValid: boolean };
export type AdvancedSession = {
  createCardFieldsComponent(options: {
    type: CardFieldType;
    placeholder: string;
    ariaLabel: string;
    ariaInvalidErrorMessage: string;
    style: Record<string, Record<string, string>>;
  }): HostedField;
  on(
    name: "change" | "validitychange" | "empty" | "notempty",
    handler: (event: { data: Partial<Record<CardFieldType, HostedFieldState>> }) => void,
  ): void;
  submit(
    id: string,
  ): Promise<{ state: "succeeded" | "canceled" | "failed"; data?: { orderId?: string } }>;
  destroy(): void | Promise<void>;
};
export type CardSdkInstance = {
  findEligibleMethods(options: {
    currencyCode: "EUR";
    amount: string;
  }): Promise<{ isEligible(method: "card" | "advanced_cards"): boolean }>;
  createPayPalGuestOneTimePaymentSession(
    callbacks: GuestCallbacks,
  ): GuestSession | Promise<GuestSession>;
  createCardFieldsOneTimePaymentSession?: () => AdvancedSession;
};
export type Sdk = {
  createInstance(options: {
    clientId: string;
    components: Array<"paypal-guest-payments" | "card-fields">;
    pageType: "checkout";
  }): Promise<CardSdkInstance>;
};
export type SubscriptionButtons = {
  isEligible(): boolean;
  render(target: HTMLElement): Promise<void>;
  close(): Promise<void>;
};
type SubscriptionSdk = {
  Buttons(options: {
    fundingSource: "card";
    style: { layout: "vertical"; shape: "rect"; height: number };
    onClick(
      data: unknown,
      actions: { resolve(): Promise<void>; reject(): Promise<void> },
    ): Promise<void>;
    createSubscription(): Promise<string>;
    onApprove(data: { subscriptionID?: string }): Promise<void>;
    onCancel(): void;
    onError(): void;
  }): SubscriptionButtons;
};

const loads = new WeakMap<Document, Map<string, Promise<Sdk>>>();
const subscriptionLoads = new WeakMap<Document, Map<string, Promise<SubscriptionSdk>>>();
let namespaceCounter = 0;
const timeoutMs = 15000;
function sdkValue(value: unknown): Sdk | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Sdk>;
  return typeof candidate.createInstance === "function" ? (candidate as Sdk) : null;
}
function abortError() {
  return new DOMException("Učitavanje je otkazano.", "AbortError");
}

/** Aborting one subscriber never removes an SDK/script shared with another component.
 * Successful scripts remain reusable. Failed/timed-out scripts are removed and evicted;
 * a fresh namespace on retry prevents a late old script from replacing the new SDK.
 * No merchant secret, locale, buyer-country or arbitrary URL can be supplied here.
 */
export function loadPayPalCardSdk(
  clientId: string,
  signal: AbortSignal,
  environment: PayPalEnvironment = "live",
): Promise<Sdk> {
  return loadPayPalScript(clientId, signal, environment, "/web-sdk/v6/core", loads, sdkValue);
}

/** Use the subscription integration's own funding eligibility, not a one-time card check. */
export function loadSubscriptionCardSdk(
  clientId: string,
  signal: AbortSignal,
  environment: PayPalEnvironment,
) {
  const params = new URLSearchParams({
    "client-id": clientId,
    currency: "EUR",
    components: "buttons",
    intent: "subscription",
    vault: "true",
  });
  return loadPayPalScript(
    clientId,
    signal,
    environment,
    `/sdk/js?${params}`,
    subscriptionLoads,
    (value) =>
      value && typeof (value as SubscriptionSdk).Buttons === "function"
        ? (value as SubscriptionSdk)
        : null,
  );
}

function loadPayPalScript<T>(
  clientId: string,
  signal: AbortSignal,
  environment: PayPalEnvironment,
  sdkPath: string,
  sourceCache: WeakMap<Document, Map<string, Promise<T>>>,
  decode: (value: unknown) => T | null,
): Promise<T> {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(clientId))
    return Promise.reject(new Error("PAYPAL_INVALID_CLIENT_ID"));
  if (environment !== "live" && environment !== "sandbox")
    return Promise.reject(new Error("PAYPAL_INVALID_ENVIRONMENT"));
  if (signal.aborted) return Promise.reject(abortError());
  if (typeof window === "undefined" || typeof document === "undefined")
    return Promise.reject(new Error("PAYPAL_BROWSER_REQUIRED"));
  const ownerDocument = document;
  const ownerWindow = window;
  const globals = ownerWindow as unknown as Record<string, unknown>;
  let cache = sourceCache.get(ownerDocument);
  if (!cache) {
    cache = new Map();
    sourceCache.set(ownerDocument, cache);
  }
  const url =
    (environment === "sandbox" ? "https://www.sandbox.paypal.com" : "https://www.paypal.com") +
    sdkPath;
  let shared = cache.get(url);
  if (!shared) {
    const namespace = `ahiPayPalCard_${Date.now().toString(36)}_${++namespaceCounter}`;
    // Starting in a microtask ensures the shared entry exists before script events run.
    shared = Promise.resolve().then(
      () =>
        new Promise<T>((resolve, reject) => {
          const script = ownerDocument.createElement("script");
          script.src = url;
          script.async = true;
          script.setAttribute("data-namespace", namespace);
          let settled = false;
          let timer: number | undefined;
          function cleanup() {
            script.removeEventListener("load", loaded);
            script.removeEventListener("error", failed);
            if (timer !== undefined) ownerWindow.clearTimeout(timer);
          }
          function finishError(code: string) {
            if (settled) return;
            settled = true;
            cleanup();
            script.remove();
            reject(new Error(code));
          }
          function loaded() {
            if (settled) return;
            const sdk = decode(globals[namespace]);
            if (!sdk) {
              finishError("PAYPAL_SDK_INVALID");
              return;
            }
            settled = true;
            cleanup();
            resolve(sdk);
          }
          function failed() {
            finishError("PAYPAL_SDK_LOAD_FAILED");
          }
          script.addEventListener("load", loaded);
          script.addEventListener("error", failed);
          timer = ownerWindow.setTimeout(() => finishError("PAYPAL_SDK_TIMEOUT"), timeoutMs);
          try {
            ownerDocument.head.appendChild(script);
          } catch {
            finishError("PAYPAL_SDK_LOAD_FAILED");
          }
        }),
    );
    const current = shared;
    cache.set(url, current);
    // Attach a rejection handler even if every caller aborts before the script settles.
    void current.catch(() => {
      if (cache.get(url) === current) cache.delete(url);
    });
  }
  const pending = shared;
  return new Promise<T>((resolve, reject) => {
    let finished = false;
    function abort() {
      if (finished) return;
      finished = true;
      signal.removeEventListener("abort", abort);
      reject(abortError());
    }
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    void pending.then(
      (sdk) => {
        if (finished) return;
        finished = true;
        signal.removeEventListener("abort", abort);
        resolve(sdk);
      },
      (error) => {
        if (finished) return;
        finished = true;
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
