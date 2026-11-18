import { CheckoutEntry } from "../../../../components/billing/CheckoutEntry";
export const dynamic = "force-dynamic";
export default function ReturnPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <CheckoutEntry {...props} returned />;
}
