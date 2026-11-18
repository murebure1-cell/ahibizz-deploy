import { CheckoutEntry } from "../../../components/billing/CheckoutEntry";
export const dynamic = "force-dynamic";
export const metadata = { title: "Plaćanje", robots: { index: false, follow: false } };
export default function CheckoutPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <CheckoutEntry {...props} />;
}
