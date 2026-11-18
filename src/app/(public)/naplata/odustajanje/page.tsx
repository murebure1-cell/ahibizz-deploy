import { CheckoutEntry } from "../../../../components/billing/CheckoutEntry";
export const dynamic = "force-dynamic";
export default function CancelPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <CheckoutEntry {...props} cancelled />;
}
