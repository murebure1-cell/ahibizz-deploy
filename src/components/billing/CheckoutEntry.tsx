import { headers } from "next/headers";
import { businessUuid } from "../../lib/business-today";
import { getAccountService } from "../../server/auth/accounts";
import { Checkout } from "./Checkout";
export async function CheckoutEntry({
  searchParams,
  returned = false,
  cancelled = false,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  returned?: boolean;
  cancelled?: boolean;
}) {
  const query = await searchParams;
  const id =
    typeof query.narudzba === "string" && /^[a-f0-9-]{36}$/i.test(query.narudzba)
      ? query.narudzba
      : undefined;
  const quote =
    !id &&
    typeof query.ponuda === "string" &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(query.ponuda)
      ? query.ponuda
      : undefined;
  const business =
    !id && !quote && !returned && !cancelled && businessUuid(query.djelatnost)
      ? query.djelatnost
      : undefined;
  let userId: string | null = null;
  try {
    userId = (await getAccountService()?.read(await headers()))?.id ?? null;
  } catch {
    /* Show login without leaking account details. */
  }
  return (
    <Checkout
      key={`${userId}:${id ?? quote ?? business ?? ""}`}
      userId={userId}
      initialOrderId={id}
      initialQuoteId={quote}
      initialBusinessId={business}
      returned={returned}
      cancelled={cancelled}
    />
  );
}
