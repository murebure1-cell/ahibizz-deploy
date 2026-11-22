# Predaja timu

Zadatak: `codex/handover-cleanup`. Vlasnik izmjena: Codex, po nalogu vlasnika preko Claude Code. Početna lokalna revizija `755fe81` uključuje dostavljenu integraciju `9edb2f6`, ranije ispravke `93eee1f` i pravila `edbedaa`. Pri početnoj provjeri otvoren je samo PR #1 za mobilni meni. Nije napravljen novi PR niti je bilo pusha ili deploya.

## Git ograničenje ovog računara

Worktree pokazuje na zajednički Git direktorij izvan dozvoljenog prostora. Pokušaji `git fetch origin` i `git add` odbijeni su zbog pisanja `FETCH_HEAD`/`index.lock`. Zato stvarna grana u tom direktoriju nije unaprijeđena.

Fazni commitovi pripremljeni su u zasebnom privremenom Git repozitoriju, nad istim početnim commitom, i predaju se kao `handover-cleanup.bundle` i šest patch fajlova. Bundle sadrži finalno stablo; nije dokaz promjene udaljene grane. Izvorni worktree sadrži izmjene kao nezapisani diff prema početku. Nemoj ga čistiti prije poređenja i sigurnog preuzimanja.

Tim preuzima bundle u **čistom checkoutu** privatnog repozitorija koji ima `755fe81`, provjerava sadržaj i onda otvara PR prema `integration/ahibizz`:

```powershell
git bundle verify <putanja-do-handover-cleanup.bundle>
git fetch <putanja-do-handover-cleanup.bundle> refs/heads/codex/handover-cleanup
git switch -c codex/handover-review FETCH_HEAD
git log --oneline 755fe81..HEAD
git diff --stat 755fe81..HEAD
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

Ako tim umjesto toga nastavlja u postojećem radnom prostoru, prvo treba sačuvati i uporediti nezapisane izmjene; ovdje se ne preporučuje reset koji ih može izgubiti. Putanja bundlea i završni hash dostavljaju se u završnom izvještaju. Originalni zajednički Git metapodaci nisu zaobiđeni ni prepisani.

## Šta je spremno

- Inventura početnih 48 stranica, 47 handler ruta i 1.104 JSX mjesta; finalna aplikacija ima 42 stranice bez javnog demo prikaza.
- Uklonjeno 47 zastarjelih kod/QA/demo fajlova sa 7.511 redova; devet dokumenata objedinjeno u ovaj skup. Dodatno su skraćene mrtve preview i sandbox UI grane. Ikone su premještene uz iste slike.
- Popravljeni zastarjeli administratorski submit, ponavljanje zatvaranja prijave, provjere privatnih odgovora. Novi testovi prate ispravke.
- Ujednačeni tekstovi, datumi i prikaz iznosa. Kartice djelatnosti i mobilni meni nisu mijenjani; provjeren je prazan diff njihovih datoteka i zajedničkih stilova. Nisu mijenjani iznosi, ugovori, migracije ni `.env` datoteke.
- Play izdanje ima usklađenu pomoć i stranice greške, manifest, postojeće provjerene ikone, offline put i siguran predložak povezivanja. Upute za TWA, potpisivanje, Data safety i testni nalog su u [GOOGLE-PLAY.md](GOOGLE-PLAY.md).

## Šta još treba završiti

Tačne lokalne rezultate vidi u [PROVJERA.md](PROVJERA.md). Puni `pnpm check`/CI, PostgreSQL integracije, finalni build, svaki browser klik, fizički Android, potpisani APK/AAB i Play pregled ostaju zasebna provjera tima. Ne koristiti žive uplate, email ili push kao zamjenu za izolirane testove.

Odluke o naplati zamijenjene su konačnim nalogom vlasnika od 22. 11. 2026. Vidi [OTVORENE-ODLUKE.md](OTVORENE-ODLUKE.md).

## Predloženi PR

Naslov: **Prepare AhiBizz for team handover and Google Play**

```text
Target: integration/ahibizz
Owner: Codex
Branch: codex/handover-cleanup (import the supplied commits before pushing)

Removes the public preview application, unreachable Dodo/standalone sandbox
adapters and obsolete QA harnesses while preserving migration and payment history.
Consolidates team documentation, standardizes Bosnian copy/date formatting, fixes
stale support actions and unsafe account-response handling, and aligns the existing
Google Play web edition with its no-purchase behavior.

Business cards and mobile navigation are unchanged. Pricing, credit conversion,
contracts, live data, credentials and deployment configuration are unchanged.

Validation: per-phase Biome and TypeScript checks; focused regression tests and a
broader per-file Node run recorded in docs/handover/PROVJERA.md. Standard pnpm test
and the final build typecheck hit sandbox spawn EPERM. PostgreSQL CI, browser clicks,
Android signing/install and actual payment flows remain unverified.

Before release: review docs/handover/OTVORENE-ODLUKE.md, run full CI/build, complete
the browser matrix and Google Play checklist. No push or deployment was performed.
```
