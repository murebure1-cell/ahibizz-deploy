"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { AccountAccessError } from "../../server/auth/accounts";
import { getSupportRequests } from "../../server/support-requests";

export type RequestResult = { sent: boolean; message: string };
export async function submitSupportRequest(
  _: RequestResult,
  form: FormData,
): Promise<RequestResult> {
  const service = getSupportRequests();
  const actor = form.get("actor"),
    subject = form.get("subject");
  if (!service || typeof actor !== "string" || !actor)
    return { sent: false, message: "Zahtjev trenutno nije dostupan. Možeš ga poslati emailom." };
  if (subject === "deletion" && form.get("confirm") !== "yes")
    return { sent: false, message: "Potvrdi da želiš zatražiti brisanje naloga." };
  const sessionHeaders = new Headers(await headers());
  sessionHeaders.set("X-AhiBizz-Account-ID", actor);
  try {
    await service.submit(sessionHeaders, subject, form.get("reference"), form.get("details") ?? "");
    revalidatePath("/administracija/zahtjevi");
    return {
      sent: true,
      message:
        subject === "deletion"
          ? "Zahtjev za brisanje je zaprimljen."
          : "Prijava je dostavljena administratoru.",
    };
  } catch (error) {
    const status = error instanceof AccountAccessError ? error.status : 503;
    return {
      sent: false,
      message:
        status === 429
          ? "Dostignut je dnevni broj prijava. Za hitnu pomoć obrati se podršci."
          : status === 401 || status === 403
            ? "Prijava je istekla. Prijavi se ponovo ili piši podršci."
            : "Zahtjev nije potvrđen. Pokušaj ponovo ili piši podršci.",
    };
  }
}
