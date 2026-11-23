// Opens key pages on a running production server and fails on any render error.
// Usage: node scripts/smoke-routes.mjs http://127.0.0.1:3099
const base = process.argv[2];
if (!base || !/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) {
  console.error("Pass the loopback base URL of an isolated smoke-test server.");
  process.exit(2);
}

// Public pages must render for a guest.
const publicPages = [
  "/",
  "/pretraga",
  "/istakni",
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
const privatePages = ["/nalog", "/nalog/isticanja", "/administracija", "/administracija/isticanja"];
// Retired purchase pages lead to the promotions page.
const retiredPages = ["/oglasavanje", "/paketi"];

const failures = [];
async function open(path) {
  const response = await fetch(base + path, {
    redirect: "manual",
    headers: { Accept: "text/html", Host: new URL(base).host },
    signal: AbortSignal.timeout(15000),
  });
  const body = response.status === 200 ? await response.text() : "";
  return { status: response.status, location: response.headers.get("location") ?? "", body };
}

for (const path of publicPages) {
  const page = await open(path);
  if (page.status !== 200) failures.push(`${path}: expected 200, got ${page.status}`);
  else if (!/id="glavni-sadrzaj"/.test(page.body)) failures.push(`${path}: main content missing`);
  else if (/Application error|Internal Server Error/i.test(page.body))
    failures.push(`${path}: error page rendered`);
}
for (const path of privatePages) {
  const page = await open(path);
  if (![303, 307, 308].includes(page.status) || !page.location.includes("/prijava"))
    failures.push(`${path}: expected a redirect to /prijava, got ${page.status} ${page.location}`);
}
for (const path of retiredPages) {
  const page = await open(path);
  if (![303, 307, 308].includes(page.status) || !page.location.includes("/istakni"))
    failures.push(`${path}: expected a redirect to /istakni, got ${page.status} ${page.location}`);
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(
  `Route smoke passed: ${publicPages.length} public, ${privatePages.length} private and ${retiredPages.length} retired pages.`,
);
