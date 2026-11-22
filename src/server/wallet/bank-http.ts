import type { BankTopUpStatus } from "../../lib/bank-credit-topup";
import { IS_PLAY_EDITION } from "../../lib/distribution";
import { AccountAccessError } from "../auth/accounts";
import { readAuthConfiguration } from "../auth/config";
import { readFlatJson } from "../flat-json";
import { type BankTopUpService, getBankTopUpService } from "./bank-topup";

function reply(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
}
const invalid = (): never => {
  throw new AccountAccessError(400, "INVALID_BANK_TOPUP");
};
export function createBankTopUpHandler(
  options: {
    service?: () => BankTopUpService | null;
    origin?: () => string | null;
    disabled?: () => boolean;
  } = {},
) {
  return async (request: Request, path: string[] = []) => {
    try {
      if ((options.disabled ?? (() => IS_PLAY_EDITION))()) return reply({ code: "NOT_FOUND" }, 404);
      if (!request.headers.get("X-AhiBizz-Account-ID"))
        return reply({ code: "ACCOUNT_IDENTITY_CHANGED" }, 401);
      const store = (options.service ?? getBankTopUpService)();
      if (!store) return reply({ code: "BANK_TOPUP_UNAVAILABLE" }, 503);
      const query = new URL(request.url).searchParams;
      if (request.method === "GET" && path.length === 0) {
        if (
          [...query.keys()].some(
            (key) => !["scope", "page", "status"].includes(key) || query.getAll(key).length !== 1,
          )
        )
          invalid();
        const scope = query.get("scope") ?? "mine",
          page = query.get("page") ?? "1",
          status = query.get("status");
        if (
          !["mine", "admin"].includes(scope) ||
          !/^[1-9][0-9]{0,3}$/.test(page) ||
          Number(page) > 1000 ||
          (status !== null &&
            (scope !== "admin" || !["pending", "approved", "cancelled"].includes(status)))
        )
          invalid();
        return reply(
          await store.read(
            request.headers,
            scope as "mine" | "admin",
            Number(page),
            (status as BankTopUpStatus | undefined) ?? undefined,
          ),
        );
      }
      if (
        request.method !== "POST" ||
        query.size ||
        (path.length !== 0 && (path.length !== 2 || !["approve", "cancel"].includes(path[1] ?? "")))
      )
        return reply({ code: "NOT_FOUND" }, 404);
      const base = (options.origin ?? (() => readAuthConfiguration()?.baseURL ?? null))();
      if (!base || request.headers.get("origin") !== new URL(base).origin)
        return reply({ code: "INVALID_ORIGIN" }, 403);
      if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json")
        return reply({ code: "INVALID_CONTENT_TYPE" }, 415);
      const body = await readFlatJson(request, invalid, () => {
        throw new AccountAccessError(413, "REQUEST_TOO_LARGE");
      });
      if (path.length === 0) return reply(await store.create(request.headers, body));
      if (path[1] === "approve")
        return reply(await store.approve(request.headers, path[0] ?? "", body));
      return reply(await store.cancel(request.headers, path[0] ?? "", body));
    } catch (error) {
      return error instanceof AccountAccessError
        ? reply({ code: error.code }, error.status)
        : reply({ code: "BANK_TOPUP_UNAVAILABLE" }, 503);
    }
  };
}
