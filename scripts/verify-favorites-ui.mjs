import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  output = path.join(root, "artifacts", "favorites-ui-fixture");
await mkdir(output, { recursive: true });
const store = path.join(root, "node_modules", ".pnpm"),
  folder = (await readdir(store)).find((name) => /^esbuild@\d/.test(name));
if (!folder) throw new Error("Use existing pinned dependencies only.");
const esbuild = createRequire(import.meta.url)(
  path.join(store, folder, "node_modules", "esbuild", "lib", "main.js"),
);
await writeFile(
  path.join(output, "entry.jsx"),
  `import React from 'react';import {createRoot} from 'react-dom/client';import '../../src/app/globals.css';import {FavoritesFixture} from '../../tests/fixtures/FavoritesFixture';window.fetch=async()=>{throw Error('Fixture forbids actual API network')};createRoot(document.getElementById('root')).render(<FavoritesFixture/>);`,
);
await writeFile(
  path.join(output, "link.jsx"),
  "import React from 'react';export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}",
);
await writeFile(
  path.join(output, "image.jsx"),
  "import React from 'react';export default function Image({fill,unoptimized,sizes,priority,style,...props}){return <img {...props} style={fill?{position:'absolute',height:'100%',width:'100%',inset:0,objectFit:'cover',...style}:style}/>} ",
);
const built = await esbuild.build({
  entryPoints: [path.join(output, "entry.jsx")],
  outfile: path.join(output, "bundle.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  metafile: true,
  alias: {
    "next/link": path.join(output, "link.jsx"),
    "next/image": path.join(output, "image.jsx"),
  },
  logLevel: "warning",
});
const inputs = Object.keys(built.metafile.inputs).filter((name) => /^(src|tests)[\\/]/.test(name));
await writeFile(
  path.join(output, "SOURCES.json"),
  JSON.stringify(
    {
      builtUtc: new Date().toISOString(),
      files: await Promise.all(
        inputs.map(async (name) => ({
          file: name,
          sha256: createHash("sha256")
            .update(await readFile(path.join(root, name)))
            .digest("hex"),
        })),
      ),
      jsSha256: createHash("sha256")
        .update(await readFile(path.join(output, "bundle.js")))
        .digest("hex"),
    },
    null,
    2,
  ),
);
const html = `<!doctype html><html lang="bs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Izolirana proba sačuvanih profila</title><link rel="stylesheet" href="/bundle.css"><style>.fixtureControls{padding:20px;background:var(--ui-accent-soft);color:var(--ui-text)}.fixtureControls h1{font-size:22px}.fixtureControls>div{display:flex;flex-wrap:wrap;gap:6px}.fixtureControls button{padding:9px;border:1px solid var(--ui-border);border-radius:8px;background:var(--ui-surface);color:var(--ui-text);font:inherit;font-size:12px}.fixtureControls pre{max-height:180px;overflow:auto;font-size:11px}.fixtureMain{max-width:1000px;margin:30px auto;padding:0 18px}.fixtureGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}.fixtureProfileAction{margin:25px 0;padding:25px;background:var(--ui-surface);border-radius:18px}@media(max-width:700px){.fixtureGrid{grid-template-columns:minmax(0,1fr)}}</style></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>`;
if (process.argv.includes("--build-only")) {
  process.stdout.write("Built actual-source favorites fixture.\n");
  process.exit(0);
}
const files = new Map([
  ["/bundle.js", [path.join(output, "bundle.js"), "text/javascript"]],
  ["/bundle.css", [path.join(output, "bundle.css"), "text/css"]],
  [
    "/brand/ahi-logo-white.svg",
    [path.join(root, "public", "brand", "ahi-logo-white.svg"), "image/svg+xml"],
  ],
  ...[
    "00000000-0000-4000-8000-000000000111",
    "00000000-0000-4000-8000-000000000112",
    "00000000-0000-4000-8000-000000000113",
  ].map((id) => [
    `/api/business-media/public/${id}/cover/0?v=1`,
    [path.join(root, "public", "preview", "studio.webp"), "image/webp"],
  ]),
]);
createServer(async (req, res) => {
  try {
    const file = files.get(req.url);
    if (req.url !== "/" && !file) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": file?.[1] ?? "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(file ? await readFile(file[0]) : html);
  } catch {
    res.writeHead(500);
    res.end("Fixture unavailable");
  }
}).listen(4471, "127.0.0.1", () =>
  process.stdout.write("Actual-source isolated favorites: http://127.0.0.1:4471/\n"),
);
