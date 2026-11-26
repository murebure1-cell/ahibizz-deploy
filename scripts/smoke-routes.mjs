// Opens key pages on a running production server and fails on any render error.
// Usage: node scripts/smoke-routes.mjs http://127.0.0.1:3099 [open|before-opening] [behind-guard]
//
// "open" (the default): the server must be open (AHIBIZZ_OPENING_AT=off).
// "before-opening": the server must have an opening day ahead, and a guest must be sent to
// "Uskoro otvaramo" from the public pages.
// "behind-guard": the server stands behind the ingress guard (scripts/ingress-start.mjs), as
// the live one does. The guard hands the app a different address of itself than a bare server
// sees, so a page that works bare can still fail there. It did on 2026-11-26, which is why both
// kinds of server are opened.
const [base, mode = "open", stance = "bare"] = process.argv.slice(2);
if (
  !base ||
  !/^http:\/\/127\.0\.0\.1:\d+$/.test(base) ||
  !["open", "before-opening"].includes(mode) ||
  !["bare", "behind-guard"].includes(stance)
) {
  console.error("Pass the loopback base URL of an isolated smoke-test server.");
  process.exit(2);
}

// Public pages must render for a guest.
const publicPages = [
  "/",
  "/pretraga",
  "/mapa",
  "/reels",
  "/ljudi",
  "/blog",
  "/pomoc",
  "/o-nama",
  "/privatnost",
  "/pravila-zajednice",
  "/prijava",
  "/registracija",
];
// Account and admin pages must send a guest to sign in, never render or crash.
const privatePages = ["/nalog", "/administracija", "/sadrzaj"];
// Removed purchase pages must stay gone rather than render or crash.
const retiredPages = ["/istakni", "/oglasavanje", "/paketi"];
// Before the opening a guest still reaches these; from every other public page they are sent
// to the countdown.
const openBeforeOpening = ["/prijava", "/registracija", "/privatnost", "/pravila-zajednice"];
const countdown = /role="timer"/;
// The guard only lets through a request that names the visitor's address, as its proxy does.
const always = stance === "behind-guard" ? { "X-Real-IP": "203.0.113.9" } : {};

const failures = [];
async function open(path, headers = {}) {
  const response = await fetch(base + path, {
    redirect: "manual",
    headers: { Accept: "text/html", Host: new URL(base).host, ...always, ...headers },
    signal: AbortSignal.timeout(15000),
  });
  const body = response.status === 200 ? await response.text() : "";
  return { status: response.status, location: response.headers.get("location") ?? "", body };
}
/** A page that rendered: 200, with the main content and no error screen. Returns its text. */
async function rendered(path, headers) {
  const page = await open(path, headers);
  if (page.status !== 200) failures.push(`${path}: expected 200, got ${page.status}`);
  else if (!/id="glavni-sadrzaj"/.test(page.body)) failures.push(`${path}: main content missing`);
  else if (/Application error|Internal Server Error/i.test(page.body))
    failures.push(`${path}: error page rendered`);
  return page.body;
}
/**
 * A page that sends the visitor on to a path of this site. The path is compared whole: a full
 * address here would carry the server's own name for itself, which no browser can reach.
 */
async function leadsTo(path, expected) {
  const page = await open(path);
  if (page.status !== 307 || page.location !== expected)
    failures.push(`${path}: expected 307 to ${expected}, got ${page.status} ${page.location}`);
}

for (const path of publicPages) {
  if (mode === "before-opening" && !openBeforeOpening.includes(path)) {
    await leadsTo(path, path === "/" ? "/uskoro" : `/uskoro?od=${encodeURIComponent(path)}`);
    continue;
  }
  const body = await rendered(path);
  if (body && countdown.test(body))
    failures.push(
      mode === "open"
        ? `${path}: shows the countdown on an open server`
        : `${path}: must stay reachable before the opening`,
    );
}
for (const path of privatePages) {
  const page = await open(path);
  if (![303, 307, 308].includes(page.status) || !page.location.includes("/prijava"))
    failures.push(`${path}: expected a redirect to /prijava, got ${page.status} ${page.location}`);
}
if (mode === "open") {
  for (const path of retiredPages) {
    const page = await open(path);
    if (page.status !== 404) failures.push(`${path}: expected 404, got ${page.status}`);
  }
  // With the app open, the address of the countdown only leads on to where the visitor was
  // going, and never to another site.
  await leadsTo("/uskoro", "/");
  await leadsTo("/uskoro?od=%2Fpretraga%3Fq%3Dburek", "/pretraga?q=burek");
  await leadsTo("/uskoro?od=%2F%2Fdrugi.example%2Fput", "/");
} else {
  // What the visitor was looking for travels along, and the countdown offers it back at sign-in.
  await leadsTo("/pretraga?q=burek", "/uskoro?od=%2Fpretraga%3Fq%3Dburek");
  const page = await rendered("/uskoro?od=%2Fpretraga");
  if (page && !countdown.test(page)) failures.push("/uskoro: countdown missing");
  if (page && !page.includes('href="/prijava?nastavi=%2Fpretraga"'))
    failures.push("/uskoro: the sign-in link lost the way back");
  // A session cookie lifts the curtain; whether the session is real is the page's own check.
  const body = await rendered("/pretraga", { Cookie: "better-auth.session_token=smoke" });
  if (countdown.test(body)) failures.push("/pretraga: countdown shown despite a session cookie");
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
const where = stance === "behind-guard" ? " behind the ingress guard" : "";
console.log(
  mode === "open"
    ? `Route smoke${where} passed: ${publicPages.length} public, ${privatePages.length} private and ${retiredPages.length} retired pages.`
    : `Route smoke before the opening${where} passed: ${publicPages.length} public and ${privatePages.length} private pages.`,
);
