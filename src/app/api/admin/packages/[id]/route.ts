import { handleAccountPackageRequest } from "../../../../../server/account-package-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handleAccountPackageRequest;
export const PUT = handleAccountPackageRequest;
