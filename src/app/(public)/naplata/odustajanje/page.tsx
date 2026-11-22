import { CheckoutEntry } from "../../../../components/billing/CheckoutEntry";
export const dynamic = "force-dynamic";
export const metadata = { title: "Plaćanje otkazano", robots: { index: false, follow: false } };
export default function CancelPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <CheckoutEntry {...props} cancelled />;
}
