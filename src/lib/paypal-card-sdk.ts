/** PayPal JS SDK v5 standard card button, not Advanced Card Fields.
 * https://developer.paypal.com/sdk/js/v5/configuration
 * Callers must check Buttons(...).isEligible() before rendering. Public client ID only.
 */
export type PayPalCardButtonOptions = {
  fundingSource: string;
  createOrder(data?: unknown, actions?: unknown): string | Promise<string>;
  onApprove(data: { orderID: string }, actions?: unknown): void | Promise<void>;
  onCancel?(data: unknown, actions?: unknown): void | Promise<void>;
  onError?(error: unknown): void;
  onClick?(
    data: unknown,
    actions: { resolve(): Promise<void>; reject(): Promise<void> },
  ): void | Promise<void>;
  style?: {
    layout?: "vertical" | "horizontal";
    color?: "gold" | "blue" | "silver" | "white" | "black";
    shape?: "rect" | "pill";
    label?: "paypal" | "checkout" | "buynow" | "pay";
    height?: number;
    borderRadius?: number;
    tagline?: boolean;
  };
};
export type PayPalCardButtons = {
  isEligible(): boolean;
  render(element: HTMLElement): Promise<void>;
  close(): void | Promise<void>;
};
export type Sdk = {
  FUNDING: { CARD: string };
  Buttons(options: PayPalCardButtonOptions): PayPalCardButtons;
};
export type PayPalCardSdk = Sdk;

const loads = new WeakMap<Document, Map<string, Promise<Sdk>>>();
let namespaceCounter = 0;
const timeoutMs = 15000;
function sdkValue(value: unknown): Sdk | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Sdk>;
  return typeof candidate.Buttons === "function" && typeof candidate.FUNDING?.CARD === "string"
    ? (candidate as Sdk)
    : null;
}
function abortError() {
  return new DOMException("Učitavanje je otkazano.", "AbortError");
}

/** Aborting one subscriber never removes an SDK/script shared with another component.
 * Successful scripts remain reusable. Failed/timed-out scripts are removed and evicted;
 * a fresh namespace on retry prevents a late old script from replacing the new SDK.
 * No merchant secret, locale, buyer-country or arbitrary URL can be supplied here.
 */
export function loadPayPalCardSdk(clientId: string, signal: AbortSignal): Promise<Sdk> {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(clientId))
    return Promise.reject(new Error("PAYPAL_INVALID_CLIENT_ID"));
  if (signal.aborted) return Promise.reject(abortError());
  if (typeof window === "undefined" || typeof document === "undefined")
    return Promise.reject(new Error("PAYPAL_BROWSER_REQUIRED"));
  const ownerDocument = document;
  const ownerWindow = window;
  const globals = ownerWindow as unknown as Record<string, unknown>;
  let cache = loads.get(ownerDocument);
  if (!cache) {
    cache = new Map();
    loads.set(ownerDocument, cache);
  }
  const parameters = new URLSearchParams({
    "client-id": clientId,
    currency: "EUR",
    intent: "capture",
    components: "buttons",
    "enable-funding": "card",
    commit: "true",
  });
  const url = `https://www.paypal.com/sdk/js?${parameters}`;
  let shared = cache.get(url);
  if (!shared) {
    const namespace = `ahiPayPalCard_${Date.now().toString(36)}_${++namespaceCounter}`;
    // Starting in a microtask ensures the shared entry exists before script events run.
    shared = Promise.resolve().then(
      () =>
        new Promise<Sdk>((resolve, reject) => {
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
            const sdk = sdkValue(globals[namespace]);
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
  return new Promise<Sdk>((resolve, reject) => {
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
