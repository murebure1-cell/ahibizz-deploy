import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  output = path.join(root, "artifacts", "business-ownership-ui-fixture");
await mkdir(output, { recursive: true });
const store = path.join(root, "node_modules", ".pnpm"),
  folder = (await readdir(store)).find((name) => /^esbuild@\d/.test(name));
if (!folder) throw new Error("Use existing pinned dependencies only.");
const esbuild = createRequire(import.meta.url)(
  path.join(store, folder, "node_modules", "esbuild", "lib", "main.js"),
);
await writeFile(
  path.join(output, "entry.jsx"),
  `import React from 'react';import {createRoot} from 'react-dom/client';import '../../src/app/globals.css';import {BusinessOwnershipFixture} from '../../tests/fixtures/BusinessOwnershipFixture';window.fetch=async()=>{throw Error('Fixture forbids actual API network')};createRoot(document.getElementById('root')).render(<BusinessOwnershipFixture/>);`,
);
const result = await esbuild.build({
  entryPoints: [path.join(output, "entry.jsx")],
  outfile: path.join(output, "bundle.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  metafile: true,
  logLevel: "warning",
});
const inputs = Object.keys(result.metafile.inputs).filter((name) => /^(src|tests)[\\/]/.test(name));
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
const html = `<!doctype html><html lang="bs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Izolirana provjera dodjele vlasnika</title><link rel="stylesheet" href="/bundle.css"><style>.fixtureControls{padding:20px;background:var(--ui-accent-soft);color:var(--ui-text)}.fixtureControls h1{font-size:22px}.fixtureControls>div{display:flex;flex-wrap:wrap;gap:6px}.fixtureControls button{padding:9px;border:1px solid var(--ui-border);border-radius:8px;background:var(--ui-surface);color:var(--ui-text);font:inherit;font-size:12px}.fixtureControls pre{max-height:180px;overflow:auto;font-size:11px}#ownership-private-area{max-width:900px;margin:30px auto;padding:0 18px;min-width:0}</style></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>`;
if (process.argv.includes("--build-only")) {
  process.stdout.write("Built actual-source ownership fixture.\n");
  process.exit(0);
}
createServer(async (req, res) => {
  try {
    const file =
      req.url === "/bundle.js" ? "bundle.js" : req.url === "/bundle.css" ? "bundle.css" : null;
    if (req.url !== "/" && !file) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": file
        ? file.endsWith(".css")
          ? "text/css"
          : "text/javascript"
        : "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; object-src 'none'",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(file ? await readFile(path.join(output, file)) : html);
  } catch {
    res.writeHead(500);
    res.end("Fixture unavailable");
  }
}).listen(4473, "127.0.0.1", () =>
  process.stdout.write("Actual-source isolated ownership: http://127.0.0.1:4473/\n"),
);
