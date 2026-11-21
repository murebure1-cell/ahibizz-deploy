"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { AccountAccessError } from "../../server/auth/accounts";
import { getContentHub } from "../../server/content-hub";

type BookmarkResult = { saved: boolean | null; error: string };
export async function bookmarkArticle(
  previous: BookmarkResult,
  form: FormData,
): Promise<BookmarkResult> {
  const service = getContentHub();
  const actor = form.get("actor"),
    slug = form.get("slug"),
    save = form.get("save");
  if (
    !service ||
    typeof actor !== "string" ||
    typeof slug !== "string" ||
    (save !== "yes" && save !== "no")
  )
    return { ...previous, error: "Sačuvani članci trenutno nisu dostupni." };
  const sessionHeaders = new Headers(await headers());
  sessionHeaders.set("X-AhiBizz-Account-ID", actor);
  try {
    await service.setBookmark(sessionHeaders, slug, save === "yes");
    revalidatePath("/blog");
    revalidatePath(`/blog/${slug}`);
    return { saved: save === "yes", error: "" };
  } catch (error) {
    return {
      ...previous,
      error:
        error instanceof AccountAccessError && error.status === 401
          ? "Prijavi se ponovo da sačuvaš članak."
          : "Promjena trenutno nije sačuvana.",
    };
  }
}
