import { PersonBusinessesError } from "../lib/person-businesses";
import {
  getPublicPersonBusinessesService,
  type PublicPersonBusinessesService,
} from "./public-person-businesses";

function reply(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}
export function createPublicPersonBusinessesHandler(
  service: () => PublicPersonBusinessesService | null = getPublicPersonBusinessesService,
) {
  return async (request: Request, personId: string) => {
    try {
      if (request.method !== "GET") return reply({ code: "METHOD_NOT_ALLOWED" }, 405);
      const url = new URL(request.url);
      const entries = [...url.searchParams];
      if (
        entries.some(([key]) => key !== "page") ||
        entries.length > 1 ||
        (entries.length === 1 && !/^[1-9]\d{0,2}$/.test(entries[0]?.[1] ?? ""))
      )
        throw new PersonBusinessesError(400, "INVALID_PERSON_BUSINESSES_INPUT");
      const page = Number(url.searchParams.get("page") ?? "1");
      const current = service();
      if (!current) return reply({ code: "PUBLIC_BUSINESSES_UNAVAILABLE" }, 503);
      return reply(await current.list(personId, page));
    } catch (error) {
      return error instanceof PersonBusinessesError
        ? reply({ code: error.code }, error.status)
        : reply({ code: "PUBLIC_BUSINESSES_UNAVAILABLE" }, 503);
    }
  };
}
export const handlePublicPersonBusinesses = createPublicPersonBusinessesHandler();
