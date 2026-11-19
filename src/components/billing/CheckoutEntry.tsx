import { headers } from "next/headers";
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
  let userId: string | null = null;
  try {
    userId = (await getAccountService()?.read(await headers()))?.id ?? null;
  } catch {
    /* Show login without leaking account details. */
  }
  return <Checkout userId={userId} initialOrderId={id} returned={returned} cancelled={cancelled} />;
}
