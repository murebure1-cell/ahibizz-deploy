import { createBankTopUpHandler } from "../../../../../server/wallet/bank-http";
export const dynamic = "force-dynamic";
const handle = createBankTopUpHandler();
async function route(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  return handle(request, (await context.params).path ?? []);
}

export { route as GET, route as POST };
