import { handleBillingRequest } from "../../../../server/billing-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handleBillingRequest;
export const POST = handleBillingRequest;
export const PATCH = handleBillingRequest;
