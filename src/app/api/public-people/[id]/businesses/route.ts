import { handlePublicPersonBusinesses } from "../../../../../server/public-person-businesses-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handlePublicPersonBusinesses(request, (await params).id);
}
