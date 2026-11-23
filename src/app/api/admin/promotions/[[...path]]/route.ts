import { handlePromotionsRequest } from "../../../../../server/promotions/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handlePromotionsRequest;
export const POST = handlePromotionsRequest;
export const PUT = handlePromotionsRequest;
