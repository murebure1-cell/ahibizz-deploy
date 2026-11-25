# Operacije i izdavanje verzije

Ovaj dokument opisuje kod, ne trenutno stanje produkcijskih postavki. Live pristup i tajne nisu korišteni u čišćenju. Jedini operater objavljuje tek nakon naloga vlasnika i pregleda tačne revizije.

## Pokretanje i baza

- `pnpm dev` sluša na `127.0.0.1`; razvojni server nije produkcijski entrypoint.
- `pnpm build` pravi `.next/standalone`, a `scripts/copy-standalone-assets.mjs` kopira `public` i `.next/static`.
- `pnpm start` izvršava `scripts/start.mjs`: traži ispravan `PORT`, provjerava ingress konfiguraciju, zatim pokreće migracije ako je `DATABASE_URL` postavljen i tek onda server. Neispravna uključena zaštita prekida startup prije migracije.
- `scripts/migrate.mjs` vodi historiju/checksum migracija i koristi zaključavanje. Sve primijenjene migracije u `db/migrations` ostaju nepromijenjene. Nova promjena sheme je nova pregledana migracija; backup je preduslov produkcijske primjene.
- `GET /api/health/live` provjerava proces; `/api/health/ready` provjerava spremnost baze. Uspješan live odgovor sam ne dokazuje spremnost baze, prijave ili transakcija.
- `instrumentation.ts` u runtimeu pokreće radnike email odobrenja i push dostave; u produkcijskom buildu ih ne pokreće. Za testove koristiti memorijske transportne implementacije i izolirane postavke.

## Konfiguracija

Nazivi i namjene su u inventuri; `.env.example` je primjer, a ne skup produkcijskih vrijednosti. Tajne se ne verzioniraju. Donacije koriste zasebnu postojeću konfiguraciju.

## Ingress i granica povjerenja

Kod: `scripts/ingress-policy.mjs`, `ingress-evidence.mjs`, `ingress-forwarder.mjs`, `ingress-start.mjs`, `ingress-observe.mjs` i `src/server/auth/ingress.ts`. Ovi fajlovi su aktivni dijelovi startup/auth toka, pa nisu izbrisani kao QA ostaci.

`AHIBIZZ_INGRESS_ENFORCE=true` i povjerenje adresi klijenta su odvojene kontrole. Guard zahtijeva različite javni `PORT` i `AHIBIZZ_NEXT_INTERNAL_PORT`, HTTPS `BETTER_AUTH_URL`, tačne privatne/loopback peer adrese bez CIDR-a, `AHIBIZZ_INGRESS_BOUNDARY_PROOF` i `AHIBIZZ_INGRESS_BOUNDARY_SHA256`. Sintetični testni dokaz se ne smije koristiti u produkciji.

Dokaz schema 2 veže `appId`, origin, `operatorReviewed`, reviziju observera i deploymenta, originalni log i devet kontrolisanih GET health zahtjeva. Validator traži šest canonical i tri direktna opažanja, različit direktni javni peer, stabilan canonical peer i odgovarajući fingerprint. Canonical i direktni put s istim gateway peerom ne zadovoljavaju granicu. Hash veže bajtove operaterskog dokaza; sam nije potpis providera niti nezavisna potvrda mrežnog ACL-a.

`AHIBIZZ_INGRESS_TRUST_CLIENT_IP=true` dodatno traži zasebnu pregledanu `app_specific_network_acl` potvrdu u `AHIBIZZ_INGRESS_TRUST_ATTESTATION` i njen SHA-256. Mora se odnositi na app 213, isti origin, peers i boundary hash. Opći DPA ili druge aplikacije nisu dokaz. Bez ovog povjerenja Better Auth ne vjeruje proxy IP headerima. Stanje i valjanost produkcijskog dokaza treba ponovo potvrditi pri promjeni mreže; ovo čišćenje ih nije provjerilo.

Ograničenja po email adresi (24. 11. 2026., `src/server/auth/email-rate-limit.ts`): prijava 8 pokušaja u 15 minuta, registracija, zaboravljena lozinka i ponovno slanje potvrde po 3 na sat, za svaku adresu bez obzira na IP. Ključ u `auth_rate_limit` je HMAC adrese, nikad sama adresa. Dok `AHIBIZZ_INGRESS_TRUST_CLIENT_IP` nije uključen, Better Auth ima jedan zajednički brojač po putanji, pa produkcija (`sharedBucketCeilings`) podiže te granice na 120 prijava i po 30 ostalih zahtjeva u minuti za cijelu platformu. S pouzdanim IP-om ostaju stroge granice po posjetiocu.

Guard veže privatni Next proces na loopback. Javni parent provjerava peer, sintaksu Host/X-Real-IP i gradi canonical transport headere iz konfiguracije. `Origin`/`Referer` ostaju originalni radi CSRF provjere; caller `Forwarded`, `X-Forwarded-*`, privatni ingress i hop-by-hop headeri se uklanjaju. Cookies, tijelo i `X-AhiBizz-Account-ID` i dalje podliježu aplikacijskim provjerama. GET health bez queryja ima poseban loopback izuzetak. WebSocket/CONNECT/TRACE nisu podržani. Granica tijela transporta ne ukida strožije granice pojedinih upload tokova.

`AHIBIZZ_INGRESS_OBSERVE=true` uključuje ograničeno opažanje tačnog `GET /api/health/live?ingressProbe=<UUID>`. Uz guard se učitava u parentu, bez guarda u server djetetu; nikad u migraciji. Bilježi najviše 24 događaja u minuti i 96 u procesu. Ne loguje cookies, tokene ni tijela; javne IP vrijednosti pretvara u hash vezan za nonce. Opažanje ne uključuje povjerenje i ne mijenja ovlasti. U produkciji ga uključuje operater samo za određenu provjeru.

Gateway providera zamijeni `Host` prije nego što zahtjev stigne do guarda, pa server ne može
znati da je posjetilac upisao `www.`. Preusmjeravanje tog imena zato ne može biti u guardu:
pokušaj od 25. 11. 2026. je prošao testove, ali na produkciji nije imao učinka i vraćen je.
`www` ispravlja sama stranica, kratkom skriptom u zaglavlju koja ide na istu putanju na podešenoj
adresi (`src/lib/origin-alias.ts`). Prijava radi samo na podešenoj adresi.

### Novi dokaz granice (promjena javne adrese)

Dokaz je vezan za `BETTER_AUTH_URL`. Promjena adrese bez novog dokaza zaustavlja pokretanje, pa se
radi ovim redom. Alat je `scripts/ingress-prove.mjs`; on ne mijenja ništa na produkciji.

1. DNS i certifikat nove adrese moraju već raditi na gatewayu.
2. U postavkama: nova `BETTER_AUTH_URL`, `AHIBIZZ_INGRESS_ENFORCE=false`,
   `AHIBIZZ_INGRESS_OBSERVE=true`; Redeploy. Dok ovo traje, port aplikacije je dostupan direktno,
   bez HTTPS-a. Vlasnik mora unaprijed odobriti to gašenje.
3. `node scripts/ingress-prove.mjs probe --origin https://<adresa> --gateway-ip <IP gatewaya>
   --direct http://<IP>:<javni port> --out controlled.json`. Svih devet zahtjeva mora vratiti 200.
4. U roku od 5 minuta iz runtime loga providera prepisati devet linija `ahibizz_ingress_observe`
   s tim nonceom u `provider.log`, bajt po bajt (uporediti SHA-256 sa stranice i lokalne kopije).
5. `node scripts/ingress-prove.mjs assemble --controlled controlled.json --log provider.log
   --source-commit <commit izdanja> --manifest sha256:<otisak> --deployed <kad je izdanje postalo
   aktivno> --checked <kad je log pročitan> --internal-port <AHIBIZZ_NEXT_INTERNAL_PORT>
   --out-dir proof`. Otisak izdanja je SHA-256 izlaza `git ls-tree -r --full-tree <commit>`.
   Alat izvršava isti čitač politike kao produkcija i ne piše dokaz koji bi bio odbijen.
6. Pregledati opažanja: šest kanonskih ima isti privatni peer (`AHIBIZZ_INGRESS_PROXY_PEERS`) i
   isti otisak stvarne adrese uprkos lažnim zaglavljima; tri direktna imaju javni peer s tim
   istim otiskom.
7. U postavkama: `AHIBIZZ_INGRESS_BOUNDARY_PROOF` (sadržaj `boundary-proof.json`, jedna linija,
   bez navodnika), `AHIBIZZ_INGRESS_BOUNDARY_SHA256`, `AHIBIZZ_INGRESS_ENFORCE=true`,
   `AHIBIZZ_INGRESS_OBSERVE=false`; Redeploy.
8. Provjera: direktan port vraća 403, `/api/health/live` i `/api/health/ready` kroz gateway 200,
   prijava s nepostojećim nalogom 401, prijava sa stranim `Origin` 403.

Stanje 25. 11. 2026.: adresa je `https://ahibizz.com`, dokaz je izmjeren i uključen tog dana
(SHA-256 počinje s `1dbb09b8`, peer `172.18.0.1`, javni port 3056, interni 3057). Mjerenja su
sačuvana izvan repozitorija. Guard odbacuje dolazni `Host` i gradi jednu fiksnu adresu, pa
poddomene `admin.` i `cms.` traže izmjenu guarda, ne samo DNS.

## Paketi naloga

Paket (Basic, Startup, Business) određuje koliko djelatnosti nalog smije voditi: 1, 3 ili 10.
Nalog bez upisa u `account_package` ima Basic. Dok nema naplate, paket mijenja administrator:
`/administracija` → Nalozi → Odobreni → „Paket” uz nalog, s obaveznim razlogom. Svaka izmjena
ostaje u `account_package_decision` s prethodnim i novim paketom, administratorom i razlogom.
Izmjena se odbija ako nalog već vodi više djelatnosti nego što novi paket dozvoljava. Granica
važi i pri dodjeli vlasništva nad djelatnošću drugom nalogu i pri vraćanju iz arhive.
Administratorski nalog nema paket ni granicu. Brisanje naloga briše i njegov paket i zapise o
izmjenama. Paket ne daje značku identiteta ni Halal oznaku i ne uključuje nikakvu naplatu.

## Kontrolna lista izdanja

1. Fetch i pregled worktreeova/PR-ova; potvrdi tačan integration commit i jednog objavljivača.
2. Pregled diff-a, tajni i finansijskih pravila; poslovna pravila mijenja vlasnik odlukom.
3. `pnpm check`, odgovarajući izolirani PostgreSQL scenariji i CI. Posebno potvrdi oba web/Play builda ako se izdaju oba.
4. Napravi i provjeri svjež backup aplikacije/baze prije objave. Sačuvaj identifikator i datum izvan Git-a.
5. Prenesi pregledanu reviziju kroz `ahibizz-deploy` na OctaDeploy app 213; zapiši hash i image identitet.
6. Potvrdi stvarno objavljenu reviziju, live i ready; zatim browser matricu iz `PROVJERA.md` kao gost, korisnik, vlasnik djelatnosti i administrator.
7. Posebno zabilježi testove stvarnih poslovnih transakcija ako su odobreni. Ne poistovjećuj lokalni test, klik i potvrdu bankovne uplate.
8. Ako provjere ne prođu, vrati prethodnu pregledanu verziju prema operatorskom planu. Ne vraćaj bazu napamet niti prepisuj historiju uplata.

SIGTERM/SIGINT zatvaraju prihvat, dozvoljavaju ograničeno pražnjenje aktivnih zahtjeva i gase dijete. Neuspješan child zatvara listener; poslovne mutacije se ne ponavljaju automatski.
