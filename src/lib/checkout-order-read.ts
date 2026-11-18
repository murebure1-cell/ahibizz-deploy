export class CheckoutOrderReadError extends Error {
  constructor(public readonly status: number) {
    super(
      status === 401
        ? "Prijavi se da učitaš sačuvanu narudžbu."
        : status === 403
          ? "Nalog je promijenjen ili nema pristup ovoj narudžbi. Provjeri prijavu."
          : status === 404
            ? "Narudžba nije pronađena na ovom nalogu."
            : "Sačuvanu narudžbu trenutno nije moguće učitati. Pokušaj ponovo; ne otvaraj novu narudžbu.",
    );
  }
}
const transient = new Set([429, 502, 503, 504]);
/** Read-only bounded retries. Never retries create, capture or reconciliation. */
export async function readCheckoutOrder<T>(
  id: string,
  userId: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted();
    const timeout = AbortSignal.timeout(8000);
    try {
      const response = await fetcher(`/api/checkout/orders/${encodeURIComponent(id)}`, {
        method: "GET",
        headers: { "X-AhiBizz-Account-ID": userId },
        cache: "no-store",
        signal: AbortSignal.any([signal, timeout]),
      });
      if (!response.ok) throw new CheckoutOrderReadError(response.status);
      const value = await response.json();
      if (!value.order || value.order.id !== id) throw new CheckoutOrderReadError(502);
      return value.order as T;
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof CheckoutOrderReadError && !transient.has(error.status)) throw error;
      if (attempt === 2)
        throw new CheckoutOrderReadError(
          error instanceof CheckoutOrderReadError ? error.status : 0,
        );
      await pause(300 * (attempt + 1));
    }
  }
  throw new CheckoutOrderReadError(0);
}
