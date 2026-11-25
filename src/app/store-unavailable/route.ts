const document = `<!doctype html>
<html lang="bs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f2f4f6" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#0b0d10" media="(prefers-color-scheme: dark)"><title>Stranica nije dostupna | AhiBizz</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f2f4f6;color:#0e1218;font:16px/1.6 system-ui,sans-serif}main{width:min(400px,calc(100% - 64px));padding:32px}h1{font-size:28px;line-height:1.2}p{color:#5b6470}a{color:#0b6459;font-weight:700}nav{display:flex;gap:24px;margin-top:24px}@media (prefers-color-scheme:dark){body{background:#0b0d10;color:#f3f5f7}p{color:#a7afba}a{color:#8eebc3}}</style></head><body><main id="glavni-sadrzaj"><a href="/" aria-label="AhiBizz početna">AhiBizz</a><h1>Stranica nije dostupna.</h1><p>Ova stranica nije dostupna u aplikaciji. Možeš nastaviti na početnoj ili potražiti pomoć.</p><nav aria-label="Nastavi"><a href="/">Početna</a><a href="/pomoc">Pomoć</a></nav></main></body></html>`;

function unavailable(request: Request) {
  const url = new URL(request.url);
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex",
    Vary: "Accept, RSC, Next-Router-State-Tree, Next-Router-Prefetch",
  });
  const html =
    ["GET", "HEAD"].includes(request.method) &&
    !url.pathname.startsWith("/api/") &&
    request.headers.get("accept")?.includes("text/html") &&
    !request.headers.get("RSC") &&
    !request.headers.get("Next-Router-State-Tree") &&
    !request.headers.get("Next-Router-Prefetch") &&
    !url.searchParams.has("_rsc");
  headers.set("Content-Type", html ? "text/html; charset=utf-8" : "application/json");
  return new Response(
    request.method === "HEAD" ? null : html ? document : JSON.stringify({ error: "NOT_FOUND" }),
    { status: 404, headers },
  );
}

export {
  unavailable as GET,
  unavailable as POST,
  unavailable as PUT,
  unavailable as PATCH,
  unavailable as DELETE,
  unavailable as HEAD,
};
