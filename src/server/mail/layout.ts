import { supportEmail } from "../../lib/support-requests";

export const emailLogoCid = "ahibizz-wordmark@ahibizz.com";

type EmailCopy = {
  subject: string;
  title: string;
  intro: string;
  actionLabel: string;
  url: string;
  note?: string;
  details?: ReadonlyArray<{ label: string; value: string }>;
};

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderAhiEmail({
  subject,
  title,
  intro,
  actionLabel,
  url,
  note,
  details = [],
}: EmailCopy) {
  const target = new URL(url);
  if (!["https:", "http:"].includes(target.protocol) || target.username || target.password) {
    throw new Error("Invalid email action URL");
  }
  const home = escapeHtml(target.origin);
  const detailRows = details
    .map(
      ({ label, value }) =>
        `<tr><td class="secondary" style="padding:8px 8px 8px 0;vertical-align:top;width:38%;font-size:14px;line-height:21px;color:#485b6b;overflow-wrap:anywhere">${escapeHtml(label)}</td><td class="copy" style="padding:8px 0;vertical-align:top;font-size:14px;line-height:21px;color:#182d40;font-weight:bold;overflow-wrap:anywhere">${escapeHtml(value)}</td></tr>`,
    )
    .join("");
  const text = [
    intro,
    ...details.map(({ label, value }) => `${label}: ${value}`),
    url,
    note,
    `AhiBizz podrška · ${supportEmail}\n${target.origin}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const html = `<!doctype html>
<html lang="bs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(subject)}</title>
<style>
  :root {color-scheme:light dark;supported-color-schemes:light dark}
  @media screen and (max-width:480px) {.outer{padding:16px 8px!important}.body-cell,.brand-cell,.footer-cell{padding-left:20px!important;padding-right:20px!important}.headline{font-size:26px!important;line-height:32px!important}}
  @media (prefers-color-scheme:dark) {.canvas{background-color:#101d29!important}.paper{background-color:#192d3d!important}.footer{background-color:#152735!important}.edge{border-color:#405361!important}.headline,.copy,.contact{color:#f4f7fa!important}.secondary{color:#c6d2dc!important}.cta{background-color:#edbd64!important;color:#15283b!important}}
</style></head>
<body class="canvas" style="margin:0;padding:0;background-color:#f0f3f5;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" class="canvas" width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="#f0f3f5" style="background-color:#f0f3f5"><tr><td class="outer" align="center" style="padding:32px 12px">
<!--[if mso]><table role="presentation" width="552" cellspacing="0" cellpadding="0"><tr><td><![endif]-->
<table role="presentation" class="paper edge" width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="#ffffff" style="width:100%;max-width:552px;border:1px solid #d1dbe2;border-radius:16px;background-color:#ffffff;table-layout:fixed">
<tr><td class="brand-cell" bgcolor="#14283c" style="padding:22px 32px;background-color:#14283c;border-radius:15px 15px 0 0;border-bottom:3px solid #d8a94e">
<img src="cid:${emailLogoCid}" width="147" height="40" alt="AhiBizz" style="display:block;width:147px;height:40px;border:0;color:#ffffff;font:bold 25px Arial,sans-serif">
</td></tr>
<tr><td class="body-cell" style="padding:30px 32px 32px">
<h1 class="headline" style="margin:0 0 16px;color:#14283c;font:700 30px/36px Arial,Helvetica,sans-serif;letter-spacing:-.6px;overflow-wrap:anywhere">${escapeHtml(title)}</h1>
<p class="copy" style="margin:0;color:#263d50;font:16px/25px Arial,Helvetica,sans-serif;overflow-wrap:anywhere">${escapeHtml(intro)}</p>
${detailRows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;margin-top:14px">${detailRows}</table>` : ""}
<table role="presentation" border="0" cellspacing="0" cellpadding="0"><tr><td style="padding-top:22px"><table role="presentation" cellspacing="0" cellpadding="0"><tr>
<td class="cta" align="center" bgcolor="#edbd64" style="background-color:#edbd64;border-radius:10px;mso-padding-alt:14px 22px">
<a class="cta" href="${escapeHtml(target.href)}" style="display:inline-block;padding:14px 22px;color:#15283b;background-color:#edbd64;border-radius:10px;font:bold 16px/20px Arial,Helvetica,sans-serif;text-decoration:none;mso-padding-alt:0">${escapeHtml(actionLabel)}</a>
</td></tr></table></td></tr></table>
${note ? `<p class="secondary" style="margin:22px 0 0;color:#526574;font:14px/21px Arial,Helvetica,sans-serif;overflow-wrap:anywhere">${escapeHtml(note)}</p>` : ""}
</td></tr>
<tr><td class="footer footer-cell edge" bgcolor="#f5f7f8" style="padding:19px 32px;background-color:#f5f7f8;border-top:1px solid #d1dbe2;border-radius:0 0 15px 15px">
<p class="copy" style="margin:0 0 4px;color:#263d50;font:bold 14px/21px Arial,Helvetica,sans-serif">AhiBizz podrška</p>
<a class="contact" style="font:14px/23px Arial,Helvetica,sans-serif;color:#244f70;text-decoration:underline;display:inline-block;margin-right:14px" href="mailto:${supportEmail}">${supportEmail}</a>
<a class="contact" href="${home}/" style="font:14px/23px Arial,Helvetica,sans-serif;color:#244f70;text-decoration:underline;display:inline-block;white-space:nowrap">AhiBizz na webu</a>
</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
  return { subject, text, html };
}
