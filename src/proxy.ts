import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import { beforeOpening, openBeforeOpening, openingMoment, openingPath } from "./lib/opening";

/**
 * Before the opening (see lib/opening.ts) a visitor without a session sees "Uskoro otvaramo" in
 * place of every public page. The address in the bar stays, so the same link shows the real page
 * once the day has come or the person has signed in.
 *
 * This is a curtain, not a lock: it only looks whether a session cookie is there. Every private
 * page and every interface keeps checking the session itself, exactly as without the curtain.
 * With no opening set it lets everything through.
 */
export function proxy(request: NextRequest) {
  const moment = openingMoment(process.env.AHIBIZZ_OPENING_AT);
  if (!beforeOpening(moment, Date.now())) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  if (openBeforeOpening(pathname) || getSessionCookie(request)) return NextResponse.next();
  const page = request.nextUrl.clone();
  page.pathname = openingPath;
  page.search = "";
  // The page offers sign-in with the way back to where the visitor was going.
  page.searchParams.set("od", `${pathname}${search}`);
  const response = NextResponse.rewrite(page);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  // Pages only: never the interfaces under /api, the framework's own files, or a file with an
  // extension (icons, fonts, the manifest, the service worker).
  matcher: ["/((?!api/|_next/|[^?]*\\.[^/?]+$).*)"],
};
