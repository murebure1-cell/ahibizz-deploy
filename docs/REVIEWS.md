# Recenzije djelatnosti

Recenziju može objaviti email-potvrđen, odobren nalog za objavljenu djelatnost
čiji je vlasnik također odobren i email-potvrđen. Vlasnik ne može ocijeniti svoju
djelatnost, bez obzira na administratorsku ulogu. Jedna trajna recenzija po nalogu
i djelatnosti može se izmijeniti, povući i ponovo objaviti uz provjeru verzije.
Ocjena je cijeli broj 1–5, a obični tekst je obavezan, najviše 2000 znakova.

Privatan lični profil prikazuje se kao „Korisnik AhiBizza“, bez imena, fotografije,
identifikatora osobe ili linka na profil. Javni identitet prikazuje se samo uz
aktivan javni lični profil i važeći odobren nalog. Email i datum rođenja nisu dio
projekcije. Javno dostupna oznaka identiteta nije dokaz korištenja usluge.

Administrator može sakriti ili vratiti recenziju uz razlog, verziju i evidenciju.
Ne mijenja tuđu ocjenu. Skrivena recenzija ne može se ponovo objaviti izmjenom
autora. Autor je može povući. Vraćanje vidljivosti ne poništava povlačenje autora.
Promjena vlasništva isključuje raniju recenziju novog vlasnika iz javnog prikaza;
administratorska provjera i povlačenje i dalje su mogući. Nema API-ja za trajno
brisanje recenzija.

## Ugovor API-ja

- `GET /api/reviews/businesses/:uuid?page=1`: `ReviewPage` sa javnim stavkama,
  `page`, `hasMore` i `summary: {count, sum}`. Lista i zbir računaju se u istom
  SQL snimku. Stranica sadrži najviše 20 stavki. Nema izmišljene ocjene kad je
  `count=0`; inače je prosjek `sum/count`.
- `GET /api/reviews/businesses/:uuid/own`: privatni `accountId`, `canReview` i
  recenzija autora s verzijom, ili `null`.
- `PUT /api/reviews/businesses/:uuid/own`: `rating`, `text`, `expectedVersion`
  (0 samo za prvo kreiranje), UUID `idempotencyKey`.
- `POST /api/reviews/businesses/:uuid/withdraw`: `expectedVersion`, UUID ključ.
- `GET /api/reviews/admin?page=1`: administratorski pregled bez privatnih
  identiteta autora. Vraća `accountId`, stranice i stanje skrivanja/povlačenja.
- `POST /api/reviews/admin/:reviewUuid/moderate`: `hidden`, obavezni `reason`
  do 500 znakova, `expectedVersion`, UUID ključ.

Komande vraćaju samo `{id, version}`. Ponovljeni isti ključ i ista namjera vraćaju
istu potvrdu. Druga namjera s istim ključem i zastarjela verzija vraćaju 409.
Ovlasti i serverski rok sesije provjeravaju se nakon čekanja na zaključavanja.
Mutacije traže isti Origin i JSON. Klijenti šalju `X-AhiBizz-Account-ID`; promjena
naloga prekida komandu. Primitak komande nije potvrda da je njeno staro stanje
i dalje trenutno, zato klijent nakon komande ponovo čita recenzije.

`businessReviewsProjection('b')` iz `src/server/reviews/projection.ts` daje SQL
kolonu `reviews: {count:number, sum:number}` za već javno podobnu djelatnost.
Isključuje skrivene, povučene, nepodobne autore i autora koji je sada vlasnik.
`BusinessReviews` i `ReviewsAdmin` koriste stvarni HTTP adapter po zadanim
postavkama. `ReviewsAdmin` zahtijeva `expectedAccountId`; `active=false` prekida
učitavanje i ne šalje nove zahtjeve. Drži se u zasebnom zaštićenom admin panelu.

## Izolirane provjere

`tests/reviews*.test.ts` provjeravaju validaciju, javne projekcije, HTTP zaštite,
stvarne fetch adaptere i memorijski UI adapter. `tests/integration/business-reviews.test.mjs`
zahtijeva `CI=true` i eksplicitnu loopback bazu/korisnika `ahibizz_ci`; koristi
zasebnu nasumičnu shemu, stvarni Auth i PostgreSQL transakcije. Pokriva sukobe,
paralelne komande, opoziv sesije, moderaciju, promjenu vlasništva i zbir ocjena.
Ne izvršava se nad poslovnom bazom i ne šalje vanjske poruke.

`tests/fixtures/BusinessReviewsFixture.tsx` montira iste komponente s izoliranim
memorijskim podacima. Ta vizuelna provjera nije dokaz stvarne transakcije baze.
