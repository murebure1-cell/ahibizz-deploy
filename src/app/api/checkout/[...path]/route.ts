import { handleCheckoutRequest } from "../../../../server/paypal/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handleCheckoutRequest;
export const POST = handleCheckoutRequest;
