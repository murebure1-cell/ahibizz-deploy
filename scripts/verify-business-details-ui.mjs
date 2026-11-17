import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Actual-source UI, local memory only. No credentials, production API or database.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "artifacts", "business-details-ui-fixture");
await mkdir(output, { recursive: true });
const store = path.join(root, "node_modules", ".pnpm");
const folder = (await readdir(store)).find((name) => /^esbuild@\d/.test(name));
if (!folder) throw new Error("Use existing pinned dependencies.");
const esbuild = createRequire(import.meta.url)(
  path.join(store, folder, "node_modules", "esbuild", "lib", "main.js"),
);
const entry = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import '../../src/app/globals.css';
import {BusinessDetailsManager} from '../../src/components/directory/BusinessDetailsManager';
import {DirectoryResultCard} from '../../src/components/directory/DirectoryResultCard';
import {PublicBusinessProfile} from '../../src/components/directory/PublicBusinessProfile';
import {DirectoryRequestError} from '../../src/lib/directory-create-submission';
import {readBusinessDetails} from '../../src/lib/business-details';
window.fetch=async()=>{throw Error('Fixture forbids network API calls')};
const id='44adf74e-cc83-43cc-b32d-1437845d86cb';let role='owner',lost=false,requestLog=[];
const initial={id,title:'Poslovni studio',version:1,status:'published',details:null,categoryName:'Usluge',subcategoryName:null,description:'Prostor za vaš posao, sastanke i nove ideje.',city:'Tuzla',addressLine:null,countryCode:'BA',latitude:null,longitude:null,verified:false,contactPhone:null,contactEmail:null,websiteUrl:null,image:{src:'/api/business-media/public/'+id+'/cover/0?v=1',alt:'Izolirana probna naslovnica'}};
let row=structuredClone(initial);
const request=async(businessId,accountId,options={})=>{requestLog.push({method:options.method||'GET',version:row.version,accountId});if(accountId!=='fixture-owner')throw new DirectoryRequestError('ACCOUNT_IDENTITY_CHANGED',401);if(options.method==='PUT'){const body=JSON.parse(options.body);if(body.expectedVersion!==row.version)throw new DirectoryRequestError('VERSION_CONFLICT',409);row={...row,version:row.version+1,status:role==='owner'?'published':'pending',details:readBusinessDetails(body.details)};if(lost){lost=false;throw Error('isolated lost response')}}return structuredClone(row)};
function App(){const[preview,setPreview]=useState(row),[key,setKey]=useState(0),[status,setStatus]=useState(''),[mode,setMode]=useState('all');const changed=r=>{setPreview(r);setStatus(r.status+' · verzija '+r.version)};return <><aside className="fixture"><strong>IZOLIRANA PROBA — stvarne komponente, lokalni podaci</strong><div><button onClick={()=>setMode('all')}>Sve</button><button onClick={()=>setMode('editor')}>Uređivanje</button><button onClick={()=>setMode('public')}>Javni profil</button><button onClick={()=>{role=role==='owner'?'member':'owner';setStatus('Uloga: '+role)}}>Promijeni admin/vlasnik</button><button onClick={()=>{lost=true;setStatus('Sljedeći odgovor nakon snimanja bit će izgubljen')}}>Izgubi odgovor</button><button onClick={()=>{row={...row,version:row.version+1};setStatus('Paralelna izmjena druge kartice')}}>Paralelna izmjena</button><button onClick={()=>{row=structuredClone(initial);requestLog=[];lost=false;role='owner';setPreview(row);setKey(k=>k+1);setStatus('Resetirano')}}>Reset</button><button onClick={()=>{const form=document.querySelector('form[aria-label="Radno vrijeme i sadržaji"]');form?.requestSubmit();form?.requestSubmit()}}>Dvostruko snimi</button><button onClick={()=>setStatus(JSON.stringify(requestLog))}>Evidencija</button></div><p role="status">{status}</p></aside><main className="fixtureMain">{mode!=='public'&&<div className="fixtureSplit"><BusinessDetailsManager key={key} businessId={id} businessTitle={row.title} active expectedAccountId="fixture-owner" request={request} onChanged={changed} onAccessDenied={()=>false} onBack={()=>setMode('public')}/><div className="fixtureCard"><DirectoryResultCard business={preview}/><p>Prikaz kartice koristi samo sačuvane podatke.</p></div></div>}{mode!=='editor'&&<PublicBusinessProfile business={preview} preview backHref={null}/>}</main></>};createRoot(document.getElementById('root')).render(<App/>);
`;
await writeFile(path.join(output, "entry.jsx"), entry);
await writeFile(
  path.join(output, "link.jsx"),
  "import React from 'react';export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}",
);
await writeFile(
  path.join(output, "image.jsx"),
  "import React from 'react';export default function Image({fill,unoptimized,sizes,priority,style,...props}){return <img {...props} style={fill?{position:'absolute',height:'100%',width:'100%',inset:0,objectFit:'cover',...style}:style}/>}",
);
await esbuild.build({
  entryPoints: [path.join(output, "entry.jsx")],
  outfile: path.join(output, "bundle.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  loader: { ".png": "dataurl" },
  alias: {
    "next/link": path.join(output, "link.jsx"),
    "next/image": path.join(output, "image.jsx"),
  },
  logLevel: "warning",
});
const html = `<!doctype html><html lang="bs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Izolirana proba radnog vremena</title><link rel="stylesheet" href="/bundle.css"><style>.fixture{padding:16px;background:#f3ead6;border-bottom:1px solid #c8a254}.fixture>div{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.fixture button{padding:8px;border:1px solid #b5c4cf;border-radius:8px;background:#fff;font:inherit;font-size:12px}.fixture p{overflow-wrap:anywhere}.fixtureMain{max-width:1180px;margin:30px auto;padding:0 18px;display:grid;gap:35px}.fixtureSplit{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:25px;align-items:start}.fixtureCard{position:sticky;top:20px}.fixtureCard>p{font-size:12px;color:#62717b;margin-top:15px}@media(max-width:760px){.fixtureSplit{grid-template-columns:1fr}.fixtureCard{position:static}}</style></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>`;
if (process.argv.includes("--build-only")) {
  process.stdout.write("Rebuilt actual-source details fixture.\n");
  process.exit(0);
}
const publicFiles = new Map([
  ["/bundle.js", [path.join(output, "bundle.js"), "text/javascript"]],
  ["/bundle.css", [path.join(output, "bundle.css"), "text/css"]],
  [
    "/brand/ahi-logo-white.svg",
    [path.join(root, "public", "brand", "ahi-logo-white.svg"), "image/svg+xml"],
  ],
  [
    "/api/business-media/public/44adf74e-cc83-43cc-b32d-1437845d86cb/cover/0?v=1",
    [path.join(root, "public", "preview", "studio.webp"), "image/webp"],
  ],
]);
createServer(async (request, response) => {
  try {
    const file = publicFiles.get(request.url);
    if (request.url !== "/" && !file) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": file?.[1] ?? "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(file ? await readFile(file[0]) : html);
  } catch {
    response.writeHead(500);
    response.end("Fixture unavailable");
  }
}).listen(4464, "127.0.0.1", () =>
  process.stdout.write("Actual-source isolated details: http://127.0.0.1:4464/\n"),
);
