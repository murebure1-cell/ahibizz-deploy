import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Local-only actual component fixture. No environment, database, credentials or production fetch.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "artifacts", "business-import-ui-fixture");
await mkdir(output, { recursive: true });
const store = path.join(root, "node_modules", ".pnpm");
const esbuildFolder = (await readdir(store)).find((name) => /^esbuild@\d/.test(name));
if (!esbuildFolder) throw new Error("Use the existing project dependencies; do not install.");
const require = createRequire(import.meta.url);
const esbuild = require(
  path.join(store, esbuildFolder, "node_modules", "esbuild", "lib", "main.js"),
);
const entry = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BusinessImport} from '../../src/components/admin/BusinessImport';
import {browserImportLock} from '../../src/lib/business-import-lock';
import {ImportMemoryApi,ImportMemoryStorage,fixtureActor,importFixtureData,secondSource,encodeFixture} from '../../tests/fixtures/business-import-memory';
window.fetch=async()=>{throw Error('Fixture forbids network API calls')};
const storage=new ImportMemoryStorage();let api=new ImportMemoryApi();
const first=await importFixtureData({logo:true}),second=await importFixtureData({sourceId:secondSource,title:'Druga probna djelatnost'});
const source={...first,records:[...first.records,...second.records]},bytes=encodeFixture(source);
function App(){const[key,setKey]=useState(0),[state,setState]=useState('');
const factory=()=>api;
const update=()=>setState(JSON.stringify({requests:api.calls.map(c=>c.kind),records:[...api.rows.values()].map(r=>({title:r.title,status:r.status,version:r.version})),journal:[...storage.values.values()].map(v=>JSON.parse(v))},null,2));
const lock=async(actor,signal,action)=>{try{await browserImportLock(actor,signal,action)}finally{update()}};
function choose(){const input=document.getElementById('business-import-file');if(!input||input.disabled)return;const transfer=new DataTransfer();transfer.items.add(new File([bytes],'pripremljeni-probni-podaci.json',{type:'application/json'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));}
return <><aside className="fixture"><strong>IZOLIRANA PROBA — bez stvarnih podataka i mrežnih API poziva</strong><div><button onClick={choose}>Odaberi probni JSON</button><label htmlFor="fixture-lost">Izgubi sljedeći odgovor</label><select id="fixture-lost" defaultValue="" onChange={e=>{if(e.target.value==='publish-before'){const original=api.publish.bind(api);api.publish=async(id,version)=>{api.publish=original;api.calls.push({kind:'publish-before-dispatch',value:{id,version}});throw Error('isolated before-dispatch failure')}}else api.lost=e.target.value||null;update()}}><option value="">Bez greške</option><option value="create">Stvaranje</option><option value="logo">Logo</option><option value="publish">Objava</option><option value="publish-before">Objava prije slanja</option></select><button onClick={()=>setKey(k=>k+1)}>Ponovno otvori ekran</button><button onClick={()=>{api.actor={id:'other-owner',role:'owner',emailVerified:true,approval:'approved'};window.dispatchEvent(new Event('focus'));update()}}>Promijeni nalog</button><button onClick={()=>{api=new ImportMemoryApi();storage.values.clear();setKey(k=>k+1);update()}}>Resetiraj probu</button><button onClick={update}>Prikaži evidenciju</button></div><details><summary>Evidencija izolirane probe</summary><pre>{state}</pre></details></aside><BusinessImport key={key} expectedAccountId={fixtureActor} apiFactory={factory} storage={storage} lock={lock}/></>}
createRoot(document.getElementById('root')).render(<App/>);
`;
await writeFile(path.join(output, "entry.jsx"), entry);
await writeFile(
  path.join(output, "link.jsx"),
  "import React from 'react';export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}",
);
await esbuild.build({
  entryPoints: [path.join(output, "entry.jsx")],
  outfile: path.join(output, "bundle.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  alias: { "next/link": path.join(output, "link.jsx") },
  logLevel: "warning",
});
const html = `<!doctype html><html lang="bs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Izolirana proba uvoza</title><link rel="stylesheet" href="/bundle.css"><style>*{box-sizing:border-box}body{margin:0;background:#f6f8fa;color:#153347;font-family:Arial,sans-serif}a{color:inherit}button,select{font:inherit}.fixture{padding:16px;border-bottom:2px solid #d7aa42;background:#f4ecd6}.fixture>div{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-top:12px}.fixture button,.fixture select{border:1px solid #b9c7ce;border-radius:8px;padding:8px;background:white}.fixture pre{overflow:auto;max-height:200px;font-size:12px}</style></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>`;
if (process.argv.includes("--build-only")) {
  process.stdout.write("Rebuilt isolated importer fixture assets.\n");
  process.exit(0);
}
const port = Number(process.env.AHI_IMPORT_FIXTURE_PORT || 4398);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid local port");
const server = createServer(async (request, response) => {
  const name =
    request.url === "/"
      ? null
      : request.url === "/bundle.js"
        ? "bundle.js"
        : request.url === "/bundle.css"
          ? "bundle.css"
          : false;
  if (name === false) {
    response.writeHead(404);
    response.end();
    return;
  }
  try {
    response.writeHead(200, {
      "Content-Type":
        name === null
          ? "text/html; charset=utf-8"
          : name.endsWith("css")
            ? "text/css"
            : "text/javascript",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(name === null ? html : await readFile(path.join(output, name)));
  } catch {
    response.writeHead(500);
    response.end("Fixture build unavailable");
  }
});
server.listen(port, "127.0.0.1", () =>
  process.stdout.write(`Isolated importer component: http://127.0.0.1:${port}/\n`),
);
