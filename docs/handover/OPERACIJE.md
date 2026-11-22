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

Nazivi i namjene su u inventuri; `.env.example` je primjer, a ne skup produkcijskih vrijednosti. Inventura je početni snapshot i uključuje imena uklonjenih probnih adaptera; ti adapteri više nemaju rutu. Preostale PayPal postavke mogu biti potrebne historijskim ugovorima, webhookovima i povratima. Ne uklanjati ih prema pretpostavci o živoj konfiguraciji.

Docker runtime postavlja `AHIBIZZ_PLATFORM_CREDITS_ONLY=true`; operatorsko nadjačavanje nije provjereno. Nove komercijalne dopune koriste zasebnu potvrđenu bankovnu konfiguraciju. `AHIBIZZ_CREDIT_BANK_TRANSFER` se ne zamjenjuje podacima za dobrovoljnu podršku. Administrator potvrđuje dopunu nakon provjere izvoda; korisnički zahtjev nije potvrda prijema novca.

## Ingress i granica povjerenja

Kod: `scripts/ingress-policy.mjs`, `ingress-evidence.mjs`, `ingress-forwarder.mjs`, `ingress-start.mjs`, `ingress-observe.mjs` i `src/server/auth/ingress.ts`. Ovi fajlovi su aktivni dijelovi startup/auth toka, pa nisu izbrisani kao QA ostaci.

`AHIBIZZ_INGRESS_ENFORCE=true` i povjerenje adresi klijenta su odvojene kontrole. Guard zahtijeva različite javni `PORT` i `AHIBIZZ_NEXT_INTERNAL_PORT`, HTTPS `BETTER_AUTH_URL`, tačne privatne/loopback peer adrese bez CIDR-a, `AHIBIZZ_INGRESS_BOUNDARY_PROOF` i `AHIBIZZ_INGRESS_BOUNDARY_SHA256`. Sintetični testni dokaz se ne smije koristiti u produkciji.

Dokaz schema 2 veže `appId`, origin, `operatorReviewed`, reviziju observera i deploymenta, originalni log i devet kontrolisanih GET health zahtjeva. Validator traži šest canonical i tri direktna opažanja, različit direktni javni peer, stabilan canonical peer i odgovarajući fingerprint. Canonical i direktni put s istim gateway peerom ne zadovoljavaju granicu. Hash veže bajtove operaterskog dokaza; sam nije potpis providera niti nezavisna potvrda mrežnog ACL-a.

`AHIBIZZ_INGRESS_TRUST_CLIENT_IP=true` dodatno traži zasebnu pregledanu `app_specific_network_acl` potvrdu u `AHIBIZZ_INGRESS_TRUST_ATTESTATION` i njen SHA-256. Mora se odnositi na app 213, isti origin, peers i boundary hash. Opći DPA ili druge aplikacije nisu dokaz. Bez ovog povjerenja Better Auth ne vjeruje proxy IP headerima. Stanje i valjanost produkcijskog dokaza treba ponovo potvrditi pri promjeni mreže; ovo čišćenje ih nije provjerilo.

Guard veže privatni Next proces na loopback. Javni parent provjerava peer, sintaksu Host/X-Real-IP i gradi canonical transport headere iz konfiguracije. `Origin`/`Referer` ostaju originalni radi CSRF provjere; caller `Forwarded`, `X-Forwarded-*`, privatni ingress i hop-by-hop headeri se uklanjaju. Cookies, tijelo i `X-AhiBizz-Account-ID` i dalje podliježu aplikacijskim provjerama. GET health bez queryja ima poseban loopback izuzetak. WebSocket/CONNECT/TRACE nisu podržani. Granica tijela transporta ne ukida strožije granice pojedinih upload tokova.

`AHIBIZZ_INGRESS_OBSERVE=true` uključuje ograničeno opažanje tačnog `GET /api/health/live?ingressProbe=<UUID>`. Uz guard se učitava u parentu, bez guarda u server djetetu; nikad u migraciji. Bilježi najviše 24 događaja u minuti i 96 u procesu. Ne loguje cookies, tokene ni tijela; javne IP vrijednosti pretvara u hash vezan za nonce. Opažanje ne uključuje povjerenje i ne mijenja ovlasti. U produkciji ga uključuje operater samo za određenu provjeru.

## Kontrolna lista izdanja

1. Fetch i pregled worktreeova/PR-ova; potvrdi tačan integration commit i jednog objavljivača.
2. Pregled diff-a, tajni i finansijskih pravila; cijene/kurs/ugovore mijenja vlasnik odlukom.
3. `pnpm check`, odgovarajući izolirani PostgreSQL scenariji i CI. Posebno potvrdi oba web/Play builda ako se izdaju oba.
4. Napravi i provjeri svjež backup aplikacije/baze prije objave. Sačuvaj identifikator i datum izvan Git-a.
5. Prenesi pregledanu reviziju kroz `ahibizz-deploy` na OctaDeploy app 213; zapiši hash i image identitet.
6. Potvrdi stvarno objavljenu reviziju, live i ready; zatim browser matricu iz `PROVJERA.md` kao gost, korisnik, vlasnik djelatnosti i administrator.
7. Posebno zabilježi testove stvarnih poslovnih transakcija ako su odobreni. Ne poistovjećuj lokalni test, klik i bankovnu/PayPal potvrdu.
8. Ako provjere ne prođu, vrati prethodnu pregledanu verziju prema operatorskom planu. Ne vraćaj bazu napamet niti prepisuj historiju uplata.

SIGTERM/SIGINT zatvaraju prihvat, dozvoljavaju ograničeno pražnjenje aktivnih zahtjeva i gase dijete. Neuspješan child zatvara listener; poslovne mutacije se ne ponavljaju automatski.
