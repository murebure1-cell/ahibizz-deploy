import { handlePackageSubscriptions } from "../../../../server/paypal-subscriptions/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handlePackageSubscriptions(request, "live");
export const POST = GET;
