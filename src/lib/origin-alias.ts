/**
 * The hosting gateway replaces the Host header before the application sees it, so the server cannot
 * tell that a visitor typed the `www.` name. Sign-in only works on the configured address, so the
 * page corrects that one alias itself, before anything renders.
 *
 * Returns the inline script, or null unless the configured origin is a plain https host that can be
 * embedded without escaping.
 */
export function wwwAliasBootstrap(origin: string | null | undefined): string | null {
  if (!origin) return null;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.port || url.pathname !== "/" || url.search || url.hash)
    return null;
  const host = url.hostname;
  if (
    origin !== `https://${host}` ||
    host.startsWith("www.") ||
    !host.includes(".") ||
    !/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(host)
  )
    return null;
  const alias = JSON.stringify(`www.${host}`);
  const target = JSON.stringify(`https://${host}`);
  return `(()=>{try{if(location.hostname===${alias})location.replace(${target}+location.pathname+location.search+location.hash)}catch{}})();`;
}
