import { handleVerificationRequest } from "../../../../../../server/verification-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handleVerificationRequest;
export const PUT = handleVerificationRequest;
