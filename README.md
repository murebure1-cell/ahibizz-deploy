# AhiBizz

AhiBizz povezuje ljude i lokalne djelatnosti: imenik, termini, poruke, profili, Reels, recenzije i besplatna objava djelatnosti. Administracija uređuje sadržaj i naloge.

Prvo pročitaj [AGENTS.md](AGENTS.md). Zajednička razvojna osnova je **`origin/integration/ahibizz`**, a ne privatni `main`. Za zadatak koristi zaseban worktree i jednog vlasnika; PR usmjeri u `integration/ahibizz`. Čuvaj tuđi nezavršen rad.

## Mapa za tim

| Dokument | Sadržaj |
| --- | --- |
| [Predaja i PR](docs/handover/PREDAJA.md) | Preuzimanje lokalnih commitova, ograničenja i pripremljen opis PR-a |
| [Arhitektura](docs/handover/ARHITEKTURA.md) | Moduli, tok podataka, tabele i poslovna pravila |
| [Inventura](docs/handover/INVENTURA.md) | Početni popis ruta, komponenti, kontrola, API-ja, konfiguracije i testova prije čišćenja |
| [Provjera](docs/handover/PROVJERA.md) | Šta je pregledano i testirano; šta još treba provjeriti u browseru |
| [Uklonjeno](docs/handover/OBRISANO.md) | Fajlovi uklonjeni uz dokaz da nisu potrebni |
| [Otvorene odluke](docs/handover/OTVORENE-ODLUKE.md) | Odluke vlasnika koje čišćenje ne mijenja |
| [Google Play](docs/handover/GOOGLE-PLAY.md) | TWA/Android build, potpisivanje, privatnost i objava |
| [Operacije](docs/handover/OPERACIJE.md) | Pokretanje, migracije, ingress, provjere i izdavanje verzije |
| [Izvori fotografija](docs/handover/IZVORI-SLIKA.md) | Porijeklo i prava korištenja postojećih fotografija |

## Tehnologije i struktura

Next.js 16 App Router, React 19, TypeScript 7, PostgreSQL (`pg`), Better Auth, Nodemailer, Web Push, Sharp i Leaflet. Tačne verzije su zaključane u `package.json` i `pnpm-lock.yaml`. Node mora zadovoljiti `>=24.0.0`; paket menadžer je **pnpm 12.18.0**. Dockerfile ima zasebno pinovanu Node sliku i digest.

```text
src/app/           stranice, layouti, server actions i HTTP rute
src/components/    korisnički tokovi po modulima
src/lib/           tipovi, formatiranje, klijentski transport i poslovni modeli
src/server/        provjera pristupa, servisi i pristup bazi
db/migrations/     primijenjene migracije; ne prepravljati stare fajlove
public/            PWA, ikone, offline stranica i javni resursi
scripts/           build/start, migracije, ingress, sigurnosni i operatorski alati
tests/             unit testovi i memorijske testne implementacije
tests/integration/ izolirani PostgreSQL scenariji u CI-ju
docs/handover/     važeća dokumentacija za tim
```

`(public)` u putanji foldera ne znači da je svaka stranica javna. `auth_user.role='owner'` je administrator platforme; vlasništvo djelatnosti se provjerava posebno.

## Lokalno pokretanje

```powershell
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm dev
```

Otvori `http://127.0.0.1:3000`. Za rad sa podacima tim treba zasebnu razvojnu bazu i odgovarajuću lokalnu konfiguraciju prema `.env.example` i inventuri. Bez konfiguracije privatne funkcije ostaju nedostupne. Tajne se ne verzioniraju. Ne koristi produkcijske DB/SMTP/push vrijednosti u testovima. Na ovom worktreeu PostgreSQL i Docker nisu instalirani za potrebe zadatka; integracijske provjere ostaju u CI-ju.

## Provjere i build

```powershell
pnpm check
pnpm build
# Tek za pripremljenu lokalnu razvojnu bazu:
$env:PORT = '3000'
pnpm start
```

`pnpm check` pokreće Biome, TypeScript i unit testove. `pnpm build` priprema Next standalone izlaz i kopira javne resurse. **`pnpm start` automatski pokreće migracije ako je `DATABASE_URL` postavljen.** Provjeri cilj prije pokretanja.

CI dodatno pokreće testove u izoliranom PostgreSQL-u 17, Docker build, pregled ranjivosti stvarne slike te startup/ingress smoke testove. Lokalni prolaz tipova nije potvrda tih provjera. Status ovog zadatka je u [PROVJERA.md](docs/handover/PROVJERA.md).

## Izdavanje verzije

Put je `integration/ahibizz` → privatni mirror `murebure1-cell/ahibizz-deploy` → **OctaDeploy app 213**. Prije izričito odobrene objave odredi jednog objavljivača, potvrdi pregledanu reviziju i zabilježi svjež backup. Nakon objave provjeri reviziju, health, browser i potrebne poslovne tokove. Ovaj zadatak nije pushao niti objavio promjene.

Google Play koristi zaseban build `AHIBIZZ_DISTRIBUTION=google-play`; runtime promjena varijable ne pretvara postojeći web build u Play izdanje. APK/AAB, potpisivanje, assetlinks i provjere izdanja ostaju dio postupka iz [GOOGLE-PLAY.md](docs/handover/GOOGLE-PLAY.md).
