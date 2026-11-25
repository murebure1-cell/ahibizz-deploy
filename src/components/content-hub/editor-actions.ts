"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { contentPaths } from "../../lib/admin-navigation";
import { AccountAccessError } from "../../server/auth/accounts";
import { getContentHub } from "../../server/content-hub";

type SaveResult = { error: string };
export async function saveBlogArticle(_: SaveResult, form: FormData): Promise<SaveResult> {
  const service = getContentHub();
  const actor = form.get("actor");
  if (!service || typeof actor !== "string" || !actor)
    return { error: "Uređivanje trenutno nije dostupno." };
  const sessionHeaders = new Headers(await headers());
  sessionHeaders.set("X-AhiBizz-Account-ID", actor);
  let slug: string;
  try {
    slug = await service.saveArticle(sessionHeaders, Object.fromEntries(form));
  } catch (error) {
    const code = error instanceof AccountAccessError ? error.code : "";
    if (code === "ARTICLE_CHANGED")
      return {
        error:
          "Članak se u međuvremenu promijenio. Kopiraj svoj tekst prije osvježavanja stranice.",
      };
    if (code === "INVALID_ARTICLE")
      return {
        error: "Provjeri naslov, oznaku, sažetak i sadržaj. Izdvojiti možeš objavljen članak.",
      };
    return { error: "Članak nije sačuvan. Provjeri prijavu i pokušaj ponovo." };
  }
  revalidatePath("/blog");
  revalidatePath(`/blog/${slug}`);
  revalidatePath(contentPaths.articles);
  redirect(`${contentPaths.articles}?uredi=${slug}&sacuvano=1#uredi`);
}
