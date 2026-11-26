// Opens key pages on a running production server and fails on any render error.
// Usage: node scripts/smoke-routes.mjs http://127.0.0.1:3099 [before-opening]
// Without the second word the server must be open (AHIBIZZ_OPENING_AT=off). With it the server
// must have an opening day ahead, and a guest must be shown "Uskoro otvaramo" instead.
const base = process.argv[2];
const mode = process.argv[3] ?? "open";
if (
  !base ||
  !/^http:\/\/127\.0\.0\.1:\d+$/.test(base) ||
  !["open", "before-opening"].includes(mode)
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
// Before the opening a guest still reaches these; every other public page shows the countdown.
const openBeforeOpening = ["/prijava", "/registracija", "/privatnost", "/pravila-zajednice"];
const countdown = /role="timer"/;

const failures = [];
async function open(path, headers = {}) {
  const response = await fetch(base + path, {
    redirect: "manual",
    headers: { Accept: "text/html", Host: new URL(base).host, ...headers },
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

for (const path of publicPages) {
  const body = await rendered(path);
  if (!body) continue;
  const veiled = countdown.test(body);
  if (mode === "open" && veiled) failures.push(`${path}: shows the countdown on an open server`);
  if (mode === "before-opening" && veiled === openBeforeOpening.includes(path))
    failures.push(
      veiled ? `${path}: must stay reachable before the opening` : `${path}: countdown missing`,
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
} else {
  // A session cookie lifts the curtain; whether the session is real is the page's own check.
  const body = await rendered("/pretraga", { Cookie: "better-auth.session_token=smoke" });
  if (countdown.test(body)) failures.push("/pretraga: countdown shown despite a session cookie");
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(
  mode === "open"
    ? `Route smoke passed: ${publicPages.length} public, ${privatePages.length} private and ${retiredPages.length} retired pages.`
    : `Route smoke before the opening passed: ${publicPages.length} public and ${privatePages.length} private pages.`,
);
