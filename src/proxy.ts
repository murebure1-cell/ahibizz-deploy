import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import {
  beforeOpening,
  openBeforeOpening,
  openingMoment,
  openingPath,
  returnPath,
} from "./lib/opening";

/**
 * Before the opening (see lib/opening.ts) a visitor without a session is sent from every public
 * page to "Uskoro otvaramo". The page is told where they were going, so signing in, or the day
 * itself, takes them there.
 *
 * They are sent with an ordinary redirect, on purpose. Showing the page in place of the one asked
 * for (a rewrite) names the page by a full address, which Next must recognise as its own. Behind
 * the ingress guard it does not: the server listens on 127.0.0.1, Next writes that address as
 * "localhost", takes it for another server and tries to reach it over HTTPS. That answered every
 * guest with an error on 2026-11-26. A redirect leaves the server as a path, which is the same
 * behind any proxy.
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
  // Where the visitor was going; the front page needs no mention.
  const from = returnPath(`${pathname}${search}`);
  if (from) page.searchParams.set("od", from);
  // Never kept by a browser or a cache: the same address must lead on once the day has come.
  return NextResponse.redirect(page, {
    status: 307,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export const config = {
  // Pages only: never the interfaces under /api, the framework's own files, or a file with an
  // extension (icons, fonts, the manifest, the service worker).
  matcher: ["/((?!api/|_next/|[^?]*\\.[^/?]+$).*)"],
};
