# Uklonjeno iz aplikacije

Početna referenca: `755fe81`. Inventura je snimljena prije brisanja. Provjera: graf lokalnih importa, `git grep`, Next ulazne rute, package.json i CI; provjera tipova nakon uklanjanja. Broj redova je fizički broj u uklonjenim fajlovima. Ne znači broj izmijenjenih poslovnih pravila.

U ovoj fazi: **47 fajlova, 7511 redova**.

| Fajl | Razlog | Redovi |
|---|---|---:|
| `src/app/pregled/djelatnost/page.tsx` | Javne izmišljene djelatnosti uklonjene po zadatku; admin simulator ostaje. | 21 |
| `src/app/pregled/djelatnost/ProfilePreview.tsx` | Javne izmišljene djelatnosti uklonjene po zadatku; admin simulator ostaje. | 37 |
| `src/app/pregled/instaliraj/page.tsx` | Javne izmišljene djelatnosti uklonjene po zadatku; admin simulator ostaje. | 12 |
| `src/app/pregled/layout.tsx` | Javne izmišljene djelatnosti uklonjene po zadatku; admin simulator ostaje. | 28 |
| `src/app/pregled/ljudi/page.tsx` | Javne izmišljene djelatnosti uklonjene po zadatku; admin simulator ostaje. | 9 |
| `src/app/pregled/page.tsx` | Javne izmišljene djelatnosti uklonjene po zadatku; admin simulator ostaje. | 5 |
| `src/app/pregled/pretraga/page.tsx` | Javne izmišljene djelatnosti uklonjene po zadatku; admin simulator ostaje. | 146 |
| `src/app/pregled/pretraga/search.module.css` | Javne izmišljene djelatnosti uklonjene po zadatku; admin simulator ostaje. | 192 |
| `src/app/pregled/preview.css` | Javne izmišljene djelatnosti uklonjene po zadatku; admin simulator ostaje. | 679 |
| `src/app/pregled/prostor/[section]/page.tsx` | Javne izmišljene djelatnosti uklonjene po zadatku; admin simulator ostaje. | 22 |
| `src/components/preview/account.module.css` | Samo navedene komponente služe javnom demou; preostali provider i adapteri koriste se u admin simulatoru/testovima. | 544 |
| `src/components/preview/AccountPreview.tsx` | Samo navedene komponente služe javnom demou; preostali provider i adapteri koriste se u admin simulatoru/testovima. | 324 |
| `src/components/preview/business-preview.module.css` | Samo navedene komponente služe javnom demou; preostali provider i adapteri koriste se u admin simulatoru/testovima. | 310 |
| `src/components/preview/BusinessCard.tsx` | Samo navedene komponente služe javnom demou; preostali provider i adapteri koriste se u admin simulatoru/testovima. | 57 |
| `src/components/preview/BusinessPreview.tsx` | Samo navedene komponente služe javnom demou; preostali provider i adapteri koriste se u admin simulatoru/testovima. | 336 |
| `src/components/preview/messaging-preview.module.css` | Samo navedene komponente služe javnom demou; preostali provider i adapteri koriste se u admin simulatoru/testovima. | 50 |
| `src/components/preview/MessagingPreview.tsx` | Samo navedene komponente služe javnom demou; preostali provider i adapteri koriste se u admin simulatoru/testovima. | 85 |
| `src/components/preview/PeoplePreview.tsx` | Samo navedene komponente služe javnom demou; preostali provider i adapteri koriste se u admin simulatoru/testovima. | 34 |
| `src/components/preview/PreviewBooking.tsx` | Samo navedene komponente služe javnom demou; preostali provider i adapteri koriste se u admin simulatoru/testovima. | 17 |
| `src/components/preview/PreviewHome.tsx` | Samo navedene komponente služe javnom demou; preostali provider i adapteri koriste se u admin simulatoru/testovima. | 102 |
| `src/components/preview/PreviewPwa.tsx` | Samo navedene komponente služe javnom demou; preostali provider i adapteri koriste se u admin simulatoru/testovima. | 39 |
| `src/components/preview/PreviewShell.tsx` | Samo navedene komponente služe javnom demou; preostali provider i adapteri koriste se u admin simulatoru/testovima. | 113 |
| `src/server/dodo/http.ts` | Nijedna src/app ruta ni runtime ulaz ne importuje adapter; reference su isključivo njegovi testovi. | 161 |
| `src/server/dodo/runtime.ts` | Nijedna src/app ruta ni runtime ulaz ne importuje adapter; reference su isključivo njegovi testovi. | 237 |
| `src/server/dodo/test-adapter.ts` | Nijedna src/app ruta ni runtime ulaz ne importuje adapter; reference su isključivo njegovi testovi. | 265 |
| `src/server/dodo/test-store.ts` | Nijedna src/app ruta ni runtime ulaz ne importuje adapter; reference su isključivo njegovi testovi. | 394 |
| `src/lib/dodo-test-return.ts` | Nema aktivne rute; testovi su vezani samo za uklonjeni adapter ili javni demo. Primijenjene migracije i historijski podaci ostaju. | 7 |
| `src/server/paypal-sandbox.ts` | Nema aktivne rute; testovi su vezani samo za uklonjeni adapter ili javni demo. Primijenjene migracije i historijski podaci ostaju. | 165 |
| `tests/dodo-http.test.ts` | Nema aktivne rute; testovi su vezani samo za uklonjeni adapter ili javni demo. Primijenjene migracije i historijski podaci ostaju. | 236 |
| `tests/dodo-test-adapter.test.ts` | Nema aktivne rute; testovi su vezani samo za uklonjeni adapter ili javni demo. Primijenjene migracije i historijski podaci ostaju. | 197 |
| `tests/dodo-test-return.test.ts` | Nema aktivne rute; testovi su vezani samo za uklonjeni adapter ili javni demo. Primijenjene migracije i historijski podaci ostaju. | 19 |
| `tests/integration/dodo-checkout.test.mjs` | Nema aktivne rute; testovi su vezani samo za uklonjeni adapter ili javni demo. Primijenjene migracije i historijski podaci ostaju. | 174 |
| `tests/paypal-sandbox.test.ts` | Nema aktivne rute; testovi su vezani samo za uklonjeni adapter ili javni demo. Primijenjene migracije i historijski podaci ostaju. | 123 |
| `public/preview-app.webmanifest` | Nema aktivne rute; testovi su vezani samo za uklonjeni adapter ili javni demo. Primijenjene migracije i historijski podaci ostaju. | 17 |
| `public/preview-offline.html` | Nema aktivne rute; testovi su vezani samo za uklonjeni adapter ili javni demo. Primijenjene migracije i historijski podaci ostaju. | 1 |
| `public/preview-sw.js` | Nema aktivne rute; testovi su vezani samo za uklonjeni adapter ili javni demo. Primijenjene migracije i historijski podaci ostaju. | 35 |
| `tests/preview-pwa.test.ts` | Nema aktivne rute; testovi su vezani samo za uklonjeni adapter ili javni demo. Primijenjene migracije i historijski podaci ostaju. | 352 |
| `scripts/verify-business-details-ui.mjs` | Nema poziva iz package.json, CI ili unit testova; jednokratni lokalni harnessi i njihove nepozvane komponente. Servisni i integracijski testovi ostaju. | 94 |
| `scripts/verify-business-import-ui.mjs` | Nema poziva iz package.json, CI ili unit testova; jednokratni lokalni harnessi i njihove nepozvane komponente. Servisni i integracijski testovi ostaju. | 91 |
| `scripts/verify-business-ownership-ui.mjs` | Nema poziva iz package.json, CI ili unit testova; jednokratni lokalni harnessi i njihove nepozvane komponente. Servisni i integracijski testovi ostaju. | 85 |
| `scripts/verify-favorites-ui.mjs` | Nema poziva iz package.json, CI ili unit testova; jednokratni lokalni harnessi i njihove nepozvane komponente. Servisni i integracijski testovi ostaju. | 108 |
| `tests/fixtures/AccountAuthorityFixture.tsx` | Nema poziva iz package.json, CI ili unit testova; jednokratni lokalni harnessi i njihove nepozvane komponente. Servisni i integracijski testovi ostaju. | 317 |
| `tests/fixtures/AdminReviewsBoundaryFixture.tsx` | Nema poziva iz package.json, CI ili unit testova; jednokratni lokalni harnessi i njihove nepozvane komponente. Servisni i integracijski testovi ostaju. | 205 |
| `tests/fixtures/BusinessOwnershipFixture.tsx` | Nema poziva iz package.json, CI ili unit testova; jednokratni lokalni harnessi i njihove nepozvane komponente. Servisni i integracijski testovi ostaju. | 387 |
| `tests/fixtures/BusinessReviewsBoundaryFixture.tsx` | Nema poziva iz package.json, CI ili unit testova; jednokratni lokalni harnessi i njihove nepozvane komponente. Servisni i integracijski testovi ostaju. | 206 |
| `tests/fixtures/BusinessReviewsFixture.tsx` | Nema poziva iz package.json, CI ili unit testova; jednokratni lokalni harnessi i njihove nepozvane komponente. Servisni i integracijski testovi ostaju. | 60 |
| `tests/fixtures/FavoritesFixture.tsx` | Nema poziva iz package.json, CI ili unit testova; jednokratni lokalni harnessi i njihove nepozvane komponente. Servisni i integracijski testovi ostaju. | 413 |

## Namjerno zadržano

- Svih 53 primijenjenih migracija; bez SQL izmjena ili brisanja podataka.
- `src/server/paypal/*`, `src/server/paypal-subscriptions/*`, zajednički ugovori i historijski zapisi: live i sandbox dijele obračun/čitanje; produkcijske zastavice nisu potvrđene.
- `src/components/preview/*` adapteri i podaci koje koristi zaštićeni `/administracija/izgled/pregled`; nema javnog `/pregled`. To je administratorski alat, ne javna alternativna aplikacija.
- `public/preview/*.webp`: koriste ih admin simulator i dozvoljene fotografije dizajna.
- `public/brand/home-*.webp`: dinamički src u HomeArtwork; pretraga punog literalnog imena sama nije dokaz da su slike mrtve.
- `scripts/ingress-*`: start i auth ih stvarno pozivaju; nisu ostaci samo zbog riječi observation u starom dokumentu.
- Kartice djelatnosti, mobilni meni i njihove zajedničke komponente ostaju netaknuti.
- `artifacts/` nije postojao na početku.

## Ograničenje dokaza

Ne brišemo kod samo zato što je iza env zastavice čija vrijednost u produkciji nije provjerena. Otvorene odluke su u `OTVORENE-ODLUKE.md`. Stari tematski dokumenti objedinjeni su u završnoj fazi; izvor licence je sačuvan.

## Objedinjeni raniji dokumenti (faza 6)

Važeća pravila prebačena su u `ARHITEKTURA.md`, `OPERACIJE.md`, `PROVJERA.md` i `IZVORI-SLIKA.md`. Stare tvrdnje o objavljenom stanju i privremenoj fazi opažanja nisu prenesene kao aktuelni dokaz.

| Uklonjeni dokument | Sačuvano u | Redovi |
|---|---|---:|
| `docs/ACCOUNT-AUTHORITY-BOUNDARY.md` | ARHITEKTURA / PROVJERA | 35 |
| `docs/ACCOUNT-ERASURE.md` | ARHITEKTURA / PROVJERA | 9 |
| `docs/ASSET-CREDITS.md` | IZVORI-SLIKA | 11 |
| `docs/AUTH-INGRESS-ENFORCEMENT-CANDIDATE.md` | OPERACIJE | 126 |
| `docs/AUTH-INGRESS-OBSERVATION.md` | OPERACIJE | 30 |
| `docs/BUSINESS-DETAILS.md` | ARHITEKTURA / PROVJERA | 22 |
| `docs/BUSINESS-DISCOVERY.md` | ARHITEKTURA / PROVJERA | 32 |
| `docs/FAVORITES.md` | ARHITEKTURA / PROVJERA | 40 |
| `docs/REVIEWS.md` | ARHITEKTURA / PROVJERA | 61 |

Objedinjeno 9 dokumenata sa 366 redova; sadržaj potreban timu čuva se u navedenom skupu. Putanje ikona premještene su bez promjene PNG/SVG bajtova i zato nisu brojane kao obrisani vizuelni resursi.

## Uklonjene mrtve grane u korištenim komponentama

- `BusinessEditor`, `BusinessBookingManager`, `CustomerAppointments`, `InventoryAppointments`, `ConnectionsPanel`, `PersonalProfileWorkspace`: nakon uklanjanja javnog demo prikaza nema poziva sa `preview=true`. Uklonjeni su isključivo ti propovi, grane i demo poruke; injektovani transport i provjere identiteta ostaju. Uklonjen je nepozvani export `AppointmentsEmpty` i CSS `.previewNote`. Zajedno šest TSX fajlova i CSS: pregledani diff ima +38/−112 redova.
- `PackageCheckout`: jedina ruta `/paketi/placanje` uvijek je tražila live okruženje. Uklonjeni su nepozvani sandbox izbor, nepostojeće `/api/test-paketi` i `/paketi/proba` veze te njihov prop. Postojeći live PayPal/kreditni i historijski ugovori ostaju.
- `PreviewState`: uklonjeno demo čuvanje favorita/lokacije koje više niko ne poziva. Zadržani su memorijski adapteri stvarnog administratorskog simulatora.

Provjera: svi JSX pozivi u `src`/`tests`, provjera tipova, postojeći transportni unit testovi i pregled konačnog diff-a. Nije mijenjana tabela niti zapis plaćanja.

## 22. 11. 2026. — Uklanjanje stare naplate

Po konačnoj odluci vlasnika uklonjeni su aplikacijski moduli za Ahi kredite, novčanik, dopune, pakete i pretplate, kartično i PayPal plaćanje, račune i raspodjelu razvojnog fonda, produkcijske ponude i stari oglasni sistem (kampanje, CPM, isporuka i publika). Uklonjeni su povezani ekrani, API rute, email primjeri, administracija, testovi i operativna dokumentacija. Donacije ostaju. Arhivske tabele, redovi i migracije nisu obrisani ni prepravljeni.

Testni fajlovi uklonjeni u ovoj fazi: 35. Broj svih uklonjenih fajlova i linija navodi se u završnoj predaji prema Git diffu.

## 24. 11. 2026. — Potpuno uklanjanje PayPala

Po odluci vlasnika PayPal je uklonjen i iz donacija: donacije idu samo bankovnom uplatom. Migracija `0057_drop_paypal_archive.sql` briše arhivske tabele `paypal_checkout_order`, `paypal_checkout_event`, `paypal_webhook_event`, `paypal_refund_command` i `paypal_promotion_entitlement` te funkcije koje su ih čitale. Pogled `ahi_credit_movements` i zaštite `guard_production_receipt_link` i `guard_bank_topup_instructions` rade kao da PayPal narudžbi nema. Računovodstveni zapisi (`billing_receipt`), knjiga razvojnog fonda i ostale arhivske narudžbe nisu mijenjani; njihove historijske vrijednosti `paypal` ostaju. Obrisani redovi postoje u backupu `2026-11-24_16-45-28` (čuva se 30 dana).

## 25. 11. 2026. — Uklanjanje isticanja i oglasnog prostora

Po odluci vlasnika uklonjene su sve trenutne opcije isticanja; novi model se dogovara naknadno. Obrisani su stranice `/istakni`, `/nalog/isticanja`, `/administracija/isticanja` te preusmjerenja `/oglasavanje` i `/paketi`, API `/api/promotions` i `/api/admin/promotions`, servis narudžbi i bankovnih uputa, radni ekran isticanja, red „Isticanja na čekanju” u administraciji, link „Istakni djelatnost” u Mojim djelatnostima, te sekcije „Oglasni prostor” i „Poziv na isticanje” na početnoj (u uređivaču izgleda vode se kao povučene, pa raniji objavljeni redoslijed ostaje čitljiv). Uklonjeni su i njihovi prevodi i testovi.

Tabele iz migracije `0054_promotions.sql` i njihovi redovi nisu dirani. `activePromotionSql` i prikaz „Istaknuto” ostaju, pa isticanje koje je već bilo aktivno vrijedi do svog kraja; narudžbe na čekanju ostaju u bazi bez ekrana za potvrdu. Brisanje tabela traži posebnu odluku vlasnika i novu migraciju.

## 25. 11. 2026. — Brisanje probnih podataka prije puštanja

Po odluci vlasnika obrisane su sve djelatnosti (33) i svi nalozi osim vlasničkog (8), zajedno s
onim što im je pripadalo: slike, Reels, poruke, recenzije, sačuvano, zahtjevi, historija odluka,
narudžbe isticanja i oglašavanja te zahtjevi za dopunu kredita. Prije brisanja je provjereno da
nema nijedne potvrđene uplate: dopune nisu bile odobrene, jedini paket je bio na čekanju bez
plaćenih ciklusa, a `billing_receipt` i `billing_development_ledger` su bili prazni. Ostali su
vlasnički nalog s prijavama, kategorije, članci, izgled početne, cjenovnici i potvrde o brisanju
naloga. Stanje prije brisanja je u backupu `2026-11-25_08-51-27` na OctaDeployu (čuva se 30 dana).

Brisanje je izvedeno jednokratnim alatom koji je iz baze čitao strane ključeve i okidače, praznio
zavisne tabele u jednoj transakciji i tek onda uklanjao naloge, jer ih šema inače štiti. Alat je
imao vlasničku stranicu `/administracija/ciscenje` i komandu za kontejner; oboje je uklonjeno
istog dana, zajedno s testovima. U `platform_settings` ostaje zapis
`maintenance.prelaunch_reset` s vremenom i brojevima. Ako takav alat ponovo zatreba, nalazi se u
historiji repozitorija (PR #34 i #36).

## Jedna granica djelatnosti za sve naloge (25. 11. 2026.)

Varijabla okruženja `DIRECTORY_MEMBER_BUSINESS_LIMIT` je uklonjena. Do tada je jedan broj važio
za sve članove (podrazumijevano 1); sada granicu određuje paket naloga (`docs/PROIZVOD.md`,
`docs/handover/OPERACIJE.md` → Paketi naloga). Ako je varijabla ostala upisana na serveru, više
se ne čita i može se obrisati.
