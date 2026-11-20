import { emailLogoCid } from "./layout";

/** For server-rendered catalogue examples only. The original message remains deliverable. */
export function emailPreviewDocument(html: string, appOrigin: string): string {
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' ${appOrigin}/brand/email-wordmark.png; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">`;
  return html
    .replace("<head>", `<head>${policy}`)
    .replaceAll(`src="cid:${emailLogoCid}"`, 'src="/brand/email-wordmark.png"')
    .replace(/(<a\b[^>]*?)\s+href="[^"]*"/gi, "$1");
}
