"use server";
import { revalidatePath, updateTag } from "next/cache";
import { headers } from "next/headers";
import type { VisualDesign } from "../../lib/visual-design";
import { AccountAccessError } from "../../server/auth/accounts";
import {
  getVisualDesignStore,
  type VisualDesignState,
  visualDesignTag,
} from "../../server/visual-design-store";

export async function saveVisualDesign(
  actor: string,
  revision: number,
  design: VisualDesign,
  mode: "draft" | "publish",
): Promise<
  { ok: true; state: VisualDesignState } | { ok: false; message: string; conflict?: boolean }
> {
  const service = getVisualDesignStore();
  if (!service || typeof actor !== "string" || !actor)
    return { ok: false, message: "Uređivač trenutno nije dostupan." };
  const h = new Headers(await headers());
  h.set("X-AhiBizz-Account-ID", actor);
  try {
    const state = await service.write(h, revision, design, mode);
    if (mode === "publish") {
      updateTag(visualDesignTag);
      revalidatePath("/", "layout");
    }
    return { ok: true, state };
  } catch (error) {
    const status = error instanceof AccountAccessError ? error.status : 503;
    if (status === 409)
      return {
        ok: false,
        conflict: true,
        message: "U drugoj kartici sačuvana je novija verzija. Učitaj je prije nastavka.",
      };
    return {
      ok: false,
      message:
        status === 400
          ? "Provjeri unesene vrijednosti."
          : status === 401 || status === 403
            ? "Za ovu izmjenu potrebna je administratorska prijava."
            : "Spremanje nije potvrđeno. Osvježi uređivač i provjeri nacrt.",
    };
  }
}
