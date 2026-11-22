# Inventura AhiBizz aplikacije

Početno stanje prije brisanja, 22. 11. 2026., grana `codex/handover-cleanup`, HEAD `755fe81`. Vlasnik zadatka: Codex, po nalogu vlasnika preko Claude Code. Nema pristupa živoj bazi niti potvrde produkcijskih env vrijednosti.

## Kako čitati inventuru

Ovo je pregled izvornog koda, ne tvrdnja o izvršenim browser klikovima. Zabilježeno je **48 stranica, 47 route handlera i 1.104 interaktivna JSX mjesta**. Ruta sa `[id]`, `[...path]` ili `[[...path]]` je šablon. Query parametri biraju pod-ekrane, ne stvaraju nove fajlove. U odjeljku za svaku stranicu naveden je kompletan statički skup kontrola kroz lokalne importe, uključujući zajednički layout i uslovne prikaze. Katalog svakoj kontroli dodjeljuje stabilni ID za ovaj početni snapshot, putanju, liniju i handler/odredište. Mape i liste proizvode više instanci iste kontrole; uslovi za ulogu/Play/preview odlučuju koje se stvarno vide.

API spiskovi komponenti uključuju pozive pri učitavanju i kroz uvezene klijentske pomoćne funkcije; nisu tvrdnja da svako dugme poziva sve navedene API-je. Polje `onClick/onSubmit/onChange` pokazuje tačno koji handler treba pratiti za pojedinu kontrolu. Promjena inputa obično mijenja lokalni draft, a form.submit šalje podatke. Callback proslijeđen kroz props izvršava roditelj. Posebne dozvole browsera (lokacija, clipboard, push, instalacija, kamera upload) nisu HTTP API rute. Dekorativni SVG/icon nisu klikovi.

Kartice djelatnosti i mobilni meni su samo popisani: njihov izgled, raspored, ponašanje i tekstovi ne smiju se mijenjati. Detalji poslije čišćenja i stvarni status provjera nalaze se u `PROVJERA.md` i `OBRISANO.md`; početna inventura namjerno čuva dokaz o uklonjenim rutama.

## Stranice i pristup

| Ruta | Namjena | Pristup | Glavne komponente | Server servis (direktni importi) |
|---|---|---|---|---|
| `/administracija/blog` | Urednik članaka i objava | Odobren, potvrđen nalog role owner; ostali preusmjereni/404 | `ArticleEditor`, `content-hub.module.css` | `src/server/auth/accounts.ts`, `src/server/content-hub.ts` |
| `/administracija/emailovi` | Pregled primjera emailova; ne šalje email | Odobren, potvrđen nalog role owner; ostali preusmjereni/404 | JSX stranice | `src/server/auth/accounts.ts`, `src/server/auth/config.ts`, `src/server/mail/examples.ts`, `src/server/mail/preview.ts` |
| `/administracija/izgled` | Uređivanje dozvoljenih vizuelnih postavki | Odobren, potvrđen nalog role owner; ostali preusmjereni/404 | `VisualDesigner` | `src/server/auth/accounts.ts`, `src/server/visual-design-store.ts` |
| `/administracija/izgled/pregled` | Zaštićeni simulator vizuelnih postavki | Odobren, potvrđen nalog role owner; ostali preusmjereni/404 | `DesignPreview` | `src/server/auth/accounts.ts` |
| `/administracija/lokacije` | Grupna priprema i primjena korekcija lokacija | Odobren, potvrđen nalog role owner; ostali preusmjereni/404 | `BusinessLocationBatch` | `src/server/auth/accounts.ts` |
| `/administracija/oglasi` | Administracija kampanja, kreativa i dopuna | Odobren, potvrđen nalog role owner; ostali preusmjereni/404 | `MarketingWorkspace` | `src/server/auth/accounts.ts` |
| `/administracija` | Administracija: redovi zahtjeva, nalozi, djelatnosti, kategorije, recenzije i naplata | Odobren, potvrđen nalog role owner; ostali preusmjereni/404 | `AdminDashboard` | `src/server/auth/accounts.ts` |
| `/administracija/reels` | Administracija videozapisa | Odobren, potvrđen nalog role owner; ostali preusmjereni/404 | `ReelManager`, `reels.module.css` | `src/server/auth/accounts.ts`, `src/server/reels/service.ts` |
| `/administracija/uvoz-prijava` | Pregled i uvoz prijava iz fajla | Odobren, potvrđen nalog role owner; ostali preusmjereni/404 | `BusinessImport` | `src/server/auth/accounts.ts` |
| `/administracija/zahtjevi` | Podrška, prijave sadržaja i zahtjevi za brisanje | Odobren, potvrđen nalog role owner; ostali preusmjereni/404 | `resources.module.css` | `src/server/account-erasure.ts`, `src/server/auth/accounts.ts`, `src/server/support-requests.ts` |
| `/blog/[slug]` | Članak, povezani sadržaj i sačuvaj | Javno; privatne radnje zahtijevaju nalog | `BookmarkForm`, `content-hub.module.css` | `src/server/content-hub.ts` |
| `/blog` | Objavljeni članci, pretraga i sačuvani članci | Javno; privatne radnje zahtijevaju nalog | `ArticleCard`, `content-hub.module.css`, `Icon` | `src/server/auth/accounts.ts`, `src/server/content-hub.ts` |
| `/blokirani-korisnici` | Pregled i uklanjanje vlastitih blokada | Odobren, potvrđen član/owner; gost na prijavu | `BlockedPeople`, `blocks.module.css` | `src/server/account-blocks.ts`, `src/server/auth/accounts.ts`, `src/server/auth/service.ts` |
| `/brisanje-naloga` | Javne upute i zahtjev za brisanje naloga | Javno; privatne radnje zahtijevaju nalog | `RequestScreen` | Statički sadržaj / klijent; zajednički layout ispod |
| `/djelatnosti/[id]` | Javni profil djelatnosti, galerija, kontakti, usluge, termini i recenzije | Javno; privatne radnje zahtijevaju nalog | `PublicBooking`, `PublicBusinessProfile`, `public-profile.module.css`, `public-search.module.css`, `CampaignAd`, `campaign-ad.module.css`, `ReelShelf`, `RentalFleet`, `StayUnits` | `src/server/booking/index.ts`, `src/server/directory/index.ts`, `src/server/directory/public-view.ts`, `src/server/marketing/ad-delivery.ts`, `src/server/rentals/service.ts`, `src/server/stays/service.ts` |
| `/instaliraj` | Instalacija web aplikacije i dozvole uređaja | Javno; privatne radnje zahtijevaju nalog | `InstallPage` | Statički sadržaj / klijent; zajednički layout ispod |
| `/ljudi/[id]` | Javni lični profil, prijateljstvo, blokiranje i povezane djelatnosti | Javno; privatne radnje zahtijevaju nalog | `connections.module.css`, `PublicPersonProfile` | Statički sadržaj / klijent; zajednički layout ispod |
| `/ljudi` | Pretraga javnih ličnih profila | Javno; privatne radnje zahtijevaju nalog | `PeopleSearch` | Statički sadržaj / klijent; zajednički layout ispod |
| `/nalog/obavijesti` | Obavijesti: čitanje aktivnosti i odlazak na predmet | Odobren, potvrđen član/owner; gost na prijavu | `Icon` | `src/server/account-activity.ts`, `src/server/auth/accounts.ts` |
| `/nalog` | Radni prostor: pregled, profil, djelatnosti, termini, prijatelji, poruke, sačuvano, postavke, paketi, oglasi, krediti | Odobren, potvrđen član/owner; gost na prijavu | `AccountDashboard` | `src/server/auth/accounts.ts` |
| `/nalog/reels` | Vlastiti kratki videozapisi: kreiranje, plaćanje kreditima i upravljanje | Odobren, potvrđen član/owner; gost na prijavu | `ReelManager`, `reels.module.css` | `src/server/auth/accounts.ts`, `src/server/reels/service.ts` |
| `/naplata/odustajanje` | Odustajanje od plaćanja i oporavak narudžbe | Stranica čitljiva; naredbe zahtijevaju nalog i vlasništvo, Play blokira | `CheckoutEntry` | Statički sadržaj / klijent; zajednički layout ispod |
| `/naplata` | Plaćanje narudžbe i pregled statusa | Stranica čitljiva; naredbe zahtijevaju nalog i vlasništvo, Play blokira | `CheckoutEntry` | Statički sadržaj / klijent; zajednički layout ispod |
| `/naplata/povratak` | Povratak nakon plaćanja; provjera statusa | Stranica čitljiva; naredbe zahtijevaju nalog i vlasništvo, Play blokira | `CheckoutEntry` | Statički sadržaj / klijent; zajednički layout ispod |
| `/nova-lozinka` | Promjena lozinke tokenom iz emaila | Javno; privatne radnje zahtijevaju nalog | `AuthForm` | `src/server/auth-availability.ts` |
| `/o-nama` | Predstavljanje AhiBizza | Javno; privatne radnje zahtijevaju nalog | `Icon` | Statički sadržaj / klijent; zajednički layout ispod |
| `/oglasavanje` | Ponuda oglašavanja, izbor prostora i kampanje | Javno; privatne radnje zahtijevaju nalog | `Icon`, `AdExplorer`, `ad-guide.module.css` | `src/server/ad-audience-sample.ts`, `src/server/auth/service.ts`, `src/server/directory/read-service.ts`, `src/server/marketing/ad-delivery.ts`, `src/server/marketing/ad-pricing.ts`, `src/server/wallet/platform-policy.ts`, `src/server/wallet/service.ts` |
| `/` | Početna: kategorije, bliske djelatnosti, objavljeni sadržaj i oglasi | Javno; privatne radnje zahtijevaju nalog | `DirectoryResultCard`, `HomeCategories`, `HomeFeaturedRail`, `HomeNearby`, `HomeSurface`, `CampaignAd`, `ReelShelf` | `src/server/directory/index.ts`, `src/server/directory/public-view.ts`, `src/server/marketing/ad-delivery.ts`, `src/server/visual-design-store.ts` |
| `/paketi` | Poređenje paketa za djelatnosti | Javno; privatne radnje zahtijevaju nalog | `PricingCatalog` | `src/server/auth/service.ts`, `src/server/paypal-subscriptions/benefits.ts`, `src/server/wallet/platform-policy.ts`, `src/server/wallet/service.ts` |
| `/paketi/placanje` | Izbor djelatnosti/paketa i aktivacija ili plaćanje | Stranica čitljiva; naredbe zahtijevaju nalog i vlasništvo, Play blokira | `PackageCheckout` | `src/server/auth/accounts.ts` |
| `/podrzi` | Dobrovoljna podrška: podaci za uplatu i vanjski PayPal link | Javno; privatne radnje zahtijevaju nalog | `SupportPage` | Statički sadržaj / klijent; zajednički layout ispod |
| `/pomoc` | Pretraživanje centra pomoći i zahtjev timu | Javno; privatne radnje zahtijevaju nalog | `content-hub.module.css`, `HelpDesk` | `src/server/auth/accounts.ts` |
| `/pravila-zajednice` | Javna pravila objavljivanja i ponašanja | Javno; privatne radnje zahtijevaju nalog | `resources.module.css` | Statički sadržaj / klijent; zajednički layout ispod |
| `/pretraga` | Imenik: pretraga, filteri, kartice, spremanje upita | Javno; privatne radnje zahtijevaju nalog | `DirectoryResultCard`, `DirectorySearchForm`, `public-search.module.css`, `EmptyDirectory`, `SavedSearches`, `CampaignAd`, `campaign-ad.module.css` | `src/server/account-blocks.ts`, `src/server/directory/index.ts`, `src/server/directory/public-view.ts`, `src/server/marketing/ad-delivery.ts` |
| `/prijava` | Prijava emailom i lozinkom, potvrda emaila i nastavak namjere | Javno; privatne radnje zahtijevaju nalog | `AuthForm` | `src/server/auth/accounts.ts`, `src/server/auth-availability.ts` |
| `/prijavi-sadrzaj` | Prijava sadržaja timu | Javno; privatne radnje zahtijevaju nalog | `RequestScreen` | Statički sadržaj / klijent; zajednički layout ispod |
| `/privatnost` | Javna pravila privatnosti | Javno; privatne radnje zahtijevaju nalog | `resources.module.css` | Statički sadržaj / klijent; zajednički layout ispod |
| `/reels` | Javna polica videozapisa | Javno; privatne radnje zahtijevaju nalog | `ReelShelf`, `reels.module.css` | `src/server/reels/service.ts`, `src/server/reels/viewer.ts` |
| `/registracija` | Registracija uz prihvatanje pravila | Javno; privatne radnje zahtijevaju nalog | `AuthForm` | `src/server/auth-availability.ts` |
| `/sacuvane-pretrage` | Pregled, otvaranje i uklanjanje sačuvanih pretraga | Odobren, potvrđen član/owner; gost na prijavu | `SavedSearches`, `saved-searches.module.css` | `src/server/auth/accounts.ts`, `src/server/saved-search.ts` |
| `/zaboravljena-lozinka` | Zahtjev za obnovu lozinke | Javno; privatne radnje zahtijevaju nalog | `AuthForm` | `src/server/auth-availability.ts` |
| `/reels/[id]` | Preglednik videa, navigacija, sviđanje, komentari, dijeljenje i prijava | Javno; privatne radnje zahtijevaju nalog | `ReelViewer` | `src/server/reels/service.ts`, `src/server/reels/viewer.ts` |
| `/pregled/djelatnost` | Javna demonstracija izgleda i simuliranih podataka | Javno; demonstracija za uklanjanje | `data` | Statički sadržaj / klijent; zajednički layout ispod |
| `/pregled/instaliraj` | Javna demonstracija izgleda i simuliranih podataka | Javno; demonstracija za uklanjanje | `PreviewPwa` | Statički sadržaj / klijent; zajednički layout ispod |
| `/pregled/ljudi` | Javna demonstracija izgleda i simuliranih podataka | Javno; demonstracija za uklanjanje | `PeoplePreview` | Statički sadržaj / klijent; zajednički layout ispod |
| `/pregled` | Javna demonstracija izgleda i simuliranih podataka | Javno; demonstracija za uklanjanje | `PreviewHome` | Statički sadržaj / klijent; zajednički layout ispod |
| `/pregled/pretraga` | Javna demonstracija izgleda i simuliranih podataka | Javno; demonstracija za uklanjanje | `BusinessCard`, `data` | Statički sadržaj / klijent; zajednički layout ispod |
| `/pregled/prostor/[section]` | Javna demonstracija izgleda i simuliranih podataka | Javno; demonstracija za uklanjanje | `AccountPreview`, `MessagingPreview` | Statički sadržaj / klijent; zajednički layout ispod |

Zajednički server layout: `src/app/layout.tsx`, `src/app/(public)/layout.tsx`, `src/server/visual-design-store.ts`; korisnički meni koristi account overview i autorizovane API-je. `role=owner` ovdje znači administrator platforme, a vlasništvo djelatnosti se provjerava zasebno. `src/server/auth/accounts.ts` odbija suspendovan/neodobren nalog i nepotvrđen email, a owner-radnje dodatno provjeravaju ulogu.

Pod-ekrani naloga: `pregled, profil, djelatnosti, termini, prijatelji, poruke, postavke, paketi, oglasi, krediti, sacuvani` (`src/lib/account-return.ts`). Poslovni upiti, kalendar, oglasi i povratak na dopunu imaju dodatne parametre koje parsiraju zatvoreni validatori u istom modulu. Administrativni pod-ekrani: `src/lib/admin-navigation.ts` i `AdminDashboard`; odvojene stranice za blog, emailove, izgled, lokacije, oglase, videozapise, uvoz i podršku.

## API i tehničke rute

| Ruta | Metode | Namjena / glavni server moduli | Pristup i granica |
|---|---|---|---|
| `/.well-known/ahibizz-distribution.json` | GET | `src/lib/distribution.ts` | Javno; bez korisničkih izmjena |
| `/.well-known/assetlinks.json` | GET | `src/lib/android-association.ts`, `src/lib/distribution.ts` | Javno; bez korisničkih izmjena |
| `/api/account/ad-preference` | GET, POST | `src/lib/distribution.ts`, `src/server/auth/accounts.ts`, `src/server/auth/config.ts`, `src/server/flat-json.ts`, `src/server/marketing/ad-preferences.ts` | Privatni nalog; identitet/vlasništvo i origin na izmjenama u handleru/servisu |
| `/api/account/audience-sample` | GET, POST | `src/lib/ad-audience-sample.ts`, `src/lib/business-today.ts`, `src/lib/distribution.ts`, `src/server/ad-audience-sample.ts`, `src/server/auth/accounts.ts`, `src/server/auth/config.ts`, `src/server/flat-json.ts` | Privatni nalog; identitet/vlasništvo i origin na izmjenama u handleru/servisu |
| `/api/account/blocks/[id]` | GET, PATCH | `src/server/account-blocks-http.ts` | Privatni nalog; identitet/vlasništvo i origin na izmjenama u handleru/servisu |
| `/api/account/blocks` | GET, PATCH | `src/server/account-blocks-http.ts` | Privatni nalog; identitet/vlasništvo i origin na izmjenama u handleru/servisu |
| `/api/account/business-today` | GET | `src/server/account-http.ts` | Privatni nalog; identitet/vlasništvo i origin na izmjenama u handleru/servisu |
| `/api/account/memberships` | GET | `src/server/auth/accounts.ts`, `src/server/auth/service.ts`, `src/server/paypal-subscriptions/service.ts` | Privatni nalog; identitet/vlasništvo i origin na izmjenama u handleru/servisu |
| `/api/account/menu` | GET | `src/lib/distribution.ts`, `src/server/auth/accounts.ts`, `src/server/auth/service.ts`, `src/server/wallet/service.ts` | Privatni nalog; identitet/vlasništvo i origin na izmjenama u handleru/servisu |
| `/api/account/overview` | GET | `src/server/account-http.ts` | Privatni nalog; identitet/vlasništvo i origin na izmjenama u handleru/servisu |
| `/api/account/password` | PATCH | `src/server/account-http.ts` | Privatni nalog; identitet/vlasništvo i origin na izmjenama u handleru/servisu |
| `/api/account/placements` | GET | `src/server/account-http.ts` | Privatni nalog; identitet/vlasništvo i origin na izmjenama u handleru/servisu |
| `/api/account` | GET, PATCH | `src/server/account-http.ts` | Privatni nalog; identitet/vlasništvo i origin na izmjenama u handleru/servisu |
| `/api/account/saved-searches` | GET, POST | `src/server/account-http.ts`, `src/server/auth/accounts.ts`, `src/server/auth/config.ts`, `src/server/saved-search.ts` | Privatni nalog; identitet/vlasništvo i origin na izmjenama u handleru/servisu |
| `/api/admin/accounts/[id]` | GET, PATCH | `src/server/account-http.ts` | Potvrđen odobren owner; provjera u servisu |
| `/api/admin/accounts` | GET | `src/server/account-http.ts` | Potvrđen odobren owner; provjera u servisu |
| `/api/admin/today` | GET | `src/server/account-http.ts` | Potvrđen odobren owner; provjera u servisu |
| `/api/admin/verification/[kind]/[id]` | GET, PUT | `src/server/verification-http.ts` | Potvrđen odobren owner; provjera u servisu |
| `/api/auth/[...all]` | GET, POST | `src/server/auth-http.ts` | Better Auth; javni ulaz uz origin/rate/session provjere po radnji |
| `/api/billing/[...path]` | GET, POST, PATCH | `src/server/billing-http.ts` | Javni katalog; privatni planovi/narudžbe uz nalog; administracija owner; Play ograničava |
| `/api/booking/[...path]` | GET, POST, PATCH | `src/server/booking-http.ts`, `src/server/community-rules.ts` | Javna dozvoljena čitanja; privatno/izmjene provjeravaju nalog i vlasništvo/owner |
| `/api/business-details/[...path]` | GET, PUT | `src/server/business-details-http.ts`, `src/server/community-rules.ts` | Javna dozvoljena čitanja; privatno/izmjene provjeravaju nalog i vlasništvo/owner |
| `/api/business-media/[...path]` | GET, PUT, DELETE | `src/server/business-media-http.ts`, `src/server/community-rules.ts` | Javna dozvoljena čitanja; privatno/izmjene provjeravaju nalog i vlasništvo/owner |
| `/api/checkout/[...path]` | GET, POST | `src/server/paypal/runtime.ts` | Potvrđen nalog i vlasništvo; webhook verifikacija; Play blokira |
| `/api/community-rules` | GET, POST | `src/server/community-rules.ts` | Privatni nalog; identitet/vlasništvo i origin na izmjenama u handleru/servisu |
| `/api/connections/[...path]` | GET, PATCH, POST | `src/server/connections-http.ts` | Javna dozvoljena čitanja; privatno/izmjene provjeravaju nalog i vlasništvo/owner |
| `/api/directory/[...path]` | GET, POST, PATCH, DELETE | `src/server/directory-http.ts`, `src/server/community-rules.ts` | Javna dozvoljena čitanja; privatno/izmjene provjeravaju nalog i vlasništvo/owner |
| `/api/directory/ownership/[...path]` | GET, POST, PUT | `src/server/business-ownership-http.ts` | Odobren član/owner i vlasništvo/predmet; odluku donosi owner |
| `/api/favorites/[[...path]]` | GET, PUT | `src/server/favorites-http.ts` | Privatni nalog; identitet/vlasništvo i origin na izmjenama u handleru/servisu |
| `/api/health/live` | GET | `src/server/health.ts` | Javno; bez korisničkih izmjena |
| `/api/health/ready` | GET | `src/server/db.ts`, `src/server/health.ts` | Javno; bez korisničkih izmjena |
| `/api/marketing/creative/[id]` | GET, PUT | `src/lib/ad-asset.ts`, `src/lib/business-today.ts`, `src/lib/distribution.ts`, `src/server/auth/accounts.ts`, `src/server/auth/config.ts`, `src/server/auth/service.ts`, `src/server/marketing/ad-asset.ts` | Javno samo aktivna objavljena kreativa; izmjene owner |
| `/api/marketing/events` | POST | `src/lib/distribution.ts`, `src/server/auth/config.ts`, `src/server/db.ts`, `src/server/flat-json.ts`, `src/server/marketing/ad-token.ts` | Javni događaj uz potpisani oglasni token, validaciju i ograničenja |
| `/api/marketing/inquiry` | POST | `src/lib/business-today.ts`, `src/lib/distribution.ts`, `src/lib/messaging.ts`, `src/server/auth/accounts.ts`, `src/server/auth/config.ts`, `src/server/auth/service.ts`, `src/server/flat-json.ts`, `src/server/messaging/service.ts`, `src/server/messaging/validation.ts` | Privatni nalog; identitet/vlasništvo i origin na izmjenama u handleru/servisu |
| `/api/marketing/rates` | GET, POST | `src/lib/distribution.ts`, `src/server/auth/accounts.ts`, `src/server/auth/config.ts`, `src/server/flat-json.ts`, `src/server/marketing/ad-pricing.ts` | Privatni nalog; identitet/vlasništvo i origin na izmjenama u handleru/servisu |
| `/api/marketing` | GET, POST | `src/lib/distribution.ts`, `src/lib/marketing.ts`, `src/server/auth/accounts.ts`, `src/server/auth/config.ts`, `src/server/flat-json.ts`, `src/server/marketing/service.ts` | Privatni nalog; identitet/vlasništvo i origin na izmjenama u handleru/servisu |
| `/api/messaging/[...path]` | GET, POST | `src/server/messaging-http.ts`, `src/server/community-rules.ts` | Privatni nalog; identitet/vlasništvo i origin na izmjenama u handleru/servisu |
| `/api/paketi/[...path]` | GET, POST | `src/server/paypal-subscriptions/http.ts` | Potvrđen nalog i vlasništvo; webhook verifikacija; Play blokira |
| `/api/people/[...path]` | GET, PATCH, PUT, DELETE | `src/server/people-http.ts`, `src/server/community-rules.ts` | Javna dozvoljena čitanja; privatno/izmjene provjeravaju nalog i vlasništvo/owner |
| `/api/public-people/[id]/businesses` | GET | `src/server/public-person-businesses-http.ts` | Javno: samo vidljive djelatnosti javno vidljivog profila |
| `/api/push/[action]` | GET, POST | `src/server/account-http.ts`, `src/server/auth/accounts.ts`, `src/server/auth/service.ts`, `src/server/push/service.ts` | Privatni nalog; identitet/vlasništvo i origin na izmjenama u handleru/servisu |
| `/api/reels/[...path]` | POST, PUT, GET, HEAD | `src/lib/business-today.ts`, `src/lib/distribution.ts`, `src/lib/reels.ts`, `src/server/account-blocks.ts`, `src/server/auth/accounts.ts`, `src/server/auth/config.ts`, `src/server/community-rules.ts`, `src/server/flat-json.ts`, `src/server/reels/engagement.ts`, `src/server/reels/range.ts`, `src/server/reels/service.ts` | Javna dozvoljena čitanja; privatno/izmjene provjeravaju nalog i vlasništvo/owner |
| `/api/rentals/[...path]` | GET, POST | `src/server/rentals-http.ts`, `src/server/community-rules.ts` | Javna dozvoljena čitanja; privatno/izmjene provjeravaju nalog i vlasništvo/owner |
| `/api/reviews/[...path]` | GET, PUT, POST | `src/server/reviews-http.ts`, `src/server/community-rules.ts` | Javna dozvoljena čitanja; privatno/izmjene provjeravaju nalog i vlasništvo/owner |
| `/api/stays/[...path]` | GET, POST | `src/server/stays-http.ts`, `src/server/community-rules.ts` | Javna dozvoljena čitanja; privatno/izmjene provjeravaju nalog i vlasništvo/owner |
| `/api/wallet/bank-topups/[[...path]]` |  | `src/server/wallet/bank-http.ts` | Privatni nalog; identitet/vlasništvo i origin na izmjenama u handleru/servisu |
| `/store-unavailable` |  | Samostalan response u route.ts | Javno; bez korisničkih izmjena |

Detaljni nastavci catch-all ruta se parsiraju u navedenim `*-http.ts` / `http.ts` modulima. Privatni servisi izvode provjeru sesije i svježeg prava pristupa; mutacije uglavnom vežu `X-AhiBizz-Account-ID`, origin, format i veličinu tijela. Postojanje guard koda nije zamjena za integracijski test izolovanom bazom. Povratak iz platnog servisa nije dokaz uspješne uplate: stanje potvrđuje server.

## Elementi po stranici

Svaki ID upućuje na tačan red u katalogu niže. Zajedničke kontrole namjerno su uključene uz svaku stranicu jer korisnik može kliknuti navigaciju, postavke dozvola i brzi meni s te stranice. Statičko praćenje importa je nadskup: posebni simulator i React uslovi mogu kontrolu učiniti neaktivnom/nevidljivom.

### /administracija/blog

Izvor: `src/app/(public)/administracija/blog/page.tsx`. Odobren, potvrđen nalog role owner; ostali preusmjereni/404.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/app/(public)/administracija/blog/page.tsx` | I0001–I0005 |
| `src/components/content-hub/ArticleEditor.tsx` | I0486–I0497 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /administracija/emailovi

Izvor: `src/app/(public)/administracija/emailovi/page.tsx`. Odobren, potvrđen nalog role owner; ostali preusmjereni/404.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/app/(public)/administracija/emailovi/page.tsx` | I0006–I0013 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /administracija/izgled

Izvor: `src/app/(public)/administracija/izgled/page.tsx`. Odobren, potvrđen nalog role owner; ostali preusmjereni/404.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/app/(public)/administracija/izgled/page.tsx` | I0014 |
| `src/components/design/VisualDesigner.tsx` | I0537–I0554 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/design/DesignInspector.tsx` | I0518–I0530 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /administracija/izgled/pregled

Izvor: `src/app/(public)/administracija/izgled/pregled/page.tsx`. Odobren, potvrđen nalog role owner; ostali preusmjereni/404.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/design/SimulatorScreens.tsx` | I0531–I0536 |
| `src/components/account/AccountOverview.tsx` | I0140–I0147 |
| `src/components/account/BusinessToday.tsx` | I0191–I0196 |
| `src/components/account/NextAppointmentCard.tsx` | I0197–I0198 |
| `src/components/admin/AccountApprovals.tsx` | I0201–I0210 |
| `src/components/admin/ProfileVerification.tsx` | I0242–I0250 |
| `src/components/auth/AuthForm.tsx` | I0251–I0268 |
| `src/components/booking/PublicBooking.tsx` | I0435–I0444 |
| `src/components/booking/CalendarDays.tsx` | I0421–I0423 |
| `src/components/directory/DirectoryResultCard.tsx` | I0652–I0656 |
| `src/components/favorites/FavoriteButton.tsx` | I0696–I0698 |
| `src/components/directory/DirectorySearchForm.tsx` | I0657–I0664 |
| `src/components/directory/PublicBusinessProfile.tsx` | I0673–I0695 |
| `src/components/reviews/BusinessReviews.tsx` | I1028–I1037 |
| `src/components/support/CommunityRulesPrompt.tsx` | I1083–I1086 |
| `src/components/directory/BusinessGallery.tsx` | I0586–I0591 |
| `src/components/home/HomeSurface.tsx` | I0722–I0728 |
| `src/components/home/HomeCategories.tsx` | I0707–I0708 |
| `src/components/messaging/MessagingInbox.tsx` | I0865–I0888 |
| `src/components/people/PersonalProfileCard.tsx` | I0889–I0892 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/lib/booking-client.ts`: `'/api/booking/${path}'`, `/api/account`.
- `src/lib/business-media-client.ts`: `'/api/business-media/${path}'`.
- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/connections.ts`: `'/api/connections/people/${encodeURIComponent(person.id)}/media/${kind}?v=${mediaVersion}'`.
- `src/lib/people.ts`: `'/api/people/me/media/${kind}?v=${version}&accountId=${encodeURIComponent(profile.id)}'`.
- `src/lib/connections-client.ts`: `'/api/connections/${path}'`.
- `src/lib/people-client.ts`: `'/api/people/${path}'`.
- `src/lib/messaging-client.ts`: `'/api/messaging/${path}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/components/account/AccountOverview.tsx`: `/api/account/memberships`, `/api/account/overview`, `/api/account/placements`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `src/components/account/BusinessToday.tsx`: `'/api/account/business-today${choice ? '?djelatnost=${choice}' : ""}'`.
- `src/components/admin/AccountApprovals.tsx`: `'/api/admin/accounts/${encodeURIComponent(target.id)}'`.
- `src/lib/admin-accounts.ts`: `'/api/admin/accounts?${params}'`.
- `src/components/admin/ProfileVerification.tsx`: `'/api/admin/verification/${kind}/${encodeURIComponent(id)}'`.
- `src/components/auth/AuthForm.tsx`: `/api/auth/sign-in/email`, `/api/auth/sign-up/email`, `/api/auth/request-password-reset`, `/api/auth/reset-password`, `/api/auth/send-verification-email`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/components/reviews/BusinessReviews.tsx`: `'/api/connections/people/${encodeURIComponent(review.author.id)}/media/photo?v=${review.author.photoVersion}'`.
- `src/lib/reviews.ts`: `'/api/reviews/admin${path}'`, `'/api/reviews${path}'`.
- `src/components/support/CommunityRulesPrompt.tsx`: `/api/community-rules`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /administracija/lokacije

Izvor: `src/app/(public)/administracija/lokacije/page.tsx`. Odobren, potvrđen nalog role owner; ostali preusmjereni/404.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/app/(public)/administracija/lokacije/page.tsx` | I0015 |
| `src/components/admin/BusinessLocationBatch.tsx` | I0230–I0234 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/lib/business-location-batch.ts`: `'/api/directory/mine/${uuid(id)}'`, `/api/account`.
- `src/lib/business-import-client.ts`: `'/api/directory/mine/${uuid(id)}'`, `/api/account`, `/api/directory/categories`, `'/api/directory/admin?page=${page}${archived ? "&status=archived" : ""}'`, `/api/directory/mine`, `'/api/business-media/mine/${uuid(id)}'`, `'/api/business-media/mine/${uuid(id)}/logo/0'`.
- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /administracija/oglasi

Izvor: `src/app/(public)/administracija/oglasi/page.tsx`. Odobren, potvrđen nalog role owner; ostali preusmjereni/404.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/app/(public)/administracija/oglasi/page.tsx` | I0016 |
| `src/components/marketing/MarketingWorkspace.tsx` | I0821–I0864 |
| `src/components/marketing/AdCampaignForm.tsx` | I0731–I0752 |
| `src/components/marketing/CampaignGeoTime.tsx` | I0802–I0810 |
| `src/components/marketing/AdCreativeManager.tsx` | I0753–I0757 |
| `src/components/marketing/AdCampaignAsset.tsx` | I0729–I0730 |
| `src/components/marketing/AdRateEditor.tsx` | I0767–I0783 |
| `src/components/marketing/CreditBankTransfers.tsx` | I0811–I0820 |
| `src/components/support/CopyPaymentDetails.tsx` | I1087–I1088 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/components/marketing/MarketingWorkspace.tsx`: `'/api/marketing?${params}'`, `/api/marketing`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/components/marketing/AdCreativeManager.tsx`: `/api/marketing/creative/`.
- `src/lib/ad-asset.ts`: `'/api/marketing/creative/${encodeURIComponent(id)}?v=${version}'`.
- `src/components/marketing/AdRateEditor.tsx`: `/api/marketing/rates`.
- `src/components/marketing/CreditBankTransfers.tsx`: `/api/wallet/bank-topups`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /administracija

Izvor: `src/app/(public)/administracija/page.tsx`. Odobren, potvrđen nalog role owner; ostali preusmjereni/404.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/app/(public)/administracija/page.tsx` | I0017 |
| `src/components/admin/AdminDashboard.tsx` | I0211–I0221 |
| `src/components/billing/BillingAdmin.tsx` | I0271–I0280 |
| `src/components/billing/PackageSetup.tsx` | I0348 |
| `src/components/billing/PackageBenefitsEditor.tsx` | I0316–I0321 |
| `src/components/billing/PackageSettlements.tsx` | I0345–I0347 |
| `src/components/billing/ReceiptForm.tsx` | I0357–I0377 |
| `src/components/directory/BusinessManager.tsx` | I0592–I0636 |
| `src/components/admin/ProfileVerification.tsx` | I0242–I0250 |
| `src/components/booking/BusinessBookingManager.tsx` | I0379–I0420 |
| `src/components/rentals/RentalFleet.tsx` | I1002–I1025 |
| `src/components/rentals/RentalCalendar.tsx` | I0987–I0997 |
| `src/components/rentals/RentalEntries.tsx` | I0998–I1001 |
| `src/components/rentals/RentalRecovery.tsx` | I1026–I1027 |
| `src/components/stays/StayUnits.tsx` | I1064–I1082 |
| `src/components/directory/BusinessMediaManager.tsx` | I0637–I0644 |
| `src/components/stays/StayCalendar.tsx` | I1047–I1059 |
| `src/components/stays/StayEntries.tsx` | I1060–I1063 |
| `src/components/directory/BusinessChanges.tsx` | I0555 |
| `src/components/directory/BusinessDeleteAction.tsx` | I0556–I0558 |
| `src/components/directory/BusinessDetailsManager.tsx` | I0559–I0569 |
| `src/components/directory/BusinessEditor.tsx` | I0570–I0585 |
| `src/components/directory/LocationPicker.tsx` | I0665–I0672 |
| `src/components/directory/BusinessOwnershipManager.tsx` | I0645–I0651 |
| `src/components/reviews/ReviewsAdmin.tsx` | I1038–I1046 |
| `src/components/admin/AccountApprovals.tsx` | I0201–I0210 |
| `src/components/admin/AdminToday.tsx` | I0222–I0223 |
| `src/components/admin/CategoryManager.tsx` | I0235–I0241 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `src/components/billing/PackageSetup.tsx`: `/api/paketi/catalog`, `/api/paketi/admin/setup`.
- `src/components/billing/PackageBenefitsEditor.tsx`: `/api/paketi/admin/benefits`.
- `src/components/billing/PackageSettlements.tsx`: `'/api/paketi/admin/settlements/${reviewOnly ? "review/" : ""}${page}'`.
- `src/lib/booking-client.ts`: `'/api/booking/${path}'`, `/api/account`.
- `src/lib/business-details-client.ts`: `'/api/business-details/mine/${id}'`.
- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/business-media-client.ts`: `'/api/business-media/${path}'`.
- `src/lib/business-ownership-client.ts`: `'/api/directory/ownership/${id}${tail}'`.
- `src/lib/directory-client.ts`: `'/api/directory/${path}'`.
- `src/components/admin/ProfileVerification.tsx`: `'/api/admin/verification/${kind}/${encodeURIComponent(id)}'`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/components/rentals/rental-client.ts`: `'/api/rentals/${path}'`.
- `src/components/stays/stay-client.ts`: `'/api/stays/${path}'`.
- `src/lib/people.ts`: `'/api/people/me/media/${kind}?v=${version}&accountId=${encodeURIComponent(profile.id)}'`.
- `src/lib/geocoding.ts`: `'/api/?${new URLSearchParams({ q, limit: "5" })}'`.
- `src/lib/reviews.ts`: `'/api/reviews/admin${path}'`, `'/api/reviews${path}'`.
- `src/components/admin/AccountApprovals.tsx`: `'/api/admin/accounts/${encodeURIComponent(target.id)}'`.
- `src/lib/admin-accounts.ts`: `'/api/admin/accounts?${params}'`.
- `src/components/admin/AdminToday.tsx`: `/api/admin/today`.
- `src/components/admin/CategoryManager.tsx`: `/api/account`, `/api/directory/categories`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /administracija/reels

Izvor: `src/app/(public)/administracija/reels/page.tsx`. Odobren, potvrđen nalog role owner; ostali preusmjereni/404.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/app/(public)/administracija/reels/page.tsx` | I0018–I0020 |
| `src/components/reels/ReelManager.tsx` | I0953–I0970 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/components/reels/ReelManager.tsx`: `'/api/reels/${path}'`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/lib/reels.ts`: `'/api/reels/media/${id}/${kind}${preview ? "?pregled=1" : ""}'`.
- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /administracija/uvoz-prijava

Izvor: `src/app/(public)/administracija/uvoz-prijava/page.tsx`. Odobren, potvrđen nalog role owner; ostali preusmjereni/404.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/app/(public)/administracija/uvoz-prijava/page.tsx` | I0021 |
| `src/components/admin/BusinessImport.tsx` | I0224–I0229 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/lib/business-import-client.ts`: `'/api/directory/mine/${uuid(id)}'`, `/api/account`, `/api/directory/categories`, `'/api/directory/admin?page=${page}${archived ? "&status=archived" : ""}'`, `/api/directory/mine`, `'/api/business-media/mine/${uuid(id)}'`, `'/api/business-media/mine/${uuid(id)}/logo/0'`.
- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /administracija/zahtjevi

Izvor: `src/app/(public)/administracija/zahtjevi/page.tsx`. Odobren, potvrđen nalog role owner; ostali preusmjereni/404.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/app/(public)/administracija/zahtjevi/page.tsx` | I0022–I0035 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/lib/reels.ts`: `'/api/reels/media/${id}/${kind}${preview ? "?pregled=1" : ""}'`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /blog/[slug]

Izvor: `src/app/(public)/blog/[slug]/page.tsx`. Javno; privatne radnje zahtijevaju nalog.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/app/(public)/blog/[slug]/page.tsx` | I0036–I0039 |
| `src/components/content-hub/BookmarkForm.tsx` | I0498–I0502 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /blog

Izvor: `src/app/(public)/blog/page.tsx`. Javno; privatne radnje zahtijevaju nalog.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/app/(public)/blog/page.tsx` | I0040–I0050 |
| `src/components/content-hub/ArticleCard.tsx` | I0484–I0485 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /blokirani-korisnici

Izvor: `src/app/(public)/blokirani-korisnici/page.tsx`. Odobren, potvrđen član/owner; gost na prijavu.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/components/account/BlockedPeople.tsx` | I0183–I0190 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /brisanje-naloga

Izvor: `src/app/(public)/brisanje-naloga/page.tsx`. Javno; privatne radnje zahtijevaju nalog.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/components/support/RequestScreen.tsx` | I1096–I1099 |
| `src/components/support/RequestForm.tsx` | I1089–I1095 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/lib/reels.ts`: `'/api/reels/media/${id}/${kind}${preview ? "?pregled=1" : ""}'`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /djelatnosti/[id]

Izvor: `src/app/(public)/djelatnosti/[id]/page.tsx`. Javno; privatne radnje zahtijevaju nalog.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/app/(public)/djelatnosti/[id]/page.tsx` | I0052–I0053 |
| `src/components/booking/PublicBooking.tsx` | I0435–I0444 |
| `src/components/booking/CalendarDays.tsx` | I0421–I0423 |
| `src/components/directory/PublicBusinessProfile.tsx` | I0673–I0695 |
| `src/components/favorites/FavoriteButton.tsx` | I0696–I0698 |
| `src/components/reviews/BusinessReviews.tsx` | I1028–I1037 |
| `src/components/support/CommunityRulesPrompt.tsx` | I1083–I1086 |
| `src/components/directory/BusinessGallery.tsx` | I0586–I0591 |
| `src/components/marketing/CampaignAd.tsx` | I0796–I0801 |
| `src/components/marketing/AdCampaignAsset.tsx` | I0729–I0730 |
| `src/components/marketing/AdResponse.tsx` | I0784–I0795 |
| `src/components/reels/ReelShelf.tsx` | I0971–I0972 |
| `src/components/rentals/RentalFleet.tsx` | I1002–I1025 |
| `src/components/rentals/RentalCalendar.tsx` | I0987–I0997 |
| `src/components/rentals/RentalEntries.tsx` | I0998–I1001 |
| `src/components/rentals/RentalRecovery.tsx` | I1026–I1027 |
| `src/components/stays/StayUnits.tsx` | I1064–I1082 |
| `src/components/directory/BusinessMediaManager.tsx` | I0637–I0644 |
| `src/components/stays/StayCalendar.tsx` | I1047–I1059 |
| `src/components/stays/StayEntries.tsx` | I1060–I1063 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/lib/booking-client.ts`: `'/api/booking/${path}'`, `/api/account`.
- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/components/reviews/BusinessReviews.tsx`: `'/api/connections/people/${encodeURIComponent(review.author.id)}/media/photo?v=${review.author.photoVersion}'`.
- `src/lib/reviews.ts`: `'/api/reviews/admin${path}'`, `'/api/reviews${path}'`.
- `src/components/support/CommunityRulesPrompt.tsx`: `/api/community-rules`.
- `src/components/marketing/CampaignAd.tsx`: `/api/marketing/events`.
- `src/lib/ad-asset.ts`: `'/api/marketing/creative/${encodeURIComponent(id)}?v=${version}'`.
- `src/components/marketing/AdResponse.tsx`: `/api/account`, `/api/marketing/inquiry`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `src/lib/reels.ts`: `'/api/reels/media/${id}/${kind}${preview ? "?pregled=1" : ""}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/components/rentals/rental-client.ts`: `'/api/rentals/${path}'`.
- `src/lib/business-media-client.ts`: `'/api/business-media/${path}'`.
- `src/components/stays/stay-client.ts`: `'/api/stays/${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /instaliraj

Izvor: `src/app/(public)/instaliraj/page.tsx`. Javno; privatne radnje zahtijevaju nalog.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/components/pwa/InstallPage.tsx` | I0948–I0952 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /ljudi/[id]

Izvor: `src/app/(public)/ljudi/[id]/page.tsx`. Javno; privatne radnje zahtijevaju nalog.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/components/connections/PublicPersonProfile.tsx` | I0471–I0483 |
| `src/components/people/PersonalProfileCard.tsx` | I0889–I0892 |
| `src/components/connections/PeopleSearch.tsx` | I0457–I0463 |
| `src/components/connections/ProfileBlockAction.tsx` | I0464–I0467 |
| `src/components/connections/PublicPersonBusinesses.tsx` | I0468–I0470 |
| `src/components/directory/DirectoryResultCard.tsx` | I0652–I0656 |
| `src/components/favorites/FavoriteButton.tsx` | I0696–I0698 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/lib/connections.ts`: `'/api/connections/people/${encodeURIComponent(person.id)}/media/${kind}?v=${mediaVersion}'`.
- `src/lib/people.ts`: `'/api/people/me/media/${kind}?v=${version}&accountId=${encodeURIComponent(profile.id)}'`.
- `src/lib/connections-client.ts`: `'/api/connections/${path}'`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/lib/person-businesses.ts`: `'/api/public-people/${encodeURIComponent(personId)}/businesses?page=${page}'`.
- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /ljudi

Izvor: `src/app/(public)/ljudi/page.tsx`. Javno; privatne radnje zahtijevaju nalog.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/components/connections/PeopleSearch.tsx` | I0457–I0463 |
| `src/components/people/PersonalProfileCard.tsx` | I0889–I0892 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/lib/connections.ts`: `'/api/connections/people/${encodeURIComponent(person.id)}/media/${kind}?v=${mediaVersion}'`.
- `src/lib/people.ts`: `'/api/people/me/media/${kind}?v=${version}&accountId=${encodeURIComponent(profile.id)}'`.
- `src/lib/connections-client.ts`: `'/api/connections/${path}'`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /nalog/obavijesti

Izvor: `src/app/(public)/nalog/obavijesti/page.tsx`. Odobren, potvrđen član/owner; gost na prijavu.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/app/(public)/nalog/obavijesti/page.tsx` | I0054–I0061 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /nalog

Izvor: `src/app/(public)/nalog/page.tsx`. Odobren, potvrđen član/owner; gost na prijavu.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/app/(public)/nalog/page.tsx` | I0062 |
| `src/components/account/AccountDashboard.tsx` | I0134–I0139 |
| `src/components/favorites/SavedBusinesses.tsx` | I0699–I0702 |
| `src/components/directory/DirectoryResultCard.tsx` | I0652–I0656 |
| `src/components/favorites/FavoriteButton.tsx` | I0696–I0698 |
| `src/components/people/PersonalProfileWorkspace.tsx` | I0909–I0911 |
| `src/components/people/PersonalProfileCard.tsx` | I0889–I0892 |
| `src/components/people/PersonalProfileEditor.tsx` | I0893–I0908 |
| `src/components/support/CommunityRulesPrompt.tsx` | I1083–I1086 |
| `src/components/account/AccountAuthorityBoundary.tsx` | I0132–I0133 |
| `src/components/account/AccountOverview.tsx` | I0140–I0147 |
| `src/components/account/BusinessToday.tsx` | I0191–I0196 |
| `src/components/account/NextAppointmentCard.tsx` | I0197–I0198 |
| `src/components/account/AccountSettings.tsx` | I0165–I0174 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/account/AccountPassword.tsx` | I0148–I0155 |
| `src/components/account/AdPreference.tsx` | I0175–I0178 |
| `src/components/account/AudienceSettings.tsx` | I0179–I0182 |
| `src/components/account/OwnerCalendarPanel.tsx` | I0199–I0200 |
| `src/components/booking/BusinessBookingManager.tsx` | I0379–I0420 |
| `src/components/rentals/RentalFleet.tsx` | I1002–I1025 |
| `src/components/rentals/RentalCalendar.tsx` | I0987–I0997 |
| `src/components/rentals/RentalEntries.tsx` | I0998–I1001 |
| `src/components/rentals/RentalRecovery.tsx` | I1026–I1027 |
| `src/components/stays/StayUnits.tsx` | I1064–I1082 |
| `src/components/directory/BusinessMediaManager.tsx` | I0637–I0644 |
| `src/components/stays/StayCalendar.tsx` | I1047–I1059 |
| `src/components/stays/StayEntries.tsx` | I1060–I1063 |
| `src/components/directory/BusinessManager.tsx` | I0592–I0636 |
| `src/components/admin/ProfileVerification.tsx` | I0242–I0250 |
| `src/components/directory/BusinessChanges.tsx` | I0555 |
| `src/components/directory/BusinessDeleteAction.tsx` | I0556–I0558 |
| `src/components/directory/BusinessDetailsManager.tsx` | I0559–I0569 |
| `src/components/directory/BusinessEditor.tsx` | I0570–I0585 |
| `src/components/directory/LocationPicker.tsx` | I0665–I0672 |
| `src/components/directory/BusinessOwnershipManager.tsx` | I0645–I0651 |
| `src/components/messaging/MessagingInbox.tsx` | I0865–I0888 |
| `src/components/booking/CustomerAppointments.tsx` | I0424–I0430 |
| `src/components/booking/InventoryAppointments.tsx` | I0431–I0434 |
| `src/components/connections/ConnectionsPanel.tsx` | I0445–I0456 |
| `src/components/connections/PeopleSearch.tsx` | I0457–I0463 |
| `src/components/marketing/MarketingWorkspace.tsx` | I0821–I0864 |
| `src/components/marketing/AdCampaignForm.tsx` | I0731–I0752 |
| `src/components/marketing/CampaignGeoTime.tsx` | I0802–I0810 |
| `src/components/marketing/AdCreativeManager.tsx` | I0753–I0757 |
| `src/components/marketing/AdCampaignAsset.tsx` | I0729–I0730 |
| `src/components/marketing/AdRateEditor.tsx` | I0767–I0783 |
| `src/components/marketing/CreditBankTransfers.tsx` | I0811–I0820 |
| `src/components/support/CopyPaymentDetails.tsx` | I1087–I1088 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/components/account/AccountDashboard.tsx`: `/api/auth/sign-out`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/lib/people.ts`: `'/api/people/me/media/${kind}?v=${version}&accountId=${encodeURIComponent(profile.id)}'`.
- `src/components/favorites/SavedBusinesses.tsx`: `/api/directory/categories`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/connections.ts`: `'/api/connections/people/${encodeURIComponent(person.id)}/media/${kind}?v=${mediaVersion}'`.
- `src/lib/connections-client.ts`: `'/api/connections/${path}'`.
- `src/lib/people-client.ts`: `'/api/people/${path}'`.
- `src/components/support/CommunityRulesPrompt.tsx`: `/api/community-rules`.
- `src/lib/account-settings.ts`: `/api/account`.
- `src/lib/admin-accounts.ts`: `'/api/admin/accounts?${params}'`.
- `src/components/account/AccountOverview.tsx`: `/api/account/memberships`, `/api/account/overview`, `/api/account/placements`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `src/components/account/BusinessToday.tsx`: `'/api/account/business-today${choice ? '?djelatnost=${choice}' : ""}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/components/account/AccountPassword.tsx`: `/api/account/password`.
- `src/components/account/AdPreference.tsx`: `/api/account/ad-preference`.
- `src/components/account/AudienceSettings.tsx`: `/api/account/audience-sample`.
- `src/lib/directory-client.ts`: `'/api/directory/${path}'`.
- `src/lib/booking-client.ts`: `'/api/booking/${path}'`, `/api/account`.
- `src/components/rentals/rental-client.ts`: `'/api/rentals/${path}'`.
- `src/lib/business-media-client.ts`: `'/api/business-media/${path}'`.
- `src/components/stays/stay-client.ts`: `'/api/stays/${path}'`.
- `src/lib/business-details-client.ts`: `'/api/business-details/mine/${id}'`.
- `src/lib/business-ownership-client.ts`: `'/api/directory/ownership/${id}${tail}'`.
- `src/components/admin/ProfileVerification.tsx`: `'/api/admin/verification/${kind}/${encodeURIComponent(id)}'`.
- `src/lib/geocoding.ts`: `'/api/?${new URLSearchParams({ q, limit: "5" })}'`.
- `src/lib/messaging-client.ts`: `'/api/messaging/${path}'`.
- `src/components/marketing/MarketingWorkspace.tsx`: `'/api/marketing?${params}'`, `/api/marketing`.
- `src/components/marketing/AdCreativeManager.tsx`: `/api/marketing/creative/`.
- `src/lib/ad-asset.ts`: `'/api/marketing/creative/${encodeURIComponent(id)}?v=${version}'`.
- `src/components/marketing/AdRateEditor.tsx`: `/api/marketing/rates`.
- `src/components/marketing/CreditBankTransfers.tsx`: `/api/wallet/bank-topups`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /nalog/reels

Izvor: `src/app/(public)/nalog/reels/page.tsx`. Odobren, potvrđen član/owner; gost na prijavu.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/app/(public)/nalog/reels/page.tsx` | I0063–I0065 |
| `src/components/reels/ReelManager.tsx` | I0953–I0970 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/components/reels/ReelManager.tsx`: `'/api/reels/${path}'`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/lib/reels.ts`: `'/api/reels/media/${id}/${kind}${preview ? "?pregled=1" : ""}'`.
- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /naplata/odustajanje

Izvor: `src/app/(public)/naplata/odustajanje/page.tsx`. Stranica čitljiva; naredbe zahtijevaju nalog i vlasništvo, Play blokira.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/components/billing/Checkout.tsx` | I0281–I0315 |
| `src/components/billing/PayPalCardButton.tsx` | I0349 |
| `src/components/billing/AdvancedCardForm.tsx` | I0269–I0270 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/components/billing/Checkout.tsx`: `'/api/checkout/${path}'`, `/api/checkout/catalog`, `/api/marketing?mode=credits&page=0`, `'/api/directory/mine?page=${page}&pageSize=50&status=published'`, `'/api/marketing?offer=${quoteId}'`, `/api/marketing`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/lib/checkout-order-read.ts`: `'/api/checkout/orders/${encodeURIComponent(id)}'`.
- `src/components/billing/PayPalCardButton.tsx`: `'/api/checkout/${path}'`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /naplata

Izvor: `src/app/(public)/naplata/page.tsx`. Stranica čitljiva; naredbe zahtijevaju nalog i vlasništvo, Play blokira.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/components/billing/Checkout.tsx` | I0281–I0315 |
| `src/components/billing/PayPalCardButton.tsx` | I0349 |
| `src/components/billing/AdvancedCardForm.tsx` | I0269–I0270 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/components/billing/Checkout.tsx`: `'/api/checkout/${path}'`, `/api/checkout/catalog`, `/api/marketing?mode=credits&page=0`, `'/api/directory/mine?page=${page}&pageSize=50&status=published'`, `'/api/marketing?offer=${quoteId}'`, `/api/marketing`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/lib/checkout-order-read.ts`: `'/api/checkout/orders/${encodeURIComponent(id)}'`.
- `src/components/billing/PayPalCardButton.tsx`: `'/api/checkout/${path}'`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /naplata/povratak

Izvor: `src/app/(public)/naplata/povratak/page.tsx`. Stranica čitljiva; naredbe zahtijevaju nalog i vlasništvo, Play blokira.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/components/billing/Checkout.tsx` | I0281–I0315 |
| `src/components/billing/PayPalCardButton.tsx` | I0349 |
| `src/components/billing/AdvancedCardForm.tsx` | I0269–I0270 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/components/billing/Checkout.tsx`: `'/api/checkout/${path}'`, `/api/checkout/catalog`, `/api/marketing?mode=credits&page=0`, `'/api/directory/mine?page=${page}&pageSize=50&status=published'`, `'/api/marketing?offer=${quoteId}'`, `/api/marketing`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/lib/checkout-order-read.ts`: `'/api/checkout/orders/${encodeURIComponent(id)}'`.
- `src/components/billing/PayPalCardButton.tsx`: `'/api/checkout/${path}'`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /nova-lozinka

Izvor: `src/app/(public)/nova-lozinka/page.tsx`. Javno; privatne radnje zahtijevaju nalog.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/components/auth/AuthForm.tsx` | I0251–I0268 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/components/auth/AuthForm.tsx`: `/api/auth/sign-in/email`, `/api/auth/sign-up/email`, `/api/auth/request-password-reset`, `/api/auth/reset-password`, `/api/auth/send-verification-email`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /o-nama

Izvor: `src/app/(public)/o-nama/page.tsx`. Javno; privatne radnje zahtijevaju nalog.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/app/(public)/o-nama/page.tsx` | I0066–I0067 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /oglasavanje

Izvor: `src/app/(public)/oglasavanje/page.tsx`. Javno; privatne radnje zahtijevaju nalog.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/app/(public)/oglasavanje/page.tsx` | I0068–I0082 |
| `src/components/marketing/AdExplorer.tsx` | I0758–I0766 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /

Izvor: `src/app/(public)/page.tsx`. Javno; privatne radnje zahtijevaju nalog.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/components/directory/DirectoryResultCard.tsx` | I0652–I0656 |
| `src/components/favorites/FavoriteButton.tsx` | I0696–I0698 |
| `src/components/home/HomeCategories.tsx` | I0707–I0708 |
| `src/components/home/HomeFeaturedRail.tsx` | I0709 |
| `src/components/home/HomeSurface.tsx` | I0722–I0728 |
| `src/components/home/HomeNearby.tsx` | I0710–I0721 |
| `src/components/marketing/CampaignAd.tsx` | I0796–I0801 |
| `src/components/marketing/AdCampaignAsset.tsx` | I0729–I0730 |
| `src/components/marketing/AdResponse.tsx` | I0784–I0795 |
| `src/components/reels/ReelShelf.tsx` | I0971–I0972 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/components/home/HomeFeaturedRail.tsx`: `'/api/directory/businesses?istaknute=sve&page=${next}'`.
- `src/lib/home-nearby.ts`: `'/api/directory/businesses?${new URLSearchParams({ latitude: String(query.latitude), longitude: String(query.longitude), radiusKm: String(nearbyRadiusKm), })}'`.
- `src/lib/reviews.ts`: `'/api/reviews/admin${path}'`, `'/api/reviews${path}'`.
- `src/components/marketing/CampaignAd.tsx`: `/api/marketing/events`.
- `src/lib/ad-asset.ts`: `'/api/marketing/creative/${encodeURIComponent(id)}?v=${version}'`.
- `src/components/marketing/AdResponse.tsx`: `/api/account`, `/api/marketing/inquiry`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `src/lib/reels.ts`: `'/api/reels/media/${id}/${kind}${preview ? "?pregled=1" : ""}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /paketi

Izvor: `src/app/(public)/paketi/page.tsx`. Javno; privatne radnje zahtijevaju nalog.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/components/billing/PricingCatalog.tsx` | I0350–I0356 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/components/billing/PricingCatalog.tsx`: `/api/paketi/catalog`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /paketi/placanje

Izvor: `src/app/(public)/paketi/placanje/page.tsx`. Stranica čitljiva; naredbe zahtijevaju nalog i vlasništvo, Play blokira.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/components/billing/PackageCheckout.tsx` | I0322–I0344 |
| `src/components/billing/SubscriptionCardButton.tsx` | I0378 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/components/billing/PackageCheckout.tsx`: `'/api/directory/mine?page=${page}&pageSize=50${sandbox ? "&status=published" : ""}'`, `/api/test-paketi`, `/api/paketi`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /podrzi

Izvor: `src/app/(public)/podrzi/page.tsx`. Javno; privatne radnje zahtijevaju nalog.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/components/support/SupportPage.tsx` | I1100–I1104 |
| `src/components/support/CopyPaymentDetails.tsx` | I1087–I1088 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /pomoc

Izvor: `src/app/(public)/pomoc/page.tsx`. Javno; privatne radnje zahtijevaju nalog.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/app/(public)/pomoc/page.tsx` | I0083–I0085 |
| `src/components/content-hub/HelpDesk.tsx` | I0503–I0517 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/lib/reels.ts`: `'/api/reels/media/${id}/${kind}${preview ? "?pregled=1" : ""}'`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /pravila-zajednice

Izvor: `src/app/(public)/pravila-zajednice/page.tsx`. Javno; privatne radnje zahtijevaju nalog.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/app/(public)/pravila-zajednice/page.tsx` | I0086 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /pretraga

Izvor: `src/app/(public)/pretraga/page.tsx`. Javno; privatne radnje zahtijevaju nalog.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/app/(public)/pretraga/page.tsx` | I0087–I0091 |
| `src/components/directory/DirectoryResultCard.tsx` | I0652–I0656 |
| `src/components/favorites/FavoriteButton.tsx` | I0696–I0698 |
| `src/components/directory/DirectorySearchForm.tsx` | I0657–I0664 |
| `src/components/EmptyDirectory.tsx` | I0115 |
| `src/components/favorites/SavedSearches.tsx` | I0703–I0706 |
| `src/components/marketing/CampaignAd.tsx` | I0796–I0801 |
| `src/components/marketing/AdCampaignAsset.tsx` | I0729–I0730 |
| `src/components/marketing/AdResponse.tsx` | I0784–I0795 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/components/favorites/SavedSearches.tsx`: `/api/account/saved-searches`.
- `src/components/marketing/CampaignAd.tsx`: `/api/marketing/events`.
- `src/lib/ad-asset.ts`: `'/api/marketing/creative/${encodeURIComponent(id)}?v=${version}'`.
- `src/components/marketing/AdResponse.tsx`: `/api/account`, `/api/marketing/inquiry`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /prijava

Izvor: `src/app/(public)/prijava/page.tsx`. Javno; privatne radnje zahtijevaju nalog.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/components/auth/AuthForm.tsx` | I0251–I0268 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/components/auth/AuthForm.tsx`: `/api/auth/sign-in/email`, `/api/auth/sign-up/email`, `/api/auth/request-password-reset`, `/api/auth/reset-password`, `/api/auth/send-verification-email`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /prijavi-sadrzaj

Izvor: `src/app/(public)/prijavi-sadrzaj/page.tsx`. Javno; privatne radnje zahtijevaju nalog.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/components/support/RequestScreen.tsx` | I1096–I1099 |
| `src/components/support/RequestForm.tsx` | I1089–I1095 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/lib/reels.ts`: `'/api/reels/media/${id}/${kind}${preview ? "?pregled=1" : ""}'`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /privatnost

Izvor: `src/app/(public)/privatnost/page.tsx`. Javno; privatne radnje zahtijevaju nalog.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/app/(public)/privatnost/page.tsx` | I0092–I0093 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /reels

Izvor: `src/app/(public)/reels/page.tsx`. Javno; privatne radnje zahtijevaju nalog.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/app/(public)/reels/page.tsx` | I0094–I0097 |
| `src/components/reels/ReelShelf.tsx` | I0971–I0972 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/reels.ts`: `'/api/reels/media/${id}/${kind}${preview ? "?pregled=1" : ""}'`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /registracija

Izvor: `src/app/(public)/registracija/page.tsx`. Javno; privatne radnje zahtijevaju nalog.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/components/auth/AuthForm.tsx` | I0251–I0268 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/components/auth/AuthForm.tsx`: `/api/auth/sign-in/email`, `/api/auth/sign-up/email`, `/api/auth/request-password-reset`, `/api/auth/reset-password`, `/api/auth/send-verification-email`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /sacuvane-pretrage

Izvor: `src/app/(public)/sacuvane-pretrage/page.tsx`. Odobren, potvrđen član/owner; gost na prijavu.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/app/(public)/sacuvane-pretrage/page.tsx` | I0098–I0100 |
| `src/components/favorites/SavedSearches.tsx` | I0703–I0706 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/components/favorites/SavedSearches.tsx`: `/api/account/saved-searches`.
- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /zaboravljena-lozinka

Izvor: `src/app/(public)/zaboravljena-lozinka/page.tsx`. Javno; privatne radnje zahtijevaju nalog.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/components/auth/AuthForm.tsx` | I0251–I0268 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/SiteFooter.tsx` | I0117–I0124 |
| `src/components/SiteHeader.tsx` | I0125–I0131 |
| `src/components/account/AccountQuickMenu.tsx` | I0156–I0164 |
| `src/app/layout.tsx` | I0101 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/components/auth/AuthForm.tsx`: `/api/auth/sign-in/email`, `/api/auth/sign-up/email`, `/api/auth/request-password-reset`, `/api/auth/reset-password`, `/api/auth/send-verification-email`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/header-access.ts`: `/api/account/menu`, `/api/account`.
- `src/components/account/AccountQuickMenu.tsx`: `/api/account`, `/api/auth/sign-out`.
- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

### /reels/[id]

Izvor: `src/app/(viewer)/reels/[id]/page.tsx`. Javno; privatne radnje zahtijevaju nalog.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/components/reels/ReelViewer.tsx` | I0973–I0986 |
| `src/app/layout.tsx` | I0101 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/components/reels/ReelViewer.tsx`: `'/api/reels/${path}'`.
- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/reels.ts`: `'/api/reels/media/${id}/${kind}${preview ? "?pregled=1" : ""}'`.
- `src/lib/billing.ts`: `'/api/billing/${path}'`.
- `scripts/ingress-policy.mjs`: `/api/health/live`, `/api/health/ready`.
- `scripts/ingress-evidence.mjs`: `'/api/health/live?ingressProbe=${nonce}'`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.

### /pregled/djelatnost

Izvor: `src/app/pregled/djelatnost/page.tsx`. Javno; demonstracija za uklanjanje.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/app/pregled/djelatnost/page.tsx` | I0107 |
| `src/app/pregled/djelatnost/ProfilePreview.tsx` | I0106 |
| `src/components/directory/PublicBusinessProfile.tsx` | I0673–I0695 |
| `src/components/favorites/FavoriteButton.tsx` | I0696–I0698 |
| `src/components/reviews/BusinessReviews.tsx` | I1028–I1037 |
| `src/components/support/CommunityRulesPrompt.tsx` | I1083–I1086 |
| `src/components/directory/BusinessGallery.tsx` | I0586–I0591 |
| `src/components/booking/PublicBooking.tsx` | I0435–I0444 |
| `src/components/booking/CalendarDays.tsx` | I0421–I0423 |
| `src/components/preview/PreviewShell.tsx` | I0934–I0941 |
| `src/app/layout.tsx` | I0101 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/components/reviews/BusinessReviews.tsx`: `'/api/connections/people/${encodeURIComponent(review.author.id)}/media/photo?v=${review.author.photoVersion}'`.
- `src/lib/reviews.ts`: `'/api/reviews/admin${path}'`, `'/api/reviews${path}'`.
- `src/components/support/CommunityRulesPrompt.tsx`: `/api/community-rules`.
- `src/lib/booking-client.ts`: `'/api/booking/${path}'`, `/api/account`.
- `src/lib/business-media-client.ts`: `'/api/business-media/${path}'`.
- `src/lib/connections.ts`: `'/api/connections/people/${encodeURIComponent(person.id)}/media/${kind}?v=${mediaVersion}'`.
- `src/lib/people.ts`: `'/api/people/me/media/${kind}?v=${version}&accountId=${encodeURIComponent(profile.id)}'`.
- `src/lib/connections-client.ts`: `'/api/connections/${path}'`.
- `src/lib/people-client.ts`: `'/api/people/${path}'`.
- `src/lib/messaging-client.ts`: `'/api/messaging/${path}'`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.

### /pregled/instaliraj

Izvor: `src/app/pregled/instaliraj/page.tsx`. Javno; demonstracija za uklanjanje.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/components/preview/PreviewPwa.tsx` | I0933 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/preview/PreviewShell.tsx` | I0934–I0941 |
| `src/app/layout.tsx` | I0101 |
| `src/components/MobileDock.tsx` | I0116 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/lib/booking-client.ts`: `'/api/booking/${path}'`, `/api/account`.
- `src/lib/business-media-client.ts`: `'/api/business-media/${path}'`.
- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/connections.ts`: `'/api/connections/people/${encodeURIComponent(person.id)}/media/${kind}?v=${mediaVersion}'`.
- `src/lib/people.ts`: `'/api/people/me/media/${kind}?v=${version}&accountId=${encodeURIComponent(profile.id)}'`.
- `src/lib/connections-client.ts`: `'/api/connections/${path}'`.
- `src/lib/people-client.ts`: `'/api/people/${path}'`.
- `src/lib/messaging-client.ts`: `'/api/messaging/${path}'`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.

### /pregled/ljudi

Izvor: `src/app/pregled/ljudi/page.tsx`. Javno; demonstracija za uklanjanje.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/components/connections/PeopleSearch.tsx` | I0457–I0463 |
| `src/components/people/PersonalProfileCard.tsx` | I0889–I0892 |
| `src/components/connections/PublicPersonProfile.tsx` | I0471–I0483 |
| `src/components/connections/ProfileBlockAction.tsx` | I0464–I0467 |
| `src/components/connections/PublicPersonBusinesses.tsx` | I0468–I0470 |
| `src/components/directory/DirectoryResultCard.tsx` | I0652–I0656 |
| `src/components/favorites/FavoriteButton.tsx` | I0696–I0698 |
| `src/components/preview/PreviewShell.tsx` | I0934–I0941 |
| `src/app/layout.tsx` | I0101 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/lib/connections.ts`: `'/api/connections/people/${encodeURIComponent(person.id)}/media/${kind}?v=${mediaVersion}'`.
- `src/lib/people.ts`: `'/api/people/me/media/${kind}?v=${version}&accountId=${encodeURIComponent(profile.id)}'`.
- `src/lib/connections-client.ts`: `'/api/connections/${path}'`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/lib/person-businesses.ts`: `'/api/public-people/${encodeURIComponent(personId)}/businesses?page=${page}'`.
- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/lib/people-client.ts`: `'/api/people/${path}'`.
- `src/lib/booking-client.ts`: `'/api/booking/${path}'`, `/api/account`.
- `src/lib/business-media-client.ts`: `'/api/business-media/${path}'`.
- `src/lib/messaging-client.ts`: `'/api/messaging/${path}'`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.

### /pregled

Izvor: `src/app/pregled/page.tsx`. Javno; demonstracija za uklanjanje.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/components/preview/PreviewHome.tsx` | I0930–I0932 |
| `src/components/home/HomeSurface.tsx` | I0722–I0728 |
| `src/components/home/HomeCategories.tsx` | I0707–I0708 |
| `src/components/preview/BusinessCard.tsx` | I0917–I0918 |
| `src/components/preview/PreviewPwa.tsx` | I0933 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/preview/PreviewShell.tsx` | I0934–I0941 |
| `src/app/layout.tsx` | I0101 |
| `src/components/MobileDock.tsx` | I0116 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/lib/booking-client.ts`: `'/api/booking/${path}'`, `/api/account`.
- `src/lib/business-media-client.ts`: `'/api/business-media/${path}'`.
- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/connections.ts`: `'/api/connections/people/${encodeURIComponent(person.id)}/media/${kind}?v=${mediaVersion}'`.
- `src/lib/people.ts`: `'/api/people/me/media/${kind}?v=${version}&accountId=${encodeURIComponent(profile.id)}'`.
- `src/lib/connections-client.ts`: `'/api/connections/${path}'`.
- `src/lib/people-client.ts`: `'/api/people/${path}'`.
- `src/lib/messaging-client.ts`: `'/api/messaging/${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.

### /pregled/pretraga

Izvor: `src/app/pregled/pretraga/page.tsx`. Javno; demonstracija za uklanjanje.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/app/pregled/pretraga/page.tsx` | I0108–I0114 |
| `src/components/preview/BusinessCard.tsx` | I0917–I0918 |
| `src/components/preview/PreviewShell.tsx` | I0934–I0941 |
| `src/app/layout.tsx` | I0101 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/lib/booking-client.ts`: `'/api/booking/${path}'`, `/api/account`.
- `src/lib/business-media-client.ts`: `'/api/business-media/${path}'`.
- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/connections.ts`: `'/api/connections/people/${encodeURIComponent(person.id)}/media/${kind}?v=${mediaVersion}'`.
- `src/lib/people.ts`: `'/api/people/me/media/${kind}?v=${version}&accountId=${encodeURIComponent(profile.id)}'`.
- `src/lib/connections-client.ts`: `'/api/connections/${path}'`.
- `src/lib/people-client.ts`: `'/api/people/${path}'`.
- `src/lib/messaging-client.ts`: `'/api/messaging/${path}'`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.

### /pregled/prostor/[section]

Izvor: `src/app/pregled/prostor/[section]/page.tsx`. Javno; demonstracija za uklanjanje.

| Fajl s interakcijama | ID kontrole |
|---|---|
| `src/components/preview/AccountPreview.tsx` | I0912–I0916 |
| `src/components/account/AccountSettings.tsx` | I0165–I0174 |
| `src/components/pwa/DevicePush.tsx` | I0944–I0947 |
| `src/components/account/AccountPassword.tsx` | I0148–I0155 |
| `src/components/account/AdPreference.tsx` | I0175–I0178 |
| `src/components/account/AudienceSettings.tsx` | I0179–I0182 |
| `src/components/booking/CustomerAppointments.tsx` | I0424–I0430 |
| `src/components/booking/InventoryAppointments.tsx` | I0431–I0434 |
| `src/components/rentals/RentalEntries.tsx` | I0998–I1001 |
| `src/components/rentals/RentalRecovery.tsx` | I1026–I1027 |
| `src/components/stays/StayEntries.tsx` | I1060–I1063 |
| `src/components/connections/ConnectionsPanel.tsx` | I0445–I0456 |
| `src/components/connections/PeopleSearch.tsx` | I0457–I0463 |
| `src/components/people/PersonalProfileCard.tsx` | I0889–I0892 |
| `src/components/people/PersonalProfileWorkspace.tsx` | I0909–I0911 |
| `src/components/people/PersonalProfileEditor.tsx` | I0893–I0908 |
| `src/components/preview/BusinessCard.tsx` | I0917–I0918 |
| `src/components/preview/BusinessPreview.tsx` | I0919–I0927 |
| `src/components/booking/BusinessBookingManager.tsx` | I0379–I0420 |
| `src/components/directory/BusinessEditor.tsx` | I0570–I0585 |
| `src/components/directory/LocationPicker.tsx` | I0665–I0672 |
| `src/components/directory/BusinessMediaManager.tsx` | I0637–I0644 |
| `src/components/directory/PublicBusinessProfile.tsx` | I0673–I0695 |
| `src/components/favorites/FavoriteButton.tsx` | I0696–I0698 |
| `src/components/reviews/BusinessReviews.tsx` | I1028–I1037 |
| `src/components/support/CommunityRulesPrompt.tsx` | I1083–I1086 |
| `src/components/directory/BusinessGallery.tsx` | I0586–I0591 |
| `src/components/booking/PublicBooking.tsx` | I0435–I0444 |
| `src/components/booking/CalendarDays.tsx` | I0421–I0423 |
| `src/components/preview/MessagingPreview.tsx` | I0928–I0929 |
| `src/components/messaging/MessagingInbox.tsx` | I0865–I0888 |
| `src/components/preview/PreviewShell.tsx` | I0934–I0941 |
| `src/app/layout.tsx` | I0101 |
| `src/components/MobileDock.tsx` | I0116 |
| `src/components/pwa/AppPermissions.tsx` | I0942–I0943 |

API pozivi ovog stabla (pozivi nakon učitavanja i radnji):

- `src/lib/account-settings.ts`: `/api/account`.
- `src/lib/admin-accounts.ts`: `'/api/admin/accounts?${params}'`.
- `src/lib/account-blocks.ts`: `'/api/account/blocks${path}'`.
- `src/components/pwa/DevicePush.tsx`: `'/api/push/${action}'`.
- `src/components/account/AccountPassword.tsx`: `/api/account/password`.
- `src/components/account/AdPreference.tsx`: `/api/account/ad-preference`.
- `src/components/account/AudienceSettings.tsx`: `/api/account/audience-sample`.
- `src/lib/booking-client.ts`: `'/api/booking/${path}'`, `/api/account`.
- `src/components/rentals/rental-client.ts`: `'/api/rentals/${path}'`.
- `src/components/stays/stay-client.ts`: `'/api/stays/${path}'`.
- `src/lib/connections.ts`: `'/api/connections/people/${encodeURIComponent(person.id)}/media/${kind}?v=${mediaVersion}'`.
- `src/lib/people.ts`: `'/api/people/me/media/${kind}?v=${version}&accountId=${encodeURIComponent(profile.id)}'`.
- `src/lib/connections-client.ts`: `'/api/connections/${path}'`.
- `src/lib/people-client.ts`: `'/api/people/${path}'`.
- `src/lib/business-media-client.ts`: `'/api/business-media/${path}'`.
- `src/lib/business-media.ts`: `'/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}'`.
- `src/lib/messaging-client.ts`: `'/api/messaging/${path}'`.
- `src/lib/geocoding.ts`: `'/api/?${new URLSearchParams({ q, limit: "5" })}'`.
- `src/lib/favorites.ts`: `'/api/favorites${path}'`.
- `src/components/reviews/BusinessReviews.tsx`: `'/api/connections/people/${encodeURIComponent(review.author.id)}/media/photo?v=${review.author.photoVersion}'`.
- `src/lib/reviews.ts`: `'/api/reviews/admin${path}'`, `'/api/reviews${path}'`.
- `src/components/support/CommunityRulesPrompt.tsx`: `/api/community-rules`.
- `src/components/account/AudienceNavigation.tsx`: `/api/account/audience-sample`.

## Katalog pojedinačnih kontrola

`href` je navigacija; `on*` je izvršeni handler; input bez handlera se šalje roditeljskom formom ili ima native ponašanje. Upload prepoznaje `type=file` i `accept`. Za handler koji prosljeđuje props pratiti roditelja u popisu konkretne stranice. Linije se odnose na početni snapshot, prije čišćenja.

### src/app/(public)/administracija/blog/page.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0001 | 37 | `Link` | `href="/administracija"` |
| I0002 | 45 | `Link` | `href={'${route}#uredi'}` |
| I0003 | 49 | `Link` | `href={'${route}?uredi=${article.slug}&strana=${page}#uredi'}` |
| I0004 | 65 | `Link` | `href={'${route}?strana=${page - 1}'}` |
| I0005 | 70 | `Link` | `href={'${route}?strana=${page + 1}'}` |

### src/app/(public)/administracija/emailovi/page.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0006 | 38 | `Link` | `href={login}` |
| I0007 | 55 | `Link` | `href="/administracija"` |
| I0008 | 62 | `select` | `name="primjer"`; `id="mail-example"` |
| I0009 | 75 | `button` | `type="submit"` |
| I0010 | 92 | `input` | `type="radio"`; `name="device"`; `value="desktop"` |
| I0011 | 96 | `input` | `type="radio"`; `name="device"`; `value="phone"` |
| I0012 | 101 | `iframe` | `title={'Pregled emaila · ${email.subject}'}` |
| I0013 | 110 | `summary` | Native/roditeljska interakcija; vidi izvor |

### src/app/(public)/administracija/izgled/page.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0014 | 25 | `Link` | `href="/administracija"` |

### src/app/(public)/administracija/lokacije/page.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0015 | 27 | `Link` | `href={login}` |

### src/app/(public)/administracija/oglasi/page.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0016 | 26 | `Link` | `href="/administracija"` |

### src/app/(public)/administracija/page.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0017 | 35 | `Link` | `href={loginPath}` |

### src/app/(public)/administracija/reels/page.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0018 | 30 | `Link` | `href="/administracija"` |
| I0019 | 50 | `Link` | `href={'/administracija/reels?stranica=${page - 1}'}` |
| I0020 | 52 | `Link` | `href={'/administracija/reels?stranica=${page + 1}'}` |

### src/app/(public)/administracija/uvoz-prijava/page.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0021 | 28 | `Link` | `href={login}` |

### src/app/(public)/administracija/zahtjevi/page.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0022 | 89 | `Link` | `href="/administracija"` |
| I0023 | 113 | `summary` | Native/roditeljska interakcija; vidi izvor |
| I0024 | 118 | `form` | `action={eraseAccount}` |
| I0025 | 119 | `input` | `type="hidden"`; `name="operator"`; `value={data.operatorId}` |
| I0026 | 120 | `input` | `type="hidden"`; `name="request"`; `value={item.id}` |
| I0027 | 123 | `input` | `type="email"`; `name="confirmation"` |
| I0028 | 131 | `button` | `type="submit"` |
| I0029 | 154 | `Link` | `href={reelPath(item.reference)}` |
| I0030 | 157 | `a` | `href={'mailto:${encodeURIComponent(item.email).replace("%40", "@")}?subject=Zahtjev%20AhiBizz'}` |
| I0031 | 163 | `form` | `action={closeReport}` |
| I0032 | 164 | `input` | `type="hidden"`; `name="id"`; `value={item.id}` |
| I0033 | 165 | `button` | `type="submit"` |
| I0034 | 175 | `Link` | `href={'${route}?strana=${index}'}` |
| I0035 | 176 | `Link` | `href={'${route}?strana=${index + 2}'}` |

### src/app/(public)/blog/[slug]/page.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0036 | 35 | `Link` | `href="/blog"` |
| I0037 | 40 | `Link` | `href={blogPath({ category: article.category })}` |
| I0038 | 69 | `Link` | `href={'/prijava?nastavi=${encodeURIComponent('/blog/${article.slug}')}'}` |
| I0039 | 76 | `Link` | `href="/blog"` |

### src/app/(public)/blog/page.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0040 | 44 | `form` | `action="/blog"` |
| I0041 | 48 | `input` | `type="search"`; `name="q"`; `id="blog-search"`; `placeholder="Npr. termin ili oglas"` |
| I0042 | 56 | `input` | `type="hidden"`; `name="tema"`; `value={filters.category}` |
| I0043 | 57 | `input` | `type="hidden"`; `name="sacuvano"`; `value="1"` |
| I0044 | 58 | `button` | `type="submit"` |
| I0045 | 67 | `Link` | `href={blogPath()}` |
| I0046 | 74 | `Link` | `href={blogPath({ category })}` |
| I0047 | 82 | `Link` | `href={blogPath({ saved: true })}` |
| I0048 | 105 | `Link` | `href="/prijava?nastavi=%2Fblog%3Fsacuvano%3D1"` |
| I0049 | 127 | `Link` | `href={blogPath({ ...filters, page: filters.page - 1 })}` |
| I0050 | 136 | `Link` | `href={blogPath({ ...filters, page: filters.page + 1 })}` |

### src/app/(public)/djelatnosti/[id]/not-found.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0051 | 10 | `Link` | `href="/pretraga"` |

### src/app/(public)/djelatnosti/[id]/page.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0052 | 72 | `a` | `href={'#${offer.id}'}` |
| I0053 | 234 | `Link` | `href="/pretraga"` |

### src/app/(public)/nalog/obavijesti/page.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0054 | 60 | `Link` | `href="/nalog"` |
| I0055 | 68 | `Link` | `href={deviceNotificationSettingsPath}` |
| I0056 | 80 | `form` | `action={acknowledge.bind(null, result.accountId, undefined, undefined)}` |
| I0057 | 81 | `button` | `type="submit"` |
| I0058 | 90 | `form` | `action={acknowledge.bind(null, result.accountId, item.id, item.version)}` |
| I0059 | 91 | `button` | `type="submit"` |
| I0060 | 127 | `Link` | `href={'${activityInboxPath}?stranica=${page - 1}'}` |
| I0061 | 135 | `Link` | `href={'${activityInboxPath}?stranica=${page + 1}'}` |

### src/app/(public)/nalog/page.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0062 | 86 | `Link` | `href="/prijava"` |

### src/app/(public)/nalog/reels/page.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0063 | 35 | `Link` | `href="/nalog"` |
| I0064 | 56 | `Link` | `href={href(page - 1)}` |
| I0065 | 57 | `Link` | `href={href(page + 1)}` |

### src/app/(public)/o-nama/page.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0066 | 46 | `Link` | `href="/pretraga"` |
| I0067 | 57 | `Link` | `href="/podrzi"` |

### src/app/(public)/oglasavanje/page.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0068 | 96 | `a` | `href="#pozicije"` |
| I0069 | 99 | `a` | `href={'mailto:${supportEmail}?subject=Upit%20za%20ogla%C5%A1avanje'}` |
| I0070 | 103 | `a` | `href={'tel:${contactPhone}'}` |
| I0071 | 111 | `a` | `href="#pozicije"` |
| I0072 | 112 | `a` | `href="#cjenovnik"` |
| I0073 | 113 | `a` | `href="#ciljanje"` |
| I0074 | 114 | `a` | `href="#publika"` |
| I0075 | 115 | `a` | `href="#uslovi"` |
| I0076 | 310 | `Link` | `href="/naplata"` |
| I0077 | 318 | `Link` | `href="/nalog?odjeljak=oglasi"` |
| I0078 | 326 | `Link` | `href="/nalog?odjeljak=oglasi"` |
| I0079 | 334 | `Link` | `href="/paketi"` |
| I0080 | 346 | `a` | `href={'mailto:${supportEmail}?subject=Upit%20za%20kampanju'}` |
| I0081 | 351 | `a` | `href={'tel:${contactPhone}'}` |
| I0082 | 360 | `Link` | `href="/nalog?odjeljak=djelatnosti"` |

### src/app/(public)/pomoc/page.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0083 | 40 | `Link` | `href="/blog"` |
| I0084 | 43 | `Link` | `href="/pravila-zajednice"` |
| I0085 | 46 | `Link` | `href="/privatnost"` |

### src/app/(public)/pravila-zajednice/page.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0086 | 15 | `Link` | `href={reportHelpPath}` |

### src/app/(public)/pretraga/page.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0087 | 144 | `Link` | `href="/pretraga"` |
| I0088 | 167 | `Link` | `href={'/pretraga${directorySearchSuffix(remaining)}'}`; `aria-label={'Ukloni filter: ${label}'}` |
| I0089 | 182 | `Link` | `href="/pretraga"` |
| I0090 | 217 | `Link` | `href={pageHref(page - 1)}` |
| I0091 | 219 | `Link` | `href={pageHref(page + 1)}` |

### src/app/(public)/privatnost/page.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0092 | 63 | `a` | `href={'mailto:${supportEmail}'}` |
| I0093 | 65 | `Link` | `href="/brisanje-naloga"` |

### src/app/(public)/reels/page.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0094 | 33 | `Link` | `href={businessId ? '/djelatnosti/${businessId}' : "/"}` |
| I0095 | 49 | `Link` | `href={href(page - 1)}` |
| I0096 | 51 | `Link` | `href={href(page + 1)}` |
| I0097 | 56 | `Link` | `href="/nalog/reels"` |

### src/app/(public)/sacuvane-pretrage/page.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0098 | 23 | `Link` | `href="/pretraga"` |
| I0099 | 26 | `Link` | `href="/nalog?odjeljak=sacuvani"` |
| I0100 | 29 | `Link` | `href="/blog?sacuvano=1"` |

### src/app/layout.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0101 | 33 | `a` | `href="#glavni-sadrzaj"` |

### src/app/not-found.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0102 | 12 | `Link` | `href="/"`; `aria-label="AhiBizz — početna"` |
| I0103 | 30 | `Link` | `href="/"` |
| I0104 | 33 | `Link` | `href="/pretraga"` |
| I0105 | 36 | `Link` | `href="/pomoc"` |

### src/app/pregled/djelatnost/ProfilePreview.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0106 | 22 | `button` | `type="button"`; `onClick={() => state.toggleSaved(business.id)}` |

### src/app/pregled/djelatnost/page.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0107 | 17 | `Link` | `href="/pregled/pretraga"` |

### src/app/pregled/pretraga/page.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0108 | 57 | `Link` | `href="/pregled"` |
| I0109 | 73 | `input` | `type="search"`; `name="q"`; `placeholder="Npr. masaža ili kafa"` |
| I0110 | 83 | `input` | `type="text"`; `name="place"`; `placeholder="Npr. Tuzla"` |
| I0111 | 93 | `select` | `name="category"` |
| I0112 | 102 | `button` | `type="submit"` |
| I0113 | 120 | `Link` | `href="/pregled/pretraga"` |
| I0114 | 137 | `Link` | `href="/pregled/pretraga"` |

### src/components/EmptyDirectory.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0115 | 30 | `Link` | `href={withoutOpenFilter ?? (filtered ? "/pretraga" : "/o-nama")}` |

### src/components/MobileDock.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0116 | 62 | `Link` | `href={href}` |

### src/components/SiteFooter.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0117 | 10 | `Link` | `href="/"`; `aria-label="AhiBizz — početna"` |
| I0118 | 20 | `Link` | `href="/o-nama"` |
| I0119 | 21 | `Link` | `href="/privatnost"` |
| I0120 | 22 | `Link` | `href="/pomoc"` |
| I0121 | 23 | `Link` | `href="/blog"` |
| I0122 | 24 | `Link` | `href="/paketi"` |
| I0123 | 25 | `Link` | `href="/instaliraj"` |
| I0124 | 26 | `Link` | `href="/podrzi"` |

### src/components/SiteHeader.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0125 | 140 | `Link` | `href={link.href}`; `onClick={closeMenu}` |
| I0126 | 156 | `Link` | `href="/"`; `aria-label="AhiBizz — početna"`; `onClick={closeMenu}` |
| I0127 | 167 | `button` | `type="button"`; `aria-label={open ? "Zatvori meni" : "Otvori meni"}`; `onClick={() => { clearAccess(); if (!open) { setCurrentHref( headerCurrentDestination(pathname, new URLSearchParams(window.location.search)), ); } setOpen(!open); }}` |
| I0128 | 211 | `summary` | Native/roditeljska interakcija; vidi izvor |
| I0129 | 227 | `summary` | Native/roditeljska interakcija; vidi izvor |
| I0130 | 239 | `summary` | Native/roditeljska interakcija; vidi izvor |
| I0131 | 248 | `Link` | `href={link.href}`; `onClick={closeMenu}` |

### src/components/account/AccountAuthorityBoundary.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0132 | 128 | `button` | `type="button"`; `onClick={() => void boundary.current?.revalidate()}`; `disabled={state.checking}` |
| I0133 | 135 | `Link` | `href={loginHref}` |

### src/components/account/AccountDashboard.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0134 | 164 | `button` | `type="button"`; `onClick={() => changeSection(item.id)}` |
| I0135 | 239 | `button` | `type="button"`; `aria-label={'Više odjeljaka naloga${current && !current.primary ? ', odabrano: ${current.label}' : ""}'}`; `onClick={() => setMoreMenu(!moreMenu)}` |
| I0136 | 266 | `Link` | `href="/administracija"` |
| I0137 | 274 | `button` | `type="button"`; `aria-label="Odjava"`; `title="Odjava"`; `onClick={logout}`; `disabled={busy}` |
| I0138 | 363 | `Link` | `href="/sacuvane-pretrage"` |
| I0139 | 366 | `Link` | `href="/blog?sacuvano=1"` |

### src/components/account/AccountOverview.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0140 | 100 | `button` | `type="button"`; `onClick={retry}` |
| I0141 | 128 | `button` | `type="button"`; `onClick={openPlans}` |
| I0142 | 133 | `Link` | `href="/paketi"` |
| I0143 | 185 | `Link` | `href={'/paketi/placanje?paket=${item.packageId}&period=${item.period}&ugovor=${item.id}'}` |
| I0144 | 204 | `button` | `type="button"`; `onClick={openPlans}` |
| I0145 | 288 | `button` | `type="button"`; `onClick={() => onSection("profile")}` |
| I0146 | 312 | `button` | `type="button"`; `onClick={() => onSection(pane)}` |
| I0147 | 347 | `Link` | `href={'/djelatnosti/${row.id}'}` |

### src/components/account/AccountPassword.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0148 | 70 | `summary` | Native/roditeljska interakcija; vidi izvor |
| I0149 | 71 | `form` | `action="/api/account/password"`; `onSubmit={submit}` |
| I0150 | 72 | `input` | `type="hidden"`; `name="username"`; `value={email}` |
| I0151 | 75 | `input` | `type="password"`; `name="currentPassword"`; `disabled={busy}` |
| I0152 | 86 | `input` | `type="password"`; `name="newPassword"`; `disabled={busy}` |
| I0153 | 102 | `input` | `type="password"`; `name="confirmPassword"`; `disabled={busy}` |
| I0154 | 118 | `button` | `type="submit"`; `disabled={busy}` |
| I0155 | 124 | `Link` | `href="/zaboravljena-lozinka"` |

### src/components/account/AccountQuickMenu.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0156 | 48 | `Link` | `href={href}`; `onClick={close}` |
| I0157 | 110 | `Link` | `href={path.profile}`; `onClick={close}` |
| I0158 | 122 | `Link` | `href={path.credits}`; `onClick={close}` |
| I0159 | 126 | `Link` | `href={path.credits}`; `onClick={close}` |
| I0160 | 139 | `summary` | Native/roditeljska interakcija; vidi izvor |
| I0161 | 155 | `summary` | Native/roditeljska interakcija; vidi izvor |
| I0162 | 172 | `summary` | Native/roditeljska interakcija; vidi izvor |
| I0163 | 207 | `button` | `type="button"`; `onClick={() => void changeTheme(value)}`; `disabled={saving}` |
| I0164 | 219 | `button` | `type="button"`; `onClick={() => void logout()}`; `disabled={saving}` |

### src/components/account/AccountSettings.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0165 | 244 | `Link` | `href="/nalog?odjeljak=profil"` |
| I0166 | 247 | `Link` | `href="/nalog?odjeljak=djelatnosti"` |
| I0167 | 264 | `input` | `type="radio"`; `name="appearance"`; `onChange={() => { setDraft(choice.value); setNotice(""); }}`; `checked={draft === choice.value}`; `value={choice.value}` |
| I0168 | 288 | `button` | `type="button"`; `onClick={() => void save()}`; `disabled={loading &#124;&#124; saving &#124;&#124; !loaded &#124;&#124; blocked &#124;&#124; draft === confirmed}` |
| I0169 | 295 | `button` | `type="button"`; `onClick={() => void load()}`; `disabled={loading &#124;&#124; saving}` |
| I0170 | 315 | `Link` | `href="/prijava?nastavi=%2Fnalog%3Fodjeljak%3Dpostavke"` |
| I0171 | 344 | `Link` | `href={blockedPeoplePath}` |
| I0172 | 347 | `Link` | `href="/privatnost"` |
| I0173 | 350 | `Link` | `href="/pomoc?tema=sigurnost#kontakt"` |
| I0174 | 353 | `Link` | `href="/brisanje-naloga"` |

### src/components/account/AdPreference.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0175 | 66 | `summary` | Native/roditeljska interakcija; vidi izvor |
| I0176 | 67 | `form` | `onSubmit={save}` |
| I0177 | 70 | `select` | `onChange={(e) => setDraft( e.target.value === "women" ? "women" : e.target.value === "men" ? "men" : null, ) }`; `disabled={!ready &#124;&#124; busy}`; `value={draft ?? ""}` |
| I0178 | 88 | `button` | `type="submit"`; `disabled={!ready &#124;&#124; busy &#124;&#124; draft === saved}` |

### src/components/account/AudienceSettings.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0179 | 76 | `summary` | Native/roditeljska interakcija; vidi izvor |
| I0180 | 77 | `form` | `onSubmit={save}` |
| I0181 | 80 | `select` | `onChange={(e) => { if (isAudienceChoice(e.target.value)) setDraft(e.target.value); }}`; `disabled={saved === null &#124;&#124; busy}`; `value={draft}` |
| I0182 | 100 | `button` | `type="submit"`; `disabled={saved === null &#124;&#124; busy &#124;&#124; draft === saved}` |

### src/components/account/BlockedPeople.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0183 | 64 | `input` | `type="checkbox"`; `onChange={(event) => { const hideInSearch = event.currentTarget.checked; void update(data.page, async (signal) => { await blocksRequest(accountId, "", { method: "PATCH", body: JSON.stringify({ hideInSearch }), signal, }); }); }}`; `disabled={busy}`; `checked={data.hideInSearch}` |
| I0184 | 97 | `button` | `type="button"`; `onClick={() => { void update(data.page, async (signal) => { await blocksRequest<BlockState>( accountId, '/${encodeURIComponent(item.id)}', { method: "PATCH", body: JSON.stringify({ blocked: false, expectedVersion: item.version, }), signal, }, ); }); }}`; `disabled={busy}` |
| I0185 | 119 | `button` | `type="button"`; `onClick={() => setConfirm(null)}`; `disabled={busy}` |
| I0186 | 129 | `button` | `type="button"`; `aria-label={'Odblokiraj ${item.name}'}`; `onClick={() => setConfirm(item.id)}`; `disabled={busy}` |
| I0187 | 147 | `button` | `type="button"`; `onClick={() => void update(data.page - 1)}`; `disabled={busy &#124;&#124; data.page === 1}` |
| I0188 | 155 | `button` | `type="button"`; `onClick={() => void update(data.page + 1)}`; `disabled={busy &#124;&#124; !data.hasMore}` |
| I0189 | 169 | `button` | `type="button"`; `onClick={() => void update(data.page)}`; `disabled={busy}` |
| I0190 | 174 | `Link` | `href="/nalog?odjeljak=postavke"` |

### src/components/account/BusinessToday.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0191 | 115 | `button` | `type="button"`; `onClick={() => setRetry(retry + 1)}` |
| I0192 | 129 | `select` | `aria-label="Odaberi djelatnost"`; `onChange={(event) => { const id = event.target.value; try { sessionStorage.setItem(key, id); } catch {} setChoice(id); }}`; `value={choice ?? businessId}` |
| I0193 | 158 | `Link` | `href={href}` |
| I0194 | 183 | `Link` | `href={href}` |
| I0195 | 188 | `Link` | `href={ownerCalendarPath({ businessId, kind: group.kind, ...(group.pendingDay ? { day: group.pendingDay } : {}), })}` |
| I0196 | 205 | `Link` | `href={businessInquiryPath(data.inquiries.threadId)}` |

### src/components/account/NextAppointmentCard.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0197 | 58 | `button` | `type="button"`; `onClick={open}` |
| I0198 | 62 | `button` | `type="button"`; `onClick={download}` |

### src/components/account/OwnerCalendarPanel.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0199 | 55 | `button` | `type="button"`; `onClick={onBack}` |
| I0200 | 62 | `button` | `type="button"`; `onClick={() => setRetry(retry + 1)}` |

### src/components/admin/AccountApprovals.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0201 | 352 | `button` | `type="button"`; `onClick={() => { setNotice(""); void load(view, true); }}`; `disabled={loading &#124;&#124; pending !== null}` |
| I0202 | 368 | `button` | `type="button"`; `onClick={() => changeView(adminAccountQuery(item.approval, 1, view.q))}`; `disabled={pending !== null}` |
| I0203 | 380 | `form` | `onSubmit={searchAccounts}` |
| I0204 | 383 | `input` | `type="search"`; `id={searchId}`; `placeholder="Ime ili email"`; `onChange={(event) => setSearch(event.target.value)}`; `disabled={pending !== null}`; `value={search}` |
| I0205 | 392 | `button` | `type="submit"`; `disabled={pending !== null}` |
| I0206 | 396 | `button` | `type="button"`; `aria-label="Poništi pretragu"`; `onClick={() => changeView(adminAccountQuery(view.approval, 1))}`; `disabled={pending !== null}` |
| I0207 | 454 | `button` | `type="button"`; `onClick={() => void decide(account, "approved")}`; `disabled={disabled &#124;&#124; !account.emailVerified}` |
| I0208 | 468 | `button` | `type="button"`; `onClick={() => void decide(account, "suspended")}`; `disabled={disabled}` |
| I0209 | 489 | `button` | `type="button"`; `onClick={() => changeView(adminAccountQuery(view.approval, view.page - 1, view.q))}`; `disabled={pending !== null &#124;&#124; loading &#124;&#124; view.page === 1}` |
| I0210 | 498 | `button` | `type="button"`; `onClick={() => changeView(adminAccountQuery(view.approval, view.page + 1, view.q))}`; `disabled={pending !== null &#124;&#124; loading &#124;&#124; !data.hasMore &#124;&#124; view.page === 1000}` |

### src/components/admin/AdminDashboard.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0211 | 148 | `button` | `type="button"`; `onClick={() => setNavigationOpen(!navigationOpen)}` |
| I0212 | 164 | `button` | `type="button"`; `onClick={() => changeSection(item.id)}` |
| I0213 | 181 | `Link` | `href="/administracija/zahtjevi"` |
| I0214 | 185 | `Link` | `href="/administracija/oglasi"` |
| I0215 | 189 | `Link` | `href="/administracija/reels"` |
| I0216 | 192 | `Link` | `href="/administracija/blog"` |
| I0217 | 195 | `Link` | `href="/administracija/izgled"` |
| I0218 | 198 | `Link` | `href={adminMailPath}` |
| I0219 | 203 | `Link` | `href="/nalog"` |
| I0220 | 214 | `Link` | `href={businessImportPath}` |
| I0221 | 215 | `Link` | `href={businessLocationBatchPath}` |

### src/components/admin/AdminToday.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0222 | 51 | `button` | `type="button"`; `onClick={() => refresh((n) => n + 1)}`; `disabled={!rows && !error}` |
| I0223 | 71 | `Link` | `href={item.href}` |

### src/components/admin/BusinessImport.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0224 | 241 | `Link` | `href="/administracija?odjeljak=djelatnosti"` |
| I0225 | 249 | `input` | `type="file"`; `id="business-import-file"`; `accept="application/json,.json"`; `onChange={(e) => void select(e.target.files?.[0])}`; `disabled={busy &#124;&#124; denied}` |
| I0226 | 265 | `Link` | `href="/prijava?nastavi=%2Fadministracija%2Fuvoz-prijava"` |
| I0227 | 289 | `summary` | Native/roditeljska interakcija; vidi izvor |
| I0228 | 298 | `button` | `type="button"`; `onClick={() => void start()}`; `disabled={busy &#124;&#124; finished &#124;&#124; denied}` |
| I0229 | 312 | `button` | `type="button"`; `onClick={() => void newImport()}`; `disabled={busy &#124;&#124; denied}` |

### src/components/admin/BusinessLocationBatch.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0230 | 214 | `Link` | `href="/administracija?odjeljak=djelatnosti"` |
| I0231 | 221 | `input` | `type="file"`; `id="location-batch-file"`; `accept="application/json,.json"`; `onChange={(event) => void select(event.target.files?.[0])}`; `disabled={busy &#124;&#124; denied}` |
| I0232 | 237 | `Link` | `href="/prijava?nastavi=%2Fadministracija%2Flokacije"` |
| I0233 | 293 | `button` | `type="button"`; `onClick={() => void apply()}`; `disabled={busy &#124;&#124; denied &#124;&#124; finished}` |
| I0234 | 305 | `button` | `type="button"`; `onClick={() => void newBatch()}`; `disabled={busy &#124;&#124; denied}` |

### src/components/admin/CategoryManager.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0235 | 251 | `form` | `onSubmit={save}` |
| I0236 | 255 | `input` | `name="name"`; `id="admin-category-name"`; `placeholder="Npr. Ljepota i zdravlje"`; `onChange={(event) => setName(event.target.value)}`; `value={name}` |
| I0237 | 267 | `select` | `id="admin-category-parent"`; `onChange={(event) => setParentId(event.target.value)}`; `value={parentId}` |
| I0238 | 282 | `select` | `id="admin-category-rental"`; `onChange={(event) => setVehicleRental(event.target.value === "on")}`; `disabled={parent?.vehicleRental}`; `value={vehicleRental &#124;&#124; parent?.vehicleRental ? "on" : "off"}` |
| I0239 | 294 | `select` | `id="admin-category-accommodation"`; `onChange={(event) => setAccommodation(event.target.value === "on")}`; `disabled={parent?.accommodation}`; `value={accommodation &#124;&#124; parent?.accommodation ? "on" : "off"}` |
| I0240 | 304 | `button` | `type="submit"`; `disabled={!name.trim()}` |
| I0241 | 327 | `button` | `type="button"`; `onClick={() => void load()}`; `disabled={busy &#124;&#124; loading}` |

### src/components/admin/ProfileVerification.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0242 | 41 | `button` | `type="button"`; `onClick={() => setOpen(true)}`; `disabled={props.disabled}` |
| I0243 | 232 | `button` | `type="button"`; `aria-label="Zatvori"`; `onClick={close}`; `disabled={saving}` |
| I0244 | 256 | `button` | `type="button"`; `onClick={() => void load()}` |
| I0245 | 268 | `a` | `href={'/ljudi/${encodeURIComponent(snapshot.identity)}'}` |
| I0246 | 281 | `summary` | Native/roditeljska interakcija; vidi izvor |
| I0247 | 293 | `form` | `onSubmit={decide}` |
| I0248 | 296 | `textarea` | `onChange={(e) => setReason(e.target.value)}`; `disabled={saving}`; `value={reason}` |
| I0249 | 306 | `input` | `type="checkbox"`; `onChange={(e) => setReviewed(e.target.checked)}`; `disabled={saving}`; `checked={reviewed}` |
| I0250 | 318 | `button` | `type="submit"`; `disabled={saving &#124;&#124; !reviewed &#124;&#124; !reason.trim()}` |

### src/components/auth/AuthForm.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0251 | 174 | `button` | `type="button"`; `onClick={resendVerification}`; `disabled={busy}` |
| I0252 | 193 | `Link` | `href="/"` |
| I0253 | 211 | `Link` | `href="/zaboravljena-lozinka"` |
| I0254 | 228 | `Link` | `href={links.login}` |
| I0255 | 233 | `form` | `action={endpoints[mode]}`; `onSubmit={submit}` |
| I0256 | 237 | `input` | `name="name"`; `disabled={!available &#124;&#124; busy}` |
| I0257 | 250 | `input` | `type="email"`; `name="email"`; `disabled={!available &#124;&#124; busy}` |
| I0258 | 265 | `input` | `type={visible ? "text" : "password"}`; `name="password"`; `disabled={!available &#124;&#124; busy}` |
| I0259 | 275 | `button` | `type="button"`; `onClick={() => setVisible(!visible)}`; `disabled={!available &#124;&#124; busy}` |
| I0260 | 288 | `button` | `type="button"`; `onClick={suggestPassword}`; `disabled={!ready &#124;&#124; !available &#124;&#124; busy}` |
| I0261 | 300 | `input` | `type="checkbox"`; `name="remember"`; `disabled={!available &#124;&#124; busy}` |
| I0262 | 308 | `Link` | `href="/zaboravljena-lozinka"` |
| I0263 | 314 | `input` | `type="checkbox"`; `name="terms"`; `disabled={!available &#124;&#124; busy}` |
| I0264 | 316 | `Link` | `href="/pravila-zajednice"` |
| I0265 | 317 | `Link` | `href="/privatnost"` |
| I0266 | 321 | `button` | `type="submit"`; `disabled={!ready &#124;&#124; !available &#124;&#124; busy &#124;&#124; (mode === "reset-password" && !token)}` |
| I0267 | 335 | `Link` | `href={links.registration}` |
| I0268 | 338 | `Link` | `href={links.login}` |

### src/components/billing/AdvancedCardForm.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0269 | 131 | `form` | `aria-label="Plaćanje karticom"`; `onSubmit={async (e) => { e.preventDefault(); if (!valid &#124;&#124; busy.current &#124;&#124; !session.current) return; busy.current = true; setSubmitting(true); try { await submit(session.current); } finally { busy.current = false; setSubmitting(false); } }}` |
| I0270 | 160 | `button` | `type="submit"`; `disabled={!valid &#124;&#124; submitting}` |

### src/components/billing/BillingAdmin.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0271 | 511 | `button` | `type="button"`; `onClick={() => void checkPending()}`; `disabled={!active}` |
| I0272 | 535 | `button` | `type="button"`; `onClick={() => { setTab("receipts"); setError(""); }}`; `disabled={locked &#124;&#124; !!form &#124;&#124; !authorized}` |
| I0273 | 547 | `button` | `type="button"`; `onClick={() => { setTab("development"); setError(""); }}`; `disabled={locked &#124;&#124; !!form &#124;&#124; !authorized}` |
| I0274 | 562 | `button` | `type="button"`; `onClick={() => { setError(""); setRefresh((value) => value + 1); }}`; `disabled={locked &#124;&#124; !active}` |
| I0275 | 574 | `button` | `type="button"`; `onClick={() => { setTab("receipts"); setForm("new"); setError(""); setNotice(""); void findBusiness("", 1); }}`; `disabled={locked &#124;&#124; !!form &#124;&#124; !authorized &#124;&#124; !active}` |
| I0276 | 641 | `button` | `type="button"`; `onClick={() => { setForm(receipt); setError(""); setNotice(""); }}`; `disabled={locked &#124;&#124; !!form &#124;&#124; !authorized &#124;&#124; !active}` |
| I0277 | 690 | `button` | `type="button"`; `onClick={() => setPage(page - 1)}`; `disabled={locked &#124;&#124; loading &#124;&#124; !!form &#124;&#124; page === 1}` |
| I0278 | 699 | `button` | `type="button"`; `onClick={() => setPage(page + 1)}`; `disabled={locked &#124;&#124; loading &#124;&#124; !!form &#124;&#124; !hasMore}` |
| I0279 | 733 | `button` | `type="button"`; `onClick={() => setDevelopmentPage(developmentPage - 1)}`; `disabled={locked &#124;&#124; loading &#124;&#124; developmentPage === 1}` |
| I0280 | 742 | `button` | `type="button"`; `onClick={() => setDevelopmentPage(developmentPage + 1)}`; `disabled={locked &#124;&#124; loading &#124;&#124; !developmentMore}` |

### src/components/billing/Checkout.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0281 | 630 | `a` | `href="/nalog"` |
| I0282 | 658 | `a` | `href={'/prijava?nastavi=${encodeURIComponent(loginReturn)}'}` |
| I0283 | 669 | `button` | `type="button"`; `onClick={() => setReloadOrder((value) => value + 1)}`; `disabled={orderLoading &#124;&#124; busy}` |
| I0284 | 683 | `a` | `href="/nalog?odjeljak=oglasi"` |
| I0285 | 684 | `button` | `type="button"`; `onClick={() => setOfferAttempt((n) => n + 1)}` |
| I0286 | 700 | `a` | `href="/nalog?odjeljak=oglasi"` |
| I0287 | 706 | `a` | `href="/nalog?odjeljak=oglasi"` |
| I0288 | 712 | `a` | `href="/nalog?odjeljak=krediti"` |
| I0289 | 724 | `button` | `type="button"`; `onClick={() => { setKind("promotion"); setReview(false); setCardOpen(false); key.current = null; }}`; `disabled={busy}` |
| I0290 | 737 | `button` | `type="button"`; `onClick={() => { setKind("support"); setReview(false); setCardOpen(false); key.current = null; }}`; `disabled={busy}` |
| I0291 | 811 | `select` | `id="checkout-business"`; `onChange={(e) => { setBusinessId(e.target.value); setFindExisting(false); key.current = null; }}`; `disabled={review &#124;&#124; busy}`; `value={businessId}` |
| I0292 | 839 | `input` | `id="checkout-support"`; `placeholder="Npr. 5,00"`; `onChange={(e) => { setSupport(e.target.value); key.current = null; }}`; `disabled={review &#124;&#124; busy}`; `value={support}` |
| I0293 | 862 | `a` | `href="/nalog?odjeljak=oglasi"` |
| I0294 | 867 | `button` | `type="button"`; `onClick={payWithCredits}`; `disabled={busy}` |
| I0295 | 881 | `a` | `href={creditTopUpPath('/naplata?ponuda=${offer.id}')}` |
| I0296 | 894 | `button` | `type="button"`; `onClick={() => { key.current ??= crypto.randomUUID(); if (walletAvailable) setMethod("credits"); else setCardOpen(kind !== "support" && Boolean(catalog?.paypalClientId)); setReview(true); }}`; `disabled={ !userId &#124;&#124; !canReview &#124;&#124; (platformCreditsOnly ? !walletAvailable : !catalog.available && !walletAvailable) }` |
| I0297 | 945 | `a` | `href={restartHref ?? (order.kind === "quote" ? "/nalog" : "/naplata")}`; `onClick={(event) => { if (locked.current) { event.preventDefault(); return; } key.current = null; }}` |
| I0298 | 975 | `a` | `href="/nalog?odjeljak=krediti"` |
| I0299 | 978 | `a` | `href="/nalog"` |
| I0300 | 1008 | `button` | `type="button"`; `onClick={() => act("capture")}`; `disabled={busy &#124;&#124; !catalog?.available}` |
| I0301 | 1019 | `button` | `type="button"`; `onClick={() => act(returned ? "capture" : "create")}`; `disabled={ busy &#124;&#124; !catalog?.available &#124;&#124; (order.kind === "support" && catalog?.support.available !== true) }` |
| I0302 | 1033 | `button` | `type="button"`; `onClick={() => act("reconcile")}`; `disabled={busy}` |
| I0303 | 1054 | `button` | `type="button"`; `onClick={() => setMethod("credits")}`; `disabled={busy}` |
| I0304 | 1065 | `button` | `type="button"`; `onClick={() => setCardOpen(true)}`; `disabled={busy}` |
| I0305 | 1078 | `button` | `type="button"`; `onClick={() => setCardOpen(false)}`; `disabled={busy}` |
| I0306 | 1096 | `button` | `type="button"`; `onClick={payWithCredits}`; `disabled={busy}` |
| I0307 | 1110 | `a` | `href={creditTopUpPath('/naplata?djelatnost=${businessId}')}` |
| I0308 | 1178 | `a` | `href="/nalog?odjeljak=krediti"` |
| I0309 | 1184 | `button` | `type="button"`; `id="paypal-novcanik"`; `onClick={() => act("create")}`; `disabled={busy &#124;&#124; !catalog?.available &#124;&#124; !userId}` |
| I0310 | 1195 | `button` | `type="button"`; `onClick={() => { setReview(false); setCardOpen(false); }}`; `disabled={busy}` |
| I0311 | 1222 | `button` | `type="button"`; `onClick={() => { if (creditTopUp) setOfferAttempt((value) => value + 1); else void recoverPromotion("find"); }}`; `disabled={busy &#124;&#124; orderLoading}` |
| I0312 | 1246 | `button` | `type="button"`; `onClick={() => recoverPromotion("cancel")}`; `disabled={busy &#124;&#124; orderLoading &#124;&#124; cancellationUncertain}` |
| I0313 | 1257 | `summary` | Native/roditeljska interakcija; vidi izvor |
| I0314 | 1262 | `button` | `type="button"`; `onClick={() => act("reconcile")}`; `disabled={busy}` |
| I0315 | 1272 | `a` | `href="/podrzi"` |

### src/components/billing/PackageBenefitsEditor.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0316 | 88 | `form` | `onSubmit={save}` |
| I0317 | 94 | `input` | `type="checkbox"`; `name={'${plan.id}-enabled'}` |
| I0318 | 103 | `input` | `type="number"`; `name={'${plan.id}-nearby'}` |
| I0319 | 116 | `input` | `type="number"`; `name={'${plan.id}-featured'}` |
| I0320 | 130 | `button` | `type="submit"`; `disabled={busy}` |
| I0321 | 137 | `button` | `type="button"`; `onClick={() => setRefresh((value) => value + 1)}`; `disabled={busy}` |

### src/components/billing/PackageCheckout.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0322 | 69 | `a` | `href={'/pomoc?tema=naplata&ugovor=${encodeURIComponent(contract.id)}#kontakt'}` |
| I0323 | 539 | `a` | `href="/paketi"` |
| I0324 | 555 | `button` | `type="button"`; `onClick={() => window.location.reload()}`; `disabled={busy}` |
| I0325 | 584 | `a` | `href="/nalog?odjeljak=djelatnosti"` |
| I0326 | 588 | `form` | `onSubmit={(e) => { e.preventDefault(); if (paymentMethod !== "card") void perform("create"); }}` |
| I0327 | 599 | `select` | `onChange={(e) => { chooseBusiness(e.target.value); accept(false); }}`; `value={chosenBusiness}` |
| I0328 | 616 | `select` | `onChange={(e) => { choosePackage(e.target.value as BillingPackageId); accept(false); }}`; `value={packageId}` |
| I0329 | 632 | `select` | `onChange={(e) => { choosePeriod(e.target.value as BillingPeriod); accept(false); }}`; `value={period}` |
| I0330 | 656 | `input` | `type="checkbox"`; `onChange={(e) => accept(e.target.checked)}`; `checked={accepted}` |
| I0331 | 672 | `input` | `type="radio"`; `name="package-method"`; `onChange={() => { setPaymentMethod(method); accept(false); setCardResume(""); setError(""); }}`; `checked={paymentMethod === method}`; `value={method}` |
| I0332 | 697 | `button` | `type="submit"`; `disabled={!canSubmit}` |
| I0333 | 708 | `a` | `href={creditTopUpPath('${pagePath}?${topUpReturn}')}` |
| I0334 | 805 | `button` | `type="button"`; `onClick={() => void perform("close-unpaid", c)}`; `disabled={busy}` |
| I0335 | 813 | `button` | `type="button"`; `onClick={() => setConfirmCancel("")}`; `disabled={busy}` |
| I0336 | 823 | `button` | `type="button"`; `onClick={() => setConfirmCancel(c.id)}`; `disabled={busy}` |
| I0337 | 834 | `button` | `type="button"`; `onClick={() => void perform("resume", c)}`; `disabled={busy}` |
| I0338 | 843 | `button` | `type="button"`; `onClick={() => { setCardResume(c.id); setPaymentMethod("card"); setError(""); }}`; `disabled={busy}` |
| I0339 | 866 | `a` | `href={creditTopUpPath(contractPath(c))}` |
| I0340 | 871 | `button` | `type="button"`; `onClick={() => void perform("pay-credits", c)}`; `disabled={busy}` |
| I0341 | 885 | `button` | `type="button"`; `onClick={() => void perform("refresh", c)}`; `disabled={busy}` |
| I0342 | 900 | `button` | `type="button"`; `onClick={() => void perform("cancel", c)}`; `disabled={busy}` |
| I0343 | 908 | `button` | `type="button"`; `onClick={() => setConfirmCancel("")}`; `disabled={busy}` |
| I0344 | 918 | `button` | `type="button"`; `onClick={() => setConfirmCancel(c.id)}`; `disabled={busy}` |

### src/components/billing/PackageSettlements.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0345 | 59 | `button` | `type="button"`; `onClick={() => setOpen((value) => !value)}` |
| I0346 | 98 | `button` | `type="button"`; `onClick={() => setPage((p) => p - 1)}`; `disabled={page === 1}` |
| I0347 | 106 | `button` | `type="button"`; `onClick={() => setPage((p) => p + 1)}`; `disabled={!data.more}` |

### src/components/billing/PackageSetup.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0348 | 80 | `button` | `type="button"`; `onClick={() => void setup()}`; `disabled={busy}` |

### src/components/billing/PayPalCardButton.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0349 | 368 | `button` | `type="button"`; `onClick={() => setAttempt((value) => value + 1)}` |

### src/components/billing/PricingCatalog.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0350 | 45 | `Link` | `href={accountShortcuts.membership}` |
| I0351 | 53 | `button` | `type="button"`; `onClick={() => setPeriod("monthly")}` |
| I0352 | 60 | `button` | `type="button"`; `onClick={() => setPeriod("annual")}` |
| I0353 | 128 | `Link` | `href={'/paketi/placanje?paket=${plan.id}&period=${period}'}`; `aria-label={'Odaberi ${plan.name}, ${monthly ? "mjesečno" : "godišnje"} plaćanje'}` |
| I0354 | 147 | `button` | `type="button"`; `onClick={() => setAttempt((value) => value + 1)}` |
| I0355 | 166 | `a` | `href="/naplata"` |
| I0356 | 176 | `Link` | `href={productionRequestPath}` |

### src/components/billing/ReceiptForm.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0357 | 112 | `form` | `aria-label={receipt ? "Ispravka evidencije uplate" : "Nova evidencija uplate"}`; `onSubmit={submit}` |
| I0358 | 129 | `select` | `id={'${prefix}-kind'}`; `onChange={(event) => setKind(event.target.value as BillingReceiptKind)}`; `value={kind}` |
| I0359 | 140 | `select` | `name="source"`; `id={'${prefix}-source'}` |
| I0360 | 155 | `select` | `id={'${prefix}-package'}`; `onChange={(event) => setPackageId(event.target.value as BillingPackageId)}`; `value={packageId}` |
| I0361 | 169 | `select` | `id={'${prefix}-period'}`; `onChange={(event) => setPeriod(event.target.value as BillingPeriod)}`; `value={period}` |
| I0362 | 186 | `input` | `id={'${prefix}-search'}`; `onChange={(event) => setSearch(event.target.value)}`; `value={search}` |
| I0363 | 193 | `button` | `type="button"`; `onClick={() => onFindBusiness(search.trim(), 1)}`; `disabled={businessLoading}` |
| I0364 | 205 | `select` | `id={'${prefix}-business'}`; `onChange={(event) => setSelected( businesses.find((item) => item.id === event.target.value) ?? null, ) }`; `value={selected?.id ?? ""}` |
| I0365 | 232 | `button` | `type="button"`; `onClick={() => onFindBusiness(businessQuery, businessPage - 1)}`; `disabled={businessLoading &#124;&#124; businessPage === 1}` |
| I0366 | 240 | `button` | `type="button"`; `onClick={() => onFindBusiness(businessQuery, businessPage + 1)}`; `disabled={businessLoading &#124;&#124; !businessHasMore}` |
| I0367 | 255 | `input` | `type="date"`; `name="serviceStartsOn"`; `id={'${prefix}-starts'}` |
| I0368 | 265 | `input` | `type="date"`; `name="serviceEndsOn"`; `id={'${prefix}-ends'}` |
| I0369 | 280 | `input` | `name="reference"`; `id={'${prefix}-reference'}` |
| I0370 | 290 | `input` | `type="datetime-local"`; `name="receivedAt"`; `id={'${prefix}-received'}` |
| I0371 | 294 | `input` | `name="gross"`; `id={'${prefix}-gross'}` |
| I0372 | 307 | `input` | `name="refunded"`; `id={'${prefix}-refunded'}` |
| I0373 | 324 | `input` | `name="tax"`; `id={'${prefix}-tax'}`; `placeholder="Nepoznato"` |
| I0374 | 336 | `input` | `name="fee"`; `id={'${prefix}-fee'}`; `placeholder="Nepoznato"` |
| I0375 | 348 | `input` | `name="reason"`; `id={'${prefix}-reason'}` |
| I0376 | 363 | `button` | `type="submit"` |
| I0377 | 366 | `button` | `type="button"`; `onClick={onCancel}` |

### src/components/billing/SubscriptionCardButton.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0378 | 105 | `button` | `type="button"`; `onClick={() => retry((a) => a + 1)}` |

### src/components/booking/BusinessBookingManager.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0379 | 838 | `button` | `type="button"`; `onClick={onBack}`; `disabled={busy !== null &#124;&#124; uncertain}` |
| I0380 | 851 | `button` | `type="button"`; `onClick={() => setSettingsOpen(!settingsOpen)}`; `disabled={requiresLogin}` |
| I0381 | 877 | `Link` | `href="/prijava?nastavi=%2Fnalog%3Fodjeljak%3Ddjelatnosti"` |
| I0382 | 892 | `button` | `type="button"`; `onClick={() => void loadSettings(true)}` |
| I0383 | 916 | `form` | `onSubmit={saveSettings}` |
| I0384 | 923 | `input` | `type="checkbox"`; `onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}`; `disabled={busy !== null &#124;&#124; settingsBlocked}`; `checked={draft.enabled}` |
| I0385 | 936 | `select` | `onChange={(event) => setDraft({ ...draft, timezone: event.target.value })}`; `value={draft.timezone}` |
| I0386 | 949 | `button` | `type="button"`; `onClick={() => setDraft({ ...draft, services: [ ...draft.services, { key: 'new-service-${++sequence.current}', name: "", duration: "", price: "", active: true, }, ], }) }`; `disabled={draft.services.length >= 20}` |
| I0387 | 978 | `input` | `onChange={(event) => setDraft({ ...draft, services: draft.services.map((item) => item.key === service.key ? { ...item, name: event.target.value } : item, ), }) }`; `value={service.name}` |
| I0388 | 994 | `input` | `type="number"`; `onChange={(event) => setDraft({ ...draft, services: draft.services.map((item) => item.key === service.key ? { ...item, duration: event.target.value } : item, ), }) }`; `value={service.duration}` |
| I0389 | 1015 | `input` | `onChange={(event) => setDraft({ ...draft, services: draft.services.map((item) => item.key === service.key ? { ...item, price: event.target.value } : item, ), }) }`; `value={service.price}` |
| I0390 | 1033 | `input` | `type="checkbox"`; `onChange={(event) => setDraft({ ...draft, services: draft.services.map((item) => item.key === service.key ? { ...item, active: event.target.checked } : item, ), }) }`; `checked={service.active}` |
| I0391 | 1050 | `button` | `type="button"`; `onClick={() => setDraft({ ...draft, services: draft.services.filter((item) => item.key !== service.key), }) }` |
| I0392 | 1076 | `input` | `type="checkbox"`; `onChange={(event) => setDraft({ ...draft, windows: event.target.checked ? [ ...draft.windows, { key: 'new-window-${++sequence.current}', weekday: index + 1, start: "", end: "", }, ] : draft.windows.filter((window) => window.weekday !== index + 1), }) }`; `checked={rows.length > 0}` |
| I0393 | 1102 | `input` | `type="time"`; `aria-label={'${label} od'}`; `onChange={(event) => setDraft({ ...draft, windows: draft.windows.map((item) => item.key === window.key ? { ...item, start: event.target.value } : item, ), }) }`; `value={window.start}` |
| I0394 | 1120 | `input` | `type="text"`; `aria-label={'${label} do'}`; `placeholder="HH:MM"`; `onChange={(event) => setDraft({ ...draft, windows: draft.windows.map((item) => item.key === window.key ? { ...item, end: event.target.value } : item, ), }) }`; `value={window.end}` |
| I0395 | 1151 | `button` | `type="submit"`; `disabled={uncertain}` |
| I0396 | 1155 | `button` | `type="button"`; `onClick={() => settings && setDraft(toDraft(settings))}` |
| I0397 | 1169 | `button` | `type="button"`; `onClick={() => void loadSettings(true)}`; `disabled={settingsLoading &#124;&#124; busy !== null}` |
| I0398 | 1186 | `button` | `type="button"`; `aria-label="Prethodni mjesec"`; `onClick={() => { const next = nextMonth(month, -1); setMonth(next); setDay(next); }}`; `disabled={busy !== null}` |
| I0399 | 1199 | `button` | `type="button"`; `aria-label="Sljedeći mjesec"`; `onClick={() => { const next = nextMonth(month, 1); setMonth(next); setDay(next); }}`; `disabled={busy !== null}` |
| I0400 | 1219 | `button` | `type="button"`; `aria-label={bookingDate('${date}T12:00:00Z', "UTC")}`; `onClick={() => { setDay(date); if (date.slice(0, 7) !== month.slice(0, 7)) setMonth('${date.slice(0, 7)}-01'); }}`; `disabled={busy !== null}` |
| I0401 | 1241 | `button` | `type="button"`; `onClick={() => { setMonth('${today.slice(0, 7)}-01'); setDay(today); }}`; `disabled={busy !== null}` |
| I0402 | 1265 | `button` | `type="button"`; `onClick={() => void loadCalendar()}`; `disabled={busy !== null &#124;&#124; calendarLoading}` |
| I0403 | 1273 | `button` | `type="button"`; `onClick={() => { setCreating(!creating); setCreateDate(day); setEndDate(day); setCreateError(""); }}`; `disabled={busy !== null &#124;&#124; uncertain &#124;&#124; settingsLoading}` |
| I0404 | 1295 | `form` | `onSubmit={submitCreate}` |
| I0405 | 1299 | `button` | `type="button"`; `onClick={() => setCreating(false)}`; `disabled={busy !== null}` |
| I0406 | 1314 | `select` | `onChange={(event) => setKind(event.target.value === "block" ? "block" : "manual") }`; `value={kind}` |
| I0407 | 1327 | `input` | `type="date"`; `onChange={(event) => setCreateDate(event.target.value)}`; `value={createDate}` |
| I0408 | 1338 | `input` | `type="time"`; `onChange={(event) => setStart(event.target.value)}`; `value={start}` |
| I0409 | 1351 | `select` | `onChange={(event) => setServiceId(event.target.value)}`; `value={serviceId}` |
| I0410 | 1371 | `input` | `onChange={(event) => setClientName(event.target.value)}`; `value={clientName}` |
| I0411 | 1379 | `input` | `type="tel"`; `onChange={(event) => setClientPhone(event.target.value)}`; `value={clientPhone}` |
| I0412 | 1392 | `input` | `type="date"`; `onChange={(event) => setEndDate(event.target.value)}`; `value={endDate}` |
| I0413 | 1403 | `input` | `type="time"`; `onChange={(event) => setEnd(event.target.value)}`; `value={end}` |
| I0414 | 1413 | `button` | `type="submit"`; `disabled={kind === "manual" && activeServices.length === 0}` |
| I0415 | 1431 | `button` | `type="button"`; `onClick={() => void loadSettings(false)}`; `disabled={busy !== null}` |
| I0416 | 1441 | `button` | `type="button"`; `onClick={() => intent.current && void sendCreate(intent.current)}`; `disabled={busy !== null}` |
| I0417 | 1508 | `button` | `type="button"`; `onClick={() => void changeEntry(entry, "approve")}`; `disabled={busy !== null &#124;&#124; uncertain}` |
| I0418 | 1517 | `button` | `type="button"`; `onClick={() => void changeEntry(entry, "decline")}`; `disabled={busy !== null &#124;&#124; uncertain}` |
| I0419 | 1529 | `button` | `type="button"`; `onClick={() => void changeEntry(entry, "cancel")}`; `disabled={busy !== null &#124;&#124; uncertain}` |
| I0420 | 1538 | `button` | `type="button"`; `onClick={() => void changeEntry(entry, "complete")}`; `disabled={busy !== null &#124;&#124; uncertain}` |

### src/components/booking/CalendarDays.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0421 | 42 | `button` | `type="button"`; `aria-label="Prethodni mjesec"`; `onClick={previous}`; `disabled={disabled &#124;&#124; Boolean(minDate && month <= minDate.slice(0, 7))}` |
| I0422 | 51 | `button` | `type="button"`; `aria-label="Sljedeći mjesec"`; `onClick={() => setMonth(next)}`; `disabled={disabled &#124;&#124; Boolean(maxDate && next > maxDate.slice(0, 7))}` |
| I0423 | 72 | `button` | `type="button"`; `aria-label={bookingDate('${key}T12:00:00Z', "UTC")}`; `onClick={() => onChange(key)}`; `disabled={ disabled &#124;&#124; Boolean(minDate && key < minDate) &#124;&#124; Boolean(maxDate && key > maxDate) }` |

### src/components/booking/CustomerAppointments.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0424 | 236 | `button` | `type="button"`; `onClick={() => setRefresh((value) => value + 1)}`; `disabled={busy &#124;&#124; loading}` |
| I0425 | 251 | `button` | `type="button"`; `onClick={() => { setView(value); setPage(1); setError(""); setNotice(""); }}`; `disabled={busy}` |
| I0426 | 276 | `Link` | `href="/prijava?nastavi=%2Fnalog%3Fodjeljak%3Dtermini"` |
| I0427 | 308 | `Link` | `href={ preview ? '/pregled/djelatnost?profil=${entry.businessId}' : '/djelatnosti/${entry.businessId}' }` |
| I0428 | 324 | `button` | `type="button"`; `onClick={() => void cancel(entry)}`; `disabled={busy &#124;&#124; loading}` |
| I0429 | 338 | `button` | `type="button"`; `onClick={() => setPage(page - 1)}`; `disabled={busy &#124;&#124; page === 1}` |
| I0430 | 342 | `button` | `type="button"`; `onClick={() => setPage(page + 1)}`; `disabled={busy &#124;&#124; !more}` |

### src/components/booking/InventoryAppointments.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0431 | 30 | `Link` | `href={preview ? "/pregled/pretraga" : "/pretraga"}` |
| I0432 | 62 | `button` | `type="button"`; `onClick={retry}` |
| I0433 | 70 | `button` | `type="button"`; `onClick={() => setPage(page - 1)}`; `disabled={page === 1}` |
| I0434 | 74 | `button` | `type="button"`; `onClick={() => setPage(page + 1)}`; `disabled={!data.hasMore}` |

### src/components/booking/PublicBooking.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0435 | 355 | `Link` | `href={preview ? "/pregled/prostor/nalog?odjeljak=termini" : "/nalog?odjeljak=termini"}` |
| I0436 | 360 | `button` | `type="button"`; `onClick={() => { setDone(null); receipt.current = null; applyLatest(); setRefresh((value) => value + 1); }}` |
| I0437 | 381 | `select` | `id={'${prefix}-service'}`; `onChange={(event) => { setService(event.target.value); setLogin(false); setChangeNotice(""); }}`; `disabled={busy &#124;&#124; uncertain}`; `value={serviceId}` |
| I0438 | 398 | `CalendarDays` | `onChange={(next) => { setDate(next); setLogin(false); }}`; `disabled={busy &#124;&#124; uncertain}` |
| I0439 | 421 | `button` | `type="button"`; `onClick={() => { setSelection(slot.startsAt); setError(""); }}`; `disabled={busy &#124;&#124; uncertain}` |
| I0440 | 447 | `button` | `type="button"`; `onClick={() => void submit(true)}`; `disabled={busy}` |
| I0441 | 457 | `Link` | `href={'/prijava?nastavi=${encodeURIComponent('/djelatnosti/${businessId}#business-appointments')}'}` |
| I0442 | 466 | `button` | `type="button"`; `onClick={() => setRefresh((value) => value + 1)}`; `disabled={busy &#124;&#124; uncertain}` |
| I0443 | 475 | `Link` | `href={ preview ? "/pregled/prostor/nalog?odjeljak=termini" : "/nalog?odjeljak=termini" }` |
| I0444 | 498 | `button` | `type="button"`; `onClick={() => void submit()}`; `disabled={busy &#124;&#124; uncertain &#124;&#124; loading &#124;&#124; !selected}` |

### src/components/connections/ConnectionsPanel.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0445 | 311 | `Link` | `href={peopleHref}` |
| I0446 | 318 | `button` | `type="button"`; `onClick={() => switchView(key)}`; `disabled={busy &#124;&#124; pending !== null}` |
| I0447 | 332 | `button` | `type="button"`; `onClick={() => (pending ? void send(pending) : void load())}`; `disabled={busy &#124;&#124; loading}` |
| I0448 | 359 | `Link` | `href={peopleHref}` |
| I0449 | 380 | `Link` | `href={profileHref(item.person.id)}` |
| I0450 | 397 | `button` | `type="button"`; `onClick={() => act(item, "accept")}`; `disabled={disabled}` |
| I0451 | 406 | `button` | `type="button"`; `onClick={() => act(item, "decline")}`; `disabled={disabled}` |
| I0452 | 416 | `button` | `type="button"`; `onClick={() => act(item, "cancel")}`; `disabled={disabled}` |
| I0453 | 426 | `button` | `type="button"`; `onClick={() => act(item, "remove")}`; `disabled={disabled}` |
| I0454 | 437 | `button` | `type="button"`; `onClick={() => setConfirmRemove(null)}`; `disabled={disabled}` |
| I0455 | 455 | `button` | `type="button"`; `onClick={() => switchPage(page - 1)}`; `disabled={disabled &#124;&#124; page === 1}` |
| I0456 | 464 | `button` | `type="button"`; `onClick={() => switchPage(page + 1)}`; `disabled={disabled &#124;&#124; !hasMore}` |

### src/components/connections/PeopleSearch.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0457 | 137 | `form` | `aria-label="Pretraga ljudi"`; `onSubmit={submit}` |
| I0458 | 141 | `input` | `type="search"`; `name="people"`; `placeholder="Ime ili grad"`; `onChange={(event) => setQuery(event.target.value)}`; `value={query}` |
| I0459 | 151 | `button` | `type="submit"`; `disabled={loading}` |
| I0460 | 158 | `button` | `type="button"`; `onClick={() => setRefresh((value) => value + 1)}`; `disabled={loading}` |
| I0461 | 190 | `Link` | `href={profileHref(person.id)}` |
| I0462 | 222 | `button` | `type="button"`; `onClick={() => setPage((value) => value - 1)}`; `disabled={loading &#124;&#124; page === 1}` |
| I0463 | 231 | `button` | `type="button"`; `onClick={() => setPage((value) => value + 1)}`; `disabled={loading &#124;&#124; !hasMore}` |

### src/components/connections/ProfileBlockAction.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0464 | 78 | `button` | `type="button"`; `onClick={() => setConfirm(true)}`; `disabled={disabled &#124;&#124; busy}` |
| I0465 | 93 | `button` | `type="button"`; `onClick={() => void change()}`; `disabled={disabled &#124;&#124; busy}` |
| I0466 | 101 | `button` | `type="button"`; `onClick={() => setConfirm(false)}`; `disabled={busy}` |
| I0467 | 115 | `button` | `type="button"`; `onClick={() => { setError(""); void read(); }}` |

### src/components/connections/PublicPersonBusinesses.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0468 | 70 | `button` | `type="button"`; `onClick={() => setRefresh((value) => value + 1)}` |
| I0469 | 83 | `button` | `type="button"`; `onClick={() => setPage((value) => value - 1)}`; `disabled={loading &#124;&#124; page === 1}` |
| I0470 | 91 | `button` | `type="button"`; `onClick={() => setPage((value) => value + 1)}`; `disabled={loading &#124;&#124; !hasMore &#124;&#124; page >= 999}` |

### src/components/connections/PublicPersonProfile.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0471 | 306 | `button` | `type="button"`; `onClick={() => (pending ? void send(pending) : void load())}`; `disabled={busy &#124;&#124; loading}` |
| I0472 | 375 | `Link` | `href={messageHref ?? messageLink({ kind: "person", targetId: person.id })}` |
| I0473 | 383 | `Link` | `href={ownProfileHref}` |
| I0474 | 387 | `Link` | `href={signIn}` |
| I0475 | 399 | `button` | `type="button"`; `onClick={() => act("remove")}`; `disabled={disabled}` |
| I0476 | 408 | `button` | `type="button"`; `onClick={() => setConfirmRemove(false)}`; `disabled={disabled}` |
| I0477 | 421 | `button` | `type="button"`; `onClick={() => act("accept")}`; `disabled={disabled}` |
| I0478 | 429 | `button` | `type="button"`; `onClick={() => act("decline")}`; `disabled={disabled}` |
| I0479 | 439 | `button` | `type="button"`; `onClick={() => act("cancel")}`; `disabled={disabled}` |
| I0480 | 449 | `button` | `type="button"`; `onClick={() => act("request")}`; `disabled={disabled}` |
| I0481 | 465 | `button` | `type="button"`; `onClick={() => (pending ? void send(pending) : void load())}`; `disabled={busy &#124;&#124; loading}` |
| I0482 | 490 | `button` | `type="button"`; `id={'${tabId}-${id}-tab'}`; `role="tab"`; `onClick={() => setTab(id)}`; `onKeyDown={(event) => tabKey(event, index)}` |
| I0483 | 577 | `Link` | `href={reportUrl("person", person.id)}` |

### src/components/content-hub/ArticleCard.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0484 | 10 | `Link` | `href={'/blog/${article.slug}'}` |
| I0485 | 23 | `Link` | `href={'/blog/${article.slug}'}` |

### src/components/content-hub/ArticleEditor.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0486 | 28 | `form` | `action={action}`; `id="uredi"` |
| I0487 | 30 | `input` | `type="hidden"`; `name="actor"`; `value={actor}` |
| I0488 | 31 | `input` | `type="hidden"`; `name="revision"`; `value={article?.revision ?? 0}` |
| I0489 | 34 | `input` | `name="title"`; `onChange={(event) => setTitle(event.target.value)}`; `value={title}` |
| I0490 | 45 | `input` | `name="slug"`; `onChange={(event) => setCustomSlug(event.target.value)}`; `value={customSlug ?? slugSuggestion(title)}` |
| I0491 | 59 | `select` | `name="category"`; `onChange={(event) => setCategory(event.target.value)}`; `value={category}` |
| I0492 | 73 | `textarea` | `name="excerpt"`; `onChange={(event) => setExcerpt(event.target.value)}`; `value={excerpt}` |
| I0493 | 85 | `textarea` | `name="body"`; `placeholder="Odvoji odlomke praznim redom."`; `onChange={(event) => setBody(event.target.value)}`; `value={body}` |
| I0494 | 97 | `input` | `type="checkbox"`; `name="published"`; `onChange={(event) => setPublished(event.target.checked)}`; `checked={published}`; `value="yes"` |
| I0495 | 107 | `input` | `type="checkbox"`; `name="featured"`; `onChange={(event) => setFeatured(event.target.checked)}`; `disabled={!published}`; `checked={published && featured}`; `value="yes"` |
| I0496 | 119 | `button` | `type="submit"`; `disabled={pending}` |
| I0497 | 123 | `Link` | `href={'/blog/${article.slug}'}` |

### src/components/content-hub/BookmarkForm.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0498 | 20 | `form` | `action={action}` |
| I0499 | 21 | `input` | `type="hidden"`; `name="actor"`; `value={actor}` |
| I0500 | 22 | `input` | `type="hidden"`; `name="slug"`; `value={slug}` |
| I0501 | 23 | `input` | `type="hidden"`; `name="save"`; `value={saved ? "no" : "yes"}` |
| I0502 | 24 | `button` | `type="submit"`; `disabled={pending}` |

### src/components/content-hub/HelpDesk.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0503 | 59 | `form` | `onSubmit={ask}` |
| I0504 | 63 | `input` | `type="search"`; `id="help-question"`; `placeholder="Npr. Kako da promijenim termin?"`; `onChange={(event) => setQuestion(event.target.value)}`; `value={question}` |
| I0505 | 72 | `button` | `type="submit"` |
| I0506 | 80 | `button` | `type="button"`; `onClick={() => { setPrevious(helpTopics[id].question); setMatched(id); }}` |
| I0507 | 112 | `Link` | `href={link.href}` |
| I0508 | 124 | `button` | `type="button"`; `onClick={() => { setDetail(previous); setTopic(matched ?? "ostalo"); detailsField.current?.focus(); }}` |
| I0509 | 150 | `form` | `action={action}` |
| I0510 | 151 | `input` | `type="hidden"`; `name="actor"`; `value={actor}` |
| I0511 | 152 | `input` | `type="hidden"`; `name="subject"`; `value="help"` |
| I0512 | 153 | `input` | `type="hidden"`; `name="reference"`; `value={ packageContract && topic === "naplata" ? 'ugovor--${packageContract}' : '${topic}--${requestId}' }` |
| I0513 | 164 | `select` | `onChange={(event) => setTopic(helpTopic(event.target.value) ?? "ostalo")}`; `value={topic}` |
| I0514 | 178 | `textarea` | `name="details"`; `id="support-details"`; `placeholder="Kada se desilo i na kojoj stranici?"`; `onChange={(event) => setDetail(event.target.value)}`; `value={detail}` |
| I0515 | 194 | `button` | `type="submit"`; `disabled={pending}` |
| I0516 | 201 | `Link` | `href="/prijava?nastavi=%2Fpomoc"` |
| I0517 | 207 | `a` | `href={'mailto:${supportEmail}?subject=AhiBizz%20podr%C5%A1ka'}` |

### src/components/design/DesignInspector.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0518 | 106 | `summary` | Native/roditeljska interakcija; vidi izvor |
| I0519 | 121 | `input` | `type="color"`; `id={id}`; `onChange={(e) => set( prop.name, e.target.value + (prop.name === "background-color" && alpha < 255 ? alpha.toString(16).padStart(2, "0") : ""), ) }`; `value={hex.slice(0, 7)}` |
| I0520 | 136 | `input` | `type="number"`; `id={id}`; `placeholder={current?.split(" ")[0]?.replace("px", "") &#124;&#124; "–"}`; `onChange={(e) => { const v = e.target.value; if (v === "") { set(prop.name, undefined); return; } const n = Number(v); if ( Number.isInteger(n) && n >= (prop.min ?? 0) && n <= (prop.max ?? 99) ) set(prop.name, '${n}px'); }}`; `value={value?.slice(0, -2) ?? ""}` |
| I0521 | 160 | `select` | `id={id}`; `onChange={(e) => set(prop.name, e.target.value &#124;&#124; undefined)}`; `value={value ?? ""}` |
| I0522 | 174 | `button` | `type="button"`; `aria-label={'Vrati iz teme — ${prop.label}'}`; `title="Vrati iz teme"`; `onClick={() => set(prop.name, undefined)}` |
| I0523 | 188 | `input` | `type="range"`; `id="surface-alpha"`; `onChange={(e) => { const a = Math.round((Number(e.target.value) / 100) * 255); set( prop.name, hex.slice(0, 7) + (a === 255 ? "" : a.toString(16).padStart(2, "0")), ); }}`; `value={Math.round((alpha / 255) * 100)}` |
| I0524 | 231 | `summary` | Native/roditeljska interakcija; vidi izvor |
| I0525 | 235 | `select` | `onChange={(event) => change({ ...design, heroImage: homeCoverId(event.target.value) })}`; `value={homeCoverId(design.heroImage)}` |
| I0526 | 248 | `textarea` | `aria-label="Glavni naslov"`; `onChange={(e) => change({ ...design, heroTitle: e.target.value })}`; `value={design.heroTitle}` |
| I0527 | 258 | `textarea` | `aria-label="Podnaslov"`; `onChange={(e) => change({ ...design, heroSubtitle: e.target.value })}`; `value={design.heroSubtitle ?? ""}` |
| I0528 | 274 | `input` | `aria-label={'Naslov sekcije — ${label}'}`; `placeholder={label}`; `onChange={(e) => change({ ...design, sectionTitles: { ...design.sectionTitles, [id]: e.target.value }, }) }`; `value={design.sectionTitles?.[id] ?? ""}` |
| I0529 | 288 | `button` | `type="button"`; `aria-label={'Pomjeri gore — ${label}'}`; `onClick={() => move(i, -1)}`; `disabled={i === 0}` |
| I0530 | 296 | `button` | `type="button"`; `aria-label={'Pomjeri dolje — ${label}'}`; `onClick={() => move(i, 1)}`; `disabled={i === design.homeOrder.length - 1}` |

### src/components/design/SimulatorScreens.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0531 | 154 | `button` | `type="button"` |
| I0532 | 158 | `a` | `href="/pretraga"` |
| I0533 | 198 | `a` | `href="/nalog"` |
| I0534 | 202 | `a` | `href="/nalog?odjeljak=djelatnosti"` |
| I0535 | 206 | `a` | `href="/nalog?odjeljak=poruke"` |
| I0536 | 213 | `a` | `href="/nalog?odjeljak=termini"` |

### src/components/design/VisualDesigner.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0537 | 229 | `a` | `href="/administracija"` |
| I0538 | 233 | `button` | `type="button"`; `aria-label="Poništi posljednju izmjenu"`; `title="Poništi posljednju izmjenu"`; `onClick={undo}`; `disabled={!history.length &#124;&#124; busy}` |
| I0539 | 242 | `button` | `type="button"`; `onClick={() => void save("draft")}`; `disabled={busy &#124;&#124; !dirty &#124;&#124; !validDesign &#124;&#124; conflict}` |
| I0540 | 249 | `button` | `type="button"`; `onClick={() => setConfirm("publish")}`; `disabled={busy &#124;&#124; !unpublished &#124;&#124; !validDesign &#124;&#124; conflict}` |
| I0541 | 271 | `button` | `type="button"`; `onClick={() => location.reload()}` |
| I0542 | 283 | `button` | `type="button"`; `onClick={() => setConfirm(null)}` |
| I0543 | 286 | `button` | `type="button"`; `onClick={() => { if (confirm === "publish") void save("publish"); else { edit(defaultVisualDesign()); setConfirm(null); } }}` |
| I0544 | 304 | `select` | `aria-label="Ekran"`; `onChange={(e) => { if (isScreen(e.target.value)) chooseScreen(e.target.value); }}`; `value={screen}` |
| I0545 | 320 | `select` | `aria-label="Uređaj"`; `onChange={(e) => setWidth(Number(e.target.value))}`; `value={width}` |
| I0546 | 334 | `select` | `aria-label="Tema"`; `onChange={(e) => setDark(e.target.value === "dark")}`; `value={dark ? "dark" : "light"}` |
| I0547 | 344 | `button` | `type="button"`; `onClick={() => setInspect(true)}` |
| I0548 | 347 | `button` | `type="button"`; `onClick={() => setInspect(false)}` |
| I0549 | 353 | `button` | `type="button"`; `onClick={() => setMobilePane("preview")}` |
| I0550 | 360 | `button` | `type="button"`; `onClick={() => setMobilePane("edit")}` |
| I0551 | 376 | `iframe` | `title="Simulator AhiBizz aplikacije"`; `src={designerFramePath}` |
| I0552 | 396 | `select` | `aria-label="Element"`; `onChange={(e) => chooseTarget(e.target.value)}`; `value={selected}` |
| I0553 | 410 | `select` | `aria-label="Primijeni na"`; `onChange={(e) => chooseVariant(e.target.value as DesignVariant)}`; `value={variant}` |
| I0554 | 432 | `button` | `type="button"`; `onClick={() => setConfirm("reset")}`; `disabled={busy}` |

### src/components/directory/BusinessChanges.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0555 | 38 | `summary` | Native/roditeljska interakcija; vidi izvor |

### src/components/directory/BusinessDeleteAction.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0556 | 83 | `button` | `type="button"`; `onClick={open}`; `disabled={disabled}` |
| I0557 | 106 | `button` | `type="button"`; `onClick={() => dialog.current?.close()}`; `disabled={busy}` |
| I0558 | 114 | `button` | `type="button"`; `onClick={confirm}`; `disabled={busy &#124;&#124; disabled}` |

### src/components/directory/BusinessDetailsManager.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0559 | 219 | `form` | `aria-label="Radno vrijeme i sadržaji"`; `onSubmit={(event) => { event.preventDefault(); void save(); }}` |
| I0560 | 233 | `button` | `type="button"`; `onClick={onBack}`; `disabled={busy}` |
| I0561 | 248 | `button` | `type="button"`; `onClick={() => setRefresh((current) => current + 1)}` |
| I0562 | 259 | `input` | `type="checkbox"`; `onChange={(event) => setValue({ ...value, enabled: event.target.checked })}`; `checked={value.enabled}` |
| I0563 | 270 | `input` | `id={'${id}-zone'}`; `onChange={(event) => setValue({ ...value, timezone: event.target.value })}`; `value={value.timezone}` |
| I0564 | 298 | `input` | `aria-label={'${businessWeekdays[day]}, interval ${index + 1}, od'}`; `placeholder="09:00"`; `onChange={(event) => dayChange( day, windows.map((entry, slot) => slot === index ? { ...entry, start: event.target.value } : entry, ), ) }`; `value={window.start}` |
| I0565 | 314 | `input` | `aria-label={'${businessWeekdays[day]}, interval ${index + 1}, do'}`; `placeholder="17:00"`; `onChange={(event) => dayChange( day, windows.map((entry, slot) => slot === index ? { ...entry, end: event.target.value } : entry, ), ) }`; `value={window.end}` |
| I0566 | 329 | `button` | `type="button"`; `aria-label={'Ukloni interval ${index + 1}, ${businessWeekdays[day]}'}`; `onClick={() => dayChange( day, windows.filter((_, slot) => slot !== index), ) }` |
| I0567 | 344 | `button` | `type="button"`; `onClick={() => dayChange(day, [ ...windows, { id: crypto.randomUUID(), start: "09:00", end: "17:00" }, ]) }` |
| I0568 | 371 | `input` | `type="checkbox"`; `onChange={(event) => setValue({ ...value, amenities: event.target.checked ? [...value.amenities, entry.id] : value.amenities.filter((id) => id !== entry.id), }) }`; `checked={value.amenities.includes(entry.id)}` |
| I0569 | 389 | `button` | `type="submit"`; `disabled={disabled}` |

### src/components/directory/BusinessEditor.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0570 | 110 | `form` | `aria-label="Podaci djelatnosti"`; `onChange={onDirty}`; `onSubmit={submit}` |
| I0571 | 127 | `input` | `name="title"`; `id={'${prefix}-title'}`; `placeholder="Kako se zove tvoj posao?"` |
| I0572 | 139 | `select` | `id={'${prefix}-category'}`; `onChange={(event) => { setCategory(event.target.value); setSubcategory(""); }}`; `value={category}` |
| I0573 | 158 | `select` | `id={'${prefix}-subcategory'}`; `onChange={(event) => setSubcategory(event.target.value)}`; `disabled={!category &#124;&#124; children.length === 0}`; `value={subcategory}` |
| I0574 | 177 | `textarea` | `name="description"`; `id={'${prefix}-description'}`; `placeholder="Ukratko opiši šta nudiš."` |
| I0575 | 193 | `input` | `type="tel"`; `name="contactPhone"`; `id={'${prefix}-phone'}`; `placeholder="+387…"` |
| I0576 | 205 | `input` | `type="email"`; `name="contactEmail"`; `id={'${prefix}-email'}`; `placeholder="kontakt@…"` |
| I0577 | 218 | `input` | `type="url"`; `name="websiteUrl"`; `id={'${prefix}-website'}`; `placeholder="https://…"` |
| I0578 | 232 | `LocationPicker` | `onChange={(selection) => { onDirty?.(); setPoint(selection.point); if (selection.address) { setAddress(selection.address.addressLine ?? ""); setCity(selection.address.city ?? ""); setCountry(selection.address.countryCode ?? ""); } }}`; `disabled={busy}`; `value={point}` |
| I0579 | 249 | `input` | `name="addressLine"`; `id={'${prefix}-address'}`; `onChange={(event) => setAddress(event.target.value)}`; `value={address}` |
| I0580 | 261 | `input` | `name="city"`; `id={'${prefix}-city'}`; `onChange={(event) => setCity(event.target.value)}`; `value={city}` |
| I0581 | 272 | `select` | `name="countryCode"`; `id={'${prefix}-country'}`; `onChange={(event) => setCountry(event.target.value)}`; `value={country}` |
| I0582 | 308 | `input` | `type="checkbox"`; `id={'${prefix}-booking'}`; `onChange={(event) => { bookingDirty.current = event.target.checked !== knownBooking; setBookingChoice(event.target.checked); }}`; `checked={bookingChoice ?? knownBooking}` |
| I0583 | 325 | `button` | `type="submit"`; `name="intent"`; `disabled={locationPending}`; `value="publish"` |
| I0584 | 347 | `button` | `type="submit"`; `name="intent"`; `disabled={locationPending}`; `value="draft"` |
| I0585 | 357 | `button` | `type="button"`; `onClick={onCancel}` |

### src/components/directory/BusinessGallery.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0586 | 72 | `a` | `href={item.src}`; `aria-label={'Otvori fotografiju ${position + 1} od ${photos.length}'}`; `onClick={(event) => { if (event.metaKey &#124;&#124; event.ctrlKey &#124;&#124; event.shiftKey &#124;&#124; event.altKey) return; event.preventDefault(); show(position); }}` |
| I0587 | 99 | `dialog` | `aria-label="Galerija fotografija"`; `onKeyDown={(event) => { if (event.key === "ArrowLeft" &#124;&#124; event.key === "ArrowRight") { event.preventDefault(); step(event.key === "ArrowLeft" ? -1 : 1); } }}` |
| I0588 | 118 | `button` | `type="button"`; `aria-label="Zatvori galeriju"`; `onClick={close}` |
| I0589 | 123 | `div` | `onTouchStart={(event) => { const touch = event.touches[0]; touchStart.current = event.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY } : null; }}` |
| I0590 | 156 | `button` | `type="button"`; `aria-label="Prethodna fotografija"`; `onClick={() => step(-1)}` |
| I0591 | 159 | `button` | `type="button"`; `aria-label="Sljedeća fotografija"`; `onClick={() => step(1)}` |

### src/components/directory/BusinessManager.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0592 | 1007 | `button` | `type="button"`; `onClick={() => setStayBusiness(null)}` |
| I0593 | 1027 | `button` | `type="button"`; `onClick={() => setRentalBusiness(null)}` |
| I0594 | 1142 | `button` | `type="button"`; `onClick={() => { if (creation.current.intent) return; setEditing(null); setError(""); setNotice(""); setBookingNote(""); }}`; `disabled={locked &#124;&#124; loading &#124;&#124; categories.length === 0}` |
| I0595 | 1166 | `Link` | `href="/prijava?nastavi=%2Fnalog%3Fodjeljak%3Ddjelatnosti"`; `aria-label="Obnovi prijavu u novoj kartici"` |
| I0596 | 1180 | `button` | `type="button"`; `onClick={() => void save(pendingCreate.fields, pendingCreate.publish, pendingCreate)}`; `disabled={!active}` |
| I0597 | 1193 | `button` | `type="button"`; `onClick={() => void checkPreviousMutation()}`; `disabled={!active}` |
| I0598 | 1221 | `button` | `type="button"`; `onClick={() => setStayBusiness(editing)}`; `disabled={locked &#124;&#124; editorDirty}` |
| I0599 | 1233 | `button` | `type="button"`; `onClick={() => setBookingBusiness(editing)}`; `disabled={locked &#124;&#124; editorDirty}` |
| I0600 | 1244 | `button` | `type="button"`; `onClick={() => setRentalBusiness(editing)}`; `disabled={locked &#124;&#124; editorDirty}` |
| I0601 | 1253 | `button` | `type="button"`; `title={editorDirty ? "Prvo sačuvaj izmjene djelatnosti" : undefined}`; `onClick={() => setDetailsBusiness(editing)}`; `disabled={locked &#124;&#124; editorDirty}` |
| I0602 | 1264 | `button` | `type="button"`; `title={editorDirty ? "Prvo sačuvaj izmjene djelatnosti" : undefined}`; `onClick={() => setOwnershipBusiness(editing)}`; `disabled={locked &#124;&#124; editorDirty}` |
| I0603 | 1314 | `form` | `aria-label={rejectRevision ? "Odbijanje izmjena" : "Vraćanje djelatnosti u nacrt"}`; `onSubmit={(event) => { event.preventDefault(); void move( returning, rejectRevision ? "reject-changes" : "return-to-draft", returnReason, ); }}` |
| I0604 | 1331 | `input` | `id={returnReasonId}`; `onChange={(event) => setReturnReason(event.target.value)}`; `value={returnReason}` |
| I0605 | 1343 | `button` | `type="submit"` |
| I0606 | 1346 | `button` | `type="button"`; `onClick={() => { setReturning(null); setReturnReason(""); setError(""); }}` |
| I0607 | 1364 | `form` | `onSubmit={(event) => { event.preventDefault(); applySearch(searchText); }}` |
| I0608 | 1371 | `input` | `type="search"`; `name="q"`; `aria-label="Naziv ili grad"`; `placeholder="Naziv ili grad"`; `onChange={(event) => { const next = event.target.value; setSearchText(next); if (!next && searchQuery) applySearch(""); }}`; `disabled={locked}`; `value={searchText}` |
| I0609 | 1385 | `button` | `type="submit"`; `disabled={locked}` |
| I0610 | 1389 | `button` | `type="button"`; `onClick={() => applySearch("")}`; `disabled={locked}` |
| I0611 | 1405 | `input` | `type="checkbox"`; `onChange={(event) => { if (!archived) setFilter("active"); setAll(event.target.checked); setPage(1); }}`; `disabled={locked &#124;&#124; loading}`; `checked={all}` |
| I0612 | 1420 | `input` | `type="checkbox"`; `onChange={(event) => { setFilter(event.target.checked ? "review" : "active"); if (event.target.checked) setAll(true); setPage(1); }}`; `disabled={locked &#124;&#124; loading}`; `checked={reviewOnly}` |
| I0613 | 1435 | `input` | `type="checkbox"`; `onChange={(event) => { setFilter(event.target.checked ? "missingMap" : "active"); if (event.target.checked) setAll(true); setPage(1); }}`; `disabled={locked &#124;&#124; loading}`; `checked={missingMap}` |
| I0614 | 1449 | `input` | `type="checkbox"`; `onChange={(event) => { setFilter(event.target.checked ? "archived" : "active"); setPage(1); }}`; `disabled={locked &#124;&#124; loading}`; `checked={archived}` |
| I0615 | 1461 | `button` | `type="button"`; `onClick={() => { setError(""); setRefresh((value) => value + 1); }}`; `disabled={locked &#124;&#124; loading}` |
| I0616 | 1544 | `button` | `type="button"`; `onClick={() => setStayBusiness(item)}`; `disabled={locked &#124;&#124; loading}` |
| I0617 | 1555 | `button` | `type="button"`; `onClick={() => setRentalBusiness(item)}`; `disabled={locked &#124;&#124; loading}` |
| I0618 | 1565 | `Link` | `href={'/djelatnosti/${item.id}'}` |
| I0619 | 1570 | `Link` | `href={'/nalog/reels?djelatnost=${item.id}'}` |
| I0620 | 1579 | `button` | `type="button"`; `onClick={() => { setEditing(item); setError(""); setNotice(""); setBookingNote(""); }}`; `disabled={locked &#124;&#124; loading}` |
| I0621 | 1592 | `button` | `type="button"`; `onClick={() => { setMediaBusiness(item); setError(""); setNotice(""); setBookingNote(""); }}`; `disabled={locked &#124;&#124; loading}` |
| I0622 | 1606 | `button` | `type="button"`; `onClick={() => { if (cars) setRentalBusiness(item); else setBookingBusiness(item); setError(""); setNotice(""); setBookingNote(""); }}`; `disabled={locked &#124;&#124; loading}` |
| I0623 | 1625 | `a` | `href="/paketi/placanje?paket=basic&period=monthly"` |
| I0624 | 1634 | `button` | `type="button"`; `onClick={() => move(item, "publish")}`; `disabled={ locked &#124;&#124; loading &#124;&#124; (!isOwner && item.status === "pending") }` |
| I0625 | 1647 | `button` | `type="button"`; `onClick={() => void move(item, "approve-changes")}`; `disabled={locked &#124;&#124; loading}` |
| I0626 | 1655 | `button` | `type="button"`; `onClick={() => { setRejectRevision(true); setReturning(item); setReturnReason(""); setError(""); setNotice(""); }}`; `disabled={locked &#124;&#124; loading}` |
| I0627 | 1672 | `button` | `type="button"`; `onClick={() => { setRejectRevision(false); setReturning(item); setReturnReason(""); setError(""); setNotice(""); }}`; `disabled={locked &#124;&#124; loading}` |
| I0628 | 1688 | `button` | `type="button"`; `onClick={() => setPromotionId((current) => (current === item.id ? null : item.id)) }`; `disabled={locked &#124;&#124; loading}` |
| I0629 | 1701 | `button` | `type="button"`; `onClick={() => move(item, "archive")}`; `disabled={locked &#124;&#124; loading}` |
| I0630 | 1711 | `button` | `type="button"`; `onClick={() => move(item, "recover")}`; `disabled={locked &#124;&#124; loading}` |
| I0631 | 1740 | `Link` | `href={'/naplata?djelatnost=${encodeURIComponent(item.id)}'}` |
| I0632 | 1747 | `Link` | `href={placementOfferPath({ businessId: item.id, placement: "nearby" })}` |
| I0633 | 1754 | `Link` | `href={placementOfferPath({ businessId: item.id, placement: "featured" })}` |
| I0634 | 1761 | `Link` | `href={placementOfferPath({ businessId: item.id, placement: "banner" })}` |
| I0635 | 1776 | `button` | `type="button"`; `onClick={() => setPage(page - 1)}`; `disabled={page === 1 &#124;&#124; locked &#124;&#124; loading}` |
| I0636 | 1785 | `button` | `type="button"`; `onClick={() => setPage(page + 1)}`; `disabled={!canContinue &#124;&#124; locked &#124;&#124; loading}` |

### src/components/directory/BusinessMediaManager.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0637 | 74 | `input` | `type="file"`; `id={id}`; `aria-label={label}`; `accept="image/jpeg,image/png,image/webp"`; `onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) onFile(file); }}`; `disabled={disabled}` |
| I0638 | 88 | `button` | `type="button"`; `onClick={() => input.current?.click()}`; `disabled={disabled}` |
| I0639 | 444 | `button` | `type="button"`; `onClick={onBack}`; `disabled={busy &#124;&#124; pending !== null}` |
| I0640 | 468 | `button` | `type="button"`; `onClick={() => void load()}`; `disabled={busy &#124;&#124; loading &#124;&#124; !active}` |
| I0641 | 482 | `button` | `type="button"`; `onClick={() => void send(pending)}`; `disabled={!active}` |
| I0642 | 526 | `button` | `type="button"`; `onClick={() => act("logo", 0, null)}`; `disabled={disabled}` |
| I0643 | 565 | `button` | `type="button"`; `onClick={() => act("cover", 0, null)}`; `disabled={disabled}` |
| I0644 | 601 | `button` | `type="button"`; `onClick={() => act("gallery", asset.slot, null)}`; `disabled={disabled}` |

### src/components/directory/BusinessOwnershipManager.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0645 | 296 | `button` | `type="button"`; `onClick={onBack}`; `disabled={busy}` |
| I0646 | 317 | `form` | `onSubmit={(event) => { event.preventDefault(); void lookup(); }}` |
| I0647 | 325 | `input` | `type="email"`; `placeholder="ime@primjer.ba"`; `onChange={(event) => { setEmail(event.target.value); setCandidate(null); }}`; `disabled={busy &#124;&#124; loading}`; `value={email}` |
| I0648 | 339 | `button` | `type="submit"`; `disabled={busy &#124;&#124; loading &#124;&#124; !email.trim()}` |
| I0649 | 356 | `button` | `type="button"`; `onClick={() => void assign()}`; `disabled={busy &#124;&#124; loading}` |
| I0650 | 369 | `button` | `type="button"`; `onClick={() => void refresh()}`; `disabled={busy &#124;&#124; loading}` |
| I0651 | 381 | `button` | `type="button"`; `onClick={() => { if (pending.current) void assign(pending.current); }}`; `disabled={busy &#124;&#124; loading}` |

### src/components/directory/DirectoryResultCard.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0652 | 53 | `Link` | `href={profile}`; `aria-label={'Otvori ${business.title}'}` |
| I0653 | 89 | `Link` | `href={profile}`; `title={business.title}` |
| I0654 | 120 | `Link` | `href={messageLink({ kind: "business", targetId: business.id })}`; `aria-label={'Pošalji poruku — ${business.title}'}`; `title="Pošalji poruku"` |
| I0655 | 128 | `Link` | `href={'${profile}#business-location'}`; `aria-label={'Prikaži lokaciju — ${business.title}'}`; `title="Prikaži lokaciju"` |
| I0656 | 136 | `Link` | `href={profile}`; `aria-label={'Pogledaj profil — ${business.title}'}`; `title="Pogledaj profil"` |

### src/components/directory/DirectorySearchForm.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0657 | 66 | `input` | `type="hidden"`; `name="istaknute"`; `value={featuredOnly === "all" ? "sve" : featuredOnly === "category" ? "kategorija" : "1"}` |
| I0658 | 74 | `input` | `type="search"`; `name="q"`; `id={'${prefix}-query'}`; `placeholder="Šta tražiš?"` |
| I0659 | 83 | `button` | `type="button"`; `onClick={() => setFiltersOpen((value) => !value)}` |
| I0660 | 95 | `input` | `name="mjesto"`; `id={'${prefix}-city'}`; `placeholder="Npr. Tuzla"` |
| I0661 | 105 | `select` | `name="categoryId"`; `id={'${prefix}-category'}`; `onChange={(event) => { setCategory(event.target.value); setSubcategory(""); }}`; `value={category}` |
| I0662 | 127 | `select` | `name="subcategoryId"`; `id={'${prefix}-subcategory'}`; `onChange={(event) => setSubcategory(event.target.value)}`; `value={subcategory}` |
| I0663 | 143 | `input` | `type="checkbox"`; `name="otvoreno"`; `value="1"` |
| I0664 | 147 | `button` | `type="submit"` |

### src/components/directory/LocationPicker.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0665 | 186 | `button` | `type="button"`; `onClick={locate}`; `disabled={disabled &#124;&#124; phase !== "idle"}` |
| I0666 | 198 | `input` | `id={id}`; `placeholder="Naziv, ulica ili grad"`; `onChange={(event) => { setQuery(event.target.value); setResults([]); }}`; `onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }}`; `disabled={disabled &#124;&#124; phase !== "idle"}`; `value={query}` |
| I0667 | 215 | `button` | `type="button"`; `aria-label="Pretraži lokacije"`; `onClick={() => void search()}`; `disabled={disabled &#124;&#124; phase !== "idle"}` |
| I0668 | 229 | `button` | `type="button"`; `onClick={() => choose(result)}`; `disabled={disabled &#124;&#124; phase !== "idle"}` |
| I0669 | 264 | `button` | `type="button"`; `onClick={() => void commitPoint(candidate)}`; `disabled={disabled &#124;&#124; phase !== "idle"}` |
| I0670 | 287 | `button` | `type="button"`; `onClick={() => { setCandidate(null); setResults([]); setNotice(""); change.current({ point: null }); }}`; `disabled={disabled &#124;&#124; phase !== "idle"}` |
| I0671 | 303 | `a` | `href="https://photon.komoot.io/"` |
| I0672 | 307 | `a` | `href="https://www.openstreetmap.org/copyright"` |

### src/components/directory/PublicBusinessProfile.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0673 | 90 | `Link` | `href={backHref}` |
| I0674 | 114 | `details` | `onKeyDown={(e) => { if (e.key === "Escape") { e.currentTarget.open = false; e.currentTarget.querySelector("summary")?.focus(); } }}` |
| I0675 | 126 | `summary` | `aria-label="Opcije djelatnosti"` |
| I0676 | 129 | `Link` | `href={reportUrl("business", business.id)}` |
| I0677 | 158 | `a` | `href="#recenzije"` |
| I0678 | 167 | `Link` | `href={contactMessage}`; `aria-label="Poruka — pošalji poruku"` |
| I0679 | 176 | `a` | `href={links.phone}` |
| I0680 | 181 | `a` | `href={links.email}`; `aria-label="Pošalji email"` |
| I0681 | 187 | `a` | `href={links.website}`; `aria-label="Web stranica"` |
| I0682 | 204 | `a` | `href="#business-about"` |
| I0683 | 205 | `a` | `href="#business-hours"` |
| I0684 | 208 | `a` | `href="#business-appointments"` |
| I0685 | 212 | `a` | `href="#business-gallery"` |
| I0686 | 213 | `a` | `href="#business-location"` |
| I0687 | 214 | `a` | `href="#recenzije"` |
| I0688 | 215 | `a` | `href="#business-contact"` |
| I0689 | 300 | `a` | `href={driving}` |
| I0690 | 307 | `a` | `href={walking}` |
| I0691 | 334 | `a` | `href={links.phone}` |
| I0692 | 344 | `a` | `href={links.email}` |
| I0693 | 354 | `a` | `href={links.website}` |
| I0694 | 369 | `Link` | `href={contactMessage}` |
| I0695 | 376 | `a` | `href="#business-location"` |

### src/components/favorites/FavoriteButton.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0696 | 36 | `Link` | `href={authReturnLinks('/djelatnosti/${businessId}#sacuvaj').login}`; `id={compact ? undefined : "sacuvaj"}`; `aria-label={'Prijavi se i sačuvaj — ${title}'}`; `title="Prijavi se i sačuvaj profil"` |
| I0697 | 50 | `button` | `type="button"`; `aria-label={'${label} — ${title}'}`; `title={status === "denied" ? "Sačuvani profili nisu dostupni ovom nalogu" : label}`; `onClick={() => (error &#124;&#124; status === "unavailable" ? refresh() : toggle(businessId))}`; `disabled={ busy.has(businessId) &#124;&#124; status === "checking" &#124;&#124; status === "denied" &#124;&#124; (status === "signed" && !state) }` |
| I0698 | 73 | `button` | `type="button"`; `onClick={() => retry(businessId)}`; `disabled={busy.has(businessId)}` |

### src/components/favorites/SavedBusinesses.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0699 | 145 | `button` | `type="button"`; `onClick={() => setRefresh((v) => v + 1)}`; `disabled={busy}` |
| I0700 | 158 | `Link` | `href="/pretraga"` |
| I0701 | 171 | `button` | `type="button"`; `onClick={() => setPage((v) => v - 1)}`; `disabled={busy &#124;&#124; page === 1}` |
| I0702 | 180 | `button` | `type="button"`; `onClick={() => setPage((v) => v + 1)}`; `disabled={busy &#124;&#124; !data?.hasMore &#124;&#124; page >= 1000}` |

### src/components/favorites/SavedSearches.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0703 | 55 | `button` | `type="button"`; `onClick={() => void save()}`; `disabled={status === "busy" &#124;&#124; status === "saved"}` |
| I0704 | 64 | `Link` | `href={'/prijava?nastavi=${encodeURIComponent("/pretraga" + props.filters)}'}` |
| I0705 | 102 | `Link` | `href={'/pretraga${item.filters}'}` |
| I0706 | 107 | `button` | `type="button"`; `aria-label={'Ukloni pretragu ${item.label}'}`; `onClick={() => void remove(item.filters)}`; `disabled={busy}` |

### src/components/home/HomeCategories.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0707 | 25 | `Link` | `href={searchAction}` |
| I0708 | 33 | `Link` | `href={category.href}` |

### src/components/home/HomeFeaturedRail.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0709 | 74 | `button` | `type="button"`; `onClick={append}`; `disabled={state === "pending"}` |

### src/components/home/HomeNearby.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0710 | 200 | `button` | `type="button"`; `onClick={chooseGps}`; `disabled={location.status === "locating"}` |
| I0711 | 211 | `summary` | Native/roditeljska interakcija; vidi izvor |
| I0712 | 212 | `Form` | `action="/"`; `onSubmit={(event) => { const city = new FormData(event.currentTarget).get("mjesto"); if (typeof city !== "string" &#124;&#124; !city.trim()) { event.preventDefault(); return; } chooseCity(); }}` |
| I0713 | 227 | `input` | `name="mjesto"`; `id="home-place"`; `placeholder="Grad ili mjesto"` |
| I0714 | 235 | `button` | `type="submit"`; `aria-label="Prikaži djelatnosti u ovom mjestu"` |
| I0715 | 251 | `button` | `type="button"`; `onClick={retryRefresh}` |
| I0716 | 277 | `Link` | `href="/pretraga"` |
| I0717 | 281 | `button` | `type="button"`; `onClick={retryRefresh}` |
| I0718 | 317 | `Link` | `href={'/pretraga?mjesto=${encodeURIComponent(place)}'}` |
| I0719 | 322 | `button` | `type="button"`; `onClick={() => setExpanded(true)}` |
| I0720 | 327 | `button` | `type="button"`; `onClick={loadMore}`; `disabled={refresh === "pending" &#124;&#124; pagination === "pending"}` |
| I0721 | 341 | `button` | `type="button"`; `onClick={retryRefresh}` |

### src/components/home/HomeSurface.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0722 | 80 | `Link` | `href={href}` |
| I0723 | 222 | `Link` | `href={banner ? '/djelatnosti/${banner.id}' : advertisingHref}` |
| I0724 | 252 | `Link` | `href="/oglasavanje"` |
| I0725 | 280 | `Link` | `href={creditsHref}` |
| I0726 | 319 | `input` | `type="search"`; `name="q"`; `placeholder="Šta tražiš?"` |
| I0727 | 324 | `input` | `name={placeField}`; `placeholder="Grad ili mjesto"` |
| I0728 | 331 | `button` | `type="submit"`; `aria-label="Pretraži djelatnosti"` |

### src/components/marketing/AdCampaignAsset.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0729 | 32 | `iframe` | `title="HTML5 oglas"` |
| I0730 | 44 | `video` | `aria-label="Video oglasa"`; `controls=true`; `src={source}` |

### src/components/marketing/AdCampaignForm.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0731 | 161 | `Link` | `href="/oglasavanje"` |
| I0732 | 163 | `form` | `onSubmit={request}` |
| I0733 | 166 | `select` | `name="placement"`; `onChange={(e) => setPlacement(e.target.value as Placement)}`; `value={placement}` |
| I0734 | 180 | `select` | `name="business"`; `onChange={(e) => { setBusinessId(e.target.value); setAssetId(""); }}`; `value={business?.id ?? ""}` |
| I0735 | 206 | `select` | `onChange={(e) => setDevice(e.target.value as AdDevice)}`; `value={device}` |
| I0736 | 216 | `select` | `onChange={(e) => setPage(e.target.value as AdPage)}`; `value={page}` |
| I0737 | 227 | `select` | `onChange={(e) => setFormat(e.target.value)}`; `value={chosen?.id ?? ""}` |
| I0738 | 238 | `input` | `type="number"`; `onChange={(e) => setImpressions(e.target.value)}`; `value={impressions}` |
| I0739 | 265 | `summary` | Native/roditeljska interakcija; vidi izvor |
| I0740 | 269 | `input` | `type="date"`; `name="startsOn"` |
| I0741 | 273 | `input` | `type="number"`; `name="budget"`; `disabled={creditRate === null}` |
| I0742 | 287 | `select` | `name="category"` |
| I0743 | 301 | `input` | `type="number"`; `name="minPrice"` |
| I0744 | 312 | `input` | `type="number"`; `name="maxPrice"` |
| I0745 | 324 | `select` | `name="gender"` |
| I0746 | 336 | `input` | `name="keyword"` |
| I0747 | 342 | `select` | `onChange={(e) => setManual(e.target.value === "manual")}`; `value={manual ? "manual" : "context"}` |
| I0748 | 353 | `textarea` | `name="note"`; `placeholder="Npr. ciljanje prema rasponu cijena"` |
| I0749 | 368 | `select` | `onChange={(e) => setAssetId(e.target.value)}`; `value={assetId}` |
| I0750 | 398 | `select` | `name="destination"` |
| I0751 | 407 | `input` | `type="number"`; `name="quantity"` |
| I0752 | 418 | `button` | `type="submit"`; `disabled={busy &#124;&#124; !business &#124;&#124; (placement === "banner" && !chosen)}` |

### src/components/marketing/AdCreativeManager.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0753 | 128 | `summary` | Native/roditeljska interakcija; vidi izvor |
| I0754 | 138 | `form` | `onSubmit={upload}` |
| I0755 | 141 | `input` | `type="file"`; `name="file"`; `accept={adAssetTypes.join(",")}` |
| I0756 | 143 | `button` | `type="submit"`; `disabled={busy}` |
| I0757 | 151 | `button` | `type="button"`; `onClick={() => setAttempt((n) => n + 1)}` |

### src/components/marketing/AdExplorer.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0758 | 172 | `button` | `type="button"`; `onClick={() => setDevice(d)}` |
| I0759 | 184 | `button` | `type="button"`; `onClick={() => setPage(p)}` |
| I0760 | 193 | `select` | `onChange={(event) => setChosen(event.target.value as AdFormatId)}`; `value={selected.format.id}` |
| I0761 | 216 | `input` | `type="file"`; `accept="image/jpeg,image/png,image/webp,image/gif"`; `onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; if ( !["image/jpeg", "image/png", "image/webp", "image/gif"].includes( file.type, ) &#124;&#124; file.size > 1000000 ) { setImageError("Odaberi JPG, PNG, WebP ili GIF do 1.000 KB."); event.target.value = ""; return; } setImage(URL.createObjectURL(file)); setImageError(""); event.target.value = ""; }}` |
| I0762 | 239 | `button` | `type="button"`; `onClick={() => setImage(null)}` |
| I0763 | 268 | `input` | `type="number"`; `onChange={(event) => setImpressions(event.target.value)}`; `value={impressions}` |
| I0764 | 304 | `Link` | `href={campaignPath({ format: selected.format.id, page, device, impressionGoal: validVolume && price !== null ? volume : undefined, })}` |
| I0765 | 325 | `button` | `type="button"`; `onClick={() => setStandardDevice(d)}` |
| I0766 | 410 | `button` | `type="button"`; `aria-label={'Pregledaj format ${format.title}'}`; `onClick={() => preview(format)}`; `disabled={!places.length}` |

### src/components/marketing/AdRateEditor.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0767 | 118 | `summary` | Native/roditeljska interakcija; vidi izvor |
| I0768 | 121 | `form` | `onSubmit={updateRate}` |
| I0769 | 128 | `select` | `onChange={(e) => setPosition(Number(e.target.value))}`; `value={position}` |
| I0770 | 139 | `input` | `type="number"`; `name="cpm"`; `placeholder="Na upit"` |
| I0771 | 150 | `input` | `type="checkbox"`; `name="available"` |
| I0772 | 153 | `button` | `type="submit"`; `disabled={busy}` |
| I0773 | 158 | `summary` | Native/roditeljska interakcija; vidi izvor |
| I0774 | 159 | `form` | `onSubmit={updateTerms}` |
| I0775 | 162 | `input` | `type="number"`; `name="minimum"` |
| I0776 | 175 | `input` | `type="number"`; `name={"v" + i}` |
| I0777 | 187 | `input` | `type="number"`; `name="advance"` |
| I0778 | 198 | `input` | `type="number"`; `name="welcome"` |
| I0779 | 207 | `button` | `type="submit"`; `disabled={busy}` |
| I0780 | 212 | `form` | `onSubmit={(event) => { event.preventDefault(); const phone = String(new FormData(event.currentTarget).get("phone") ?? "").replace( /[ ()-]/g, "", ); void save({ action: "contact", version: pricing.version, contactPhone: phone &#124;&#124; null, }); }}` |
| I0781 | 230 | `input` | `type="tel"`; `name="phone"`; `placeholder="+387…"` |
| I0782 | 238 | `button` | `type="submit"`; `disabled={busy}` |
| I0783 | 248 | `button` | `type="button"`; `onClick={() => setRefresh((v) => v + 1)}`; `disabled={busy}` |

### src/components/marketing/AdResponse.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0784 | 132 | `summary` | Native/roditeljska interakcija; vidi izvor |
| I0785 | 133 | `form` | `onSubmit={send}` |
| I0786 | 139 | `input` | `type="number"`; `onChange={(e) => setP(e.target.value)}`; `value={p}` |
| I0787 | 151 | `input` | `type="number"`; `onChange={(e) => setApr(e.target.value)}`; `value={apr}` |
| I0788 | 163 | `input` | `type="number"`; `onChange={(e) => setMonths(e.target.value)}`; `value={months}` |
| I0789 | 184 | `textarea` | `name="comment"` |
| I0790 | 187 | `summary` | Native/roditeljska interakcija; vidi izvor |
| I0791 | 190 | `input` | `type="tel"`; `name="phone"` |
| I0792 | 194 | `input` | `type="email"`; `name="email"` |
| I0793 | 197 | `button` | `type="submit"`; `disabled={busy}` |
| I0794 | 202 | `Link` | `href={authReturnLinks(thread).login}` |
| I0795 | 204 | `Link` | `href={thread}` |

### src/components/marketing/CampaignAd.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0796 | 140 | `a` | `href={ad.href}`; `aria-label={'Sponzorirano: ${ad.title}'}` |
| I0797 | 156 | `button` | `type="button"`; `aria-label="Zatvori oglas"`; `onClick={() => setDismissed(true)}` |
| I0798 | 219 | `a` | Native/roditeljska interakcija; vidi izvor |
| I0799 | 226 | `button` | `type="button"`; `onClick={() => setRevealed(!revealed)}` |
| I0800 | 238 | `button` | `type="button"`; `aria-label="Prethodna slika oglasa"`; `onClick={() => setFrame((frame + count - 1) % count)}` |
| I0801 | 248 | `button` | `type="button"`; `aria-label="Sljedeća slika oglasa"`; `onClick={() => setFrame((frame + 1) % count)}` |

### src/components/marketing/CampaignGeoTime.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0802 | 37 | `input` | `name="targetCityDraft"`; `placeholder="Odaberi ili upiši grad"`; `onChange={(event) => setDraft(event.target.value)}`; `onKeyDown={(event) => { if (event.key === "Enter" && draft.trim()) { event.preventDefault(); addCity(); } }}`; `disabled={cities.length >= maxCampaignCities}`; `value={draft}` |
| I0803 | 58 | `button` | `type="button"`; `onClick={addCity}`; `disabled={!draft.trim() &#124;&#124; cities.length >= maxCampaignCities}` |
| I0804 | 69 | `input` | `type="hidden"`; `name="targetCity"`; `value={city}` |
| I0805 | 70 | `button` | `type="button"`; `aria-label={'Ukloni ${city}'}`; `onClick={() => setCities((current) => current.filter((item) => item !== city))}` |
| I0806 | 88 | `select` | `name="countryCode"` |
| I0807 | 100 | `select` | `onChange={(e) => setLimited(e.target.value === "limited")}`; `value={limited ? "limited" : "all"}` |
| I0808 | 112 | `input` | `type="time"`; `name="adFrom"` |
| I0809 | 116 | `input` | `type="time"`; `name="adUntil"` |
| I0810 | 120 | `select` | `name="timeZone"` |

### src/components/marketing/CreditBankTransfers.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0811 | 247 | `button` | `type="button"`; `onClick={workspace.reread}` |
| I0812 | 251 | `summary` | Native/roditeljska interakcija; vidi izvor |
| I0813 | 253 | `form` | `onSubmit={(event) => { event.preventDefault(); void workspace.cancel(request); }}` |
| I0814 | 261 | `input` | `type="checkbox"` |
| I0815 | 264 | `button` | `type="submit"`; `disabled={workspace.busy}` |
| I0816 | 279 | `button` | `type="button"`; `onClick={() => { if (workspace.status !== status) workspace.selectStatus(status); }}`; `disabled={workspace.busy}` |
| I0817 | 295 | `button` | `type="button"`; `onClick={workspace.reread}` |
| I0818 | 322 | `button` | `type="button"`; `onClick={() => void workspace.approve(request)}`; `disabled={workspace.busy}` |
| I0819 | 340 | `button` | `type="button"`; `onClick={() => workspace.setPage(workspace.page - 1)}` |
| I0820 | 349 | `button` | `type="button"`; `onClick={() => workspace.setPage(workspace.page + 1)}` |

### src/components/marketing/MarketingWorkspace.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0821 | 176 | `AdCreativeManager` | `onChange={refresh}` |
| I0822 | 235 | `Link` | `href={'/naplata?ponuda=${order.id}'}` |
| I0823 | 255 | `form` | `onSubmit={quote}` |
| I0824 | 259 | `select` | `name="standardTargeting"` |
| I0825 | 270 | `select` | `onChange={(e) => setBenefit(e.target.value as typeof benefit)}`; `value={benefit}` |
| I0826 | 283 | `input` | `type="number"`; `name="credits"` |
| I0827 | 300 | `input` | `name="price"` |
| I0828 | 316 | `input` | `type="number"`; `name="credits"` |
| I0829 | 327 | `textarea` | `name="instructions"` |
| I0830 | 329 | `button` | `type="submit"`; `disabled={busy}` |
| I0831 | 335 | `form` | `onSubmit={confirm}` |
| I0832 | 338 | `input` | `name="received"` |
| I0833 | 342 | `input` | `name="reference"` |
| I0834 | 344 | `button` | `type="submit"`; `disabled={busy}` |
| I0835 | 355 | `button` | `type="button"`; `onClick={() => submit({ action: "useCredits", id: order.id })}`; `disabled={busy}` |
| I0836 | 363 | `Link` | `href={ platformCreditsOnly ? creditTopUpPath('/naplata?ponuda=${order.id}') : "/nalog?odjeljak=krediti" }` |
| I0837 | 376 | `button` | `type="button"`; `onClick={() => submit({ action: "close", id: order.id })}`; `disabled={busy}` |
| I0838 | 627 | `button` | `type="button"`; `onClick={() => setRefresh((value) => value + 1)}` |
| I0839 | 653 | `Link` | `href="/nalog?odjeljak=oglasi"` |
| I0840 | 656 | `Link` | `href="/nalog?odjeljak=oglasi&prikaz=aktivne"` |
| I0841 | 662 | `Link` | `href="/nalog?odjeljak=oglasi&prikaz=zakazane"` |
| I0842 | 683 | `summary` | Native/roditeljska interakcija; vidi izvor |
| I0843 | 684 | `form` | `onSubmit={(event) => { event.preventDefault(); const unitBamMinor = Number(rateInput); if (unitBamMinor > 0) void submit({ action: "setCreditRate", id: crypto.randomUUID(), unitBamMinor, expectedUnitBamMinor: unitPrice, }); }}` |
| I0844 | 700 | `select` | `onChange={(event) => setRateInput(event.target.value)}`; `value={rateInput &#124;&#124; (unitPrice === null ? "" : String(unitPrice))}` |
| I0845 | 715 | `button` | `type="submit"`; `disabled={busy &#124;&#124; !rateInput &#124;&#124; Number(rateInput) === unitPrice}` |
| I0846 | 725 | `Link` | `href={purchaseReturn}` |
| I0847 | 739 | `button` | `type="button"`; `onClick={bankTopUps.reread}` |
| I0848 | 745 | `form` | `onSubmit={topUp}` |
| I0849 | 758 | `input` | `type="radio"`; `name="dopuna"`; `onChange={() => setSelectedQuantity(option.quantity)}`; `checked={bundle.quantity === option.quantity}`; `value={option.quantity}` |
| I0850 | 779 | `input` | `type="radio"`; `name="nacin"`; `onChange={() => setChosenMethod("card")}`; `checked={method === "card"}` |
| I0851 | 790 | `input` | `type="radio"`; `name="nacin"`; `onChange={() => setChosenMethod("paypal")}`; `checked={method === "paypal"}` |
| I0852 | 801 | `input` | `type="radio"`; `name="nacin"`; `onChange={() => setChosenMethod("bank")}`; `checked={method === "bank"}` |
| I0853 | 812 | `button` | `type="submit"`; `disabled={topUpInProgress &#124;&#124; (method === "bank" && !bankOffer)}` |
| I0854 | 838 | `Link` | `href={'/djelatnosti/${item.id}'}` |
| I0855 | 865 | `Link` | `href={'/djelatnosti/${item.id}'}` |
| I0856 | 872 | `Link` | `href="/naplata"` |
| I0857 | 898 | `form` | `onSubmit={request}` |
| I0858 | 901 | `select` | `name="placement"` |
| I0859 | 911 | `select` | `name="business"` |
| I0860 | 919 | `button` | `type="submit"`; `disabled={busy}` |
| I0861 | 926 | `Link` | `href="/nalog?odjeljak=djelatnosti"` |
| I0862 | 934 | `summary` | Native/roditeljska interakcija; vidi izvor |
| I0863 | 1014 | `button` | `type="button"`; `onClick={() => setPage(page - 1)}` |
| I0864 | 1019 | `button` | `type="button"`; `onClick={() => setPage(page + 1)}` |

### src/components/messaging/MessagingInbox.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0865 | 1005 | `Link` | `href="/prijava?nastavi=%2Fnalog%3Fodjeljak%3Dporuke"`; `aria-label={pending ? "Prijavi se u novoj kartici" : undefined}` |
| I0866 | 1028 | `button` | `type="button"`; `onClick={() => void commit(pending)}`; `disabled={busy}` |
| I0867 | 1051 | `button` | `type="button"`; `aria-label="Osvježi razgovore"`; `title="Osvježi razgovore"`; `onClick={refresh}`; `disabled={interactionLocked &#124;&#124; !usable}` |
| I0868 | 1066 | `input` | `type="search"`; `aria-label="Pretraži razgovore"`; `placeholder="Pretraži razgovore"`; `onChange={(event) => setSearch(event.target.value)}`; `disabled={interactionLocked &#124;&#124; !usable}`; `value={search}` |
| I0869 | 1078 | `button` | `type="button"`; `aria-label="Obriši pretragu"`; `onClick={() => { setSearch(""); inboxSearch.current?.focus(); }}`; `disabled={interactionLocked}` |
| I0870 | 1095 | `button` | `type="button"`; `onClick={() => switchInbox("personal")}`; `disabled={interactionLocked}` |
| I0871 | 1103 | `button` | `type="button"`; `onClick={() => switchInbox("business")}`; `disabled={interactionLocked}` |
| I0872 | 1114 | `button` | `type="button"`; `onClick={() => filterUnread(false)}`; `disabled={interactionLocked}` |
| I0873 | 1122 | `button` | `type="button"`; `onClick={() => filterUnread(true)}`; `disabled={interactionLocked}` |
| I0874 | 1137 | `Link` | `href="/pomoc?tema=sigurnost"` |
| I0875 | 1138 | `button` | `type="button"`; `aria-label="Sakrij savjet"`; `onClick={dismissSafetyTip}` |
| I0876 | 1150 | `button` | `type="button"`; `onClick={(event) => choose(item, event.currentTarget)}`; `disabled={interactionLocked}` |
| I0877 | 1203 | `button` | `type="button"`; `onClick={() => setPage(page - 1)}`; `disabled={page === 1 &#124;&#124; busy &#124;&#124; Boolean(pending)}` |
| I0878 | 1211 | `button` | `type="button"`; `onClick={() => setPage(page + 1)}`; `disabled={!hasMore &#124;&#124; busy &#124;&#124; Boolean(pending)}` |
| I0879 | 1228 | `button` | `type="button"`; `aria-label="Nazad na razgovore"`; `onClick={closeConversation}`; `disabled={interactionLocked}` |
| I0880 | 1245 | `details` | `onKeyDown={(event) => { if (event.key !== "Escape" &#124;&#124; !event.currentTarget.open) return; event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); }}` |
| I0881 | 1253 | `summary` | `aria-label="Opcije razgovora"`; `title="Opcije razgovora"` |
| I0882 | 1257 | `button` | `type="button"`; `onClick={(event) => { const menu = event.currentTarget.closest("details"); if (menu) menu.open = false; void commit({ action: "block", path: 'threads/${thread.id}/block', body: { blocked: !thread.blockedByMe }, threadId: thread.id, key: crypto.randomUUID(), }); }}`; `disabled={interactionLocked}` |
| I0883 | 1277 | `Link` | `href={reportUrl("conversation", thread.id)}` |
| I0884 | 1295 | `button` | `type="button"`; `onClick={() => void loadConversation(selected, conversation.items[0]?.sequence)}`; `disabled={older &#124;&#124; busy &#124;&#124; Boolean(pending)}` |
| I0885 | 1342 | `button` | `type="button"`; `onClick={async () => { try { await onSimulateReply(thread.id); await loadConversation(thread.id); await loadList(inbox, page, true); } catch (failure) { fail(failure); } }}`; `disabled={busy &#124;&#124; Boolean(pending) &#124;&#124; !thread.canSend}` |
| I0886 | 1360 | `form` | `onSubmit={(event) => { event.preventDefault(); send(); }}` |
| I0887 | 1371 | `textarea` | `id={'message-${selected}'}`; `placeholder="Napiši poruku…"`; `onChange={(event) => { const value = event.target.value; if (selected) { const selectedInbox = conversation?.thread.inbox ?? inbox; draftCache.current.set('${selectedInbox}:${selected}', value); try { const revision = store?.saveDraft(selected, selectedInbox, value); draftRevisions.current.set( '${selectedInbox}:${selected}', revision ?? null, ); store?.saveSelection(selected, selectedInbox); unpersistedDrafts.current.delete('${selectedInbox}:${selected}'); setStorageWarning(""); } catch { unpersistedDrafts.current.add('${selectedInbox}:${selected}'); setStorageWarning( "Nacrt se trenutno čuva samo dok je aplikacija otvorena.", ); } } setDraft(value); }}`; `onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey &#124;&#124; event.metaKey)) { event.preventDefault(); send(); } }}`; `disabled={!thread?.canSend &#124;&#124; busy &#124;&#124; Boolean(pending)}`; `value={draft}` |
| I0888 | 1408 | `button` | `type="submit"`; `aria-label="Pošalji poruku"`; `disabled={!thread?.canSend &#124;&#124; !draft.trim() &#124;&#124; busy &#124;&#124; Boolean(pending)}` |

### src/components/people/PersonalProfileCard.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0889 | 158 | `button` | `type="button"`; `onClick={onEdit}` |
| I0890 | 164 | `button` | `type="button"`; `onClick={onBusinesses}` |
| I0891 | 170 | `button` | `type="button"`; `onClick={onConnections}` |
| I0892 | 180 | `button` | `type="button"`; `id={'${tabId}-${value}-tab'}`; `role="tab"`; `onClick={() => setTab(value)}`; `onKeyDown={(event) => tabKey(event, index)}` |

### src/components/people/PersonalProfileEditor.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0893 | 218 | `form` | `aria-label="Uredi lični profil"`; `onSubmit={save}` |
| I0894 | 266 | `input` | `type="file"`; `aria-label="Odaberi profilnu fotografiju"`; `accept="image/jpeg,image/png,image/webp"`; `onChange={(event) => void upload(event, "photo")}` |
| I0895 | 276 | `button` | `type="button"`; `onClick={() => void remove("photo")}` |
| I0896 | 321 | `input` | `type="file"`; `aria-label="Odaberi naslovnicu"`; `accept="image/jpeg,image/png,image/webp"`; `onChange={(event) => void upload(event, "cover")}` |
| I0897 | 331 | `button` | `type="button"`; `onClick={() => void remove("cover")}` |
| I0898 | 347 | `input` | `name="name"`; `id={'${prefix}-name'}`; `onChange={(event) => setFields({ ...fields, name: event.target.value })}`; `value={fields.name}` |
| I0899 | 362 | `input` | `type="date"`; `name="birthDate"`; `id={'${prefix}-birth'}`; `onChange={(event) => setFields({ ...fields, birthDate: event.target.value &#124;&#124; null })}`; `value={fields.birthDate ?? ""}` |
| I0900 | 374 | `select` | `name="workStatus"`; `id={'${prefix}-work'}`; `onChange={(event) => setFields({ ...fields, workStatus: event.target.value as WorkStatus }) }`; `value={fields.workStatus}` |
| I0901 | 394 | `input` | `name="city"`; `id={'${prefix}-city'}`; `onChange={(event) => setFields({ ...fields, city: event.target.value &#124;&#124; null })}`; `value={fields.city ?? ""}` |
| I0902 | 406 | `select` | `name="countryCode"`; `id={'${prefix}-country'}`; `onChange={(event) => setFields({ ...fields, countryCode: event.target.value &#124;&#124; null }) }`; `value={fields.countryCode ?? ""}` |
| I0903 | 430 | `textarea` | `name="bio"`; `id={'${prefix}-bio'}`; `onChange={(event) => setFields({ ...fields, bio: event.target.value &#124;&#124; null })}`; `value={fields.bio ?? ""}` |
| I0904 | 446 | `input` | `id={'${prefix}-skill'}`; `placeholder="Dodaj vještinu"`; `onChange={(event) => setSkillInput(event.target.value)}`; `onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); addSkill(); } }}`; `value={skillInput}` |
| I0905 | 460 | `button` | `type="button"`; `onClick={addSkill}`; `disabled={!skillInput.trim() &#124;&#124; fields.skills.length >= 15}` |
| I0906 | 474 | `button` | `type="button"`; `aria-label={'Ukloni vještinu ${skill}'}`; `onClick={() => setFields({ ...fields, skills: fields.skills.filter((item) => item !== skill), }) }` |
| I0907 | 493 | `button` | `type="submit"` |
| I0908 | 497 | `button` | `type="button"`; `onClick={onCancel}` |

### src/components/people/PersonalProfileWorkspace.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0909 | 362 | `button` | `type="button"`; `onClick={() => void load(true)}`; `disabled={busy &#124;&#124; loading}` |
| I0910 | 417 | `button` | `type="button"`; `aria-label="Javni profil"`; `onClick={() => void changeVisibility()}`; `disabled={busy &#124;&#124; (blocked && !pendingVisibility.current)}` |
| I0911 | 433 | `Link` | `href={publicHref?.(profile.id) ?? '/ljudi/${encodeURIComponent(profile.id)}'}` |

### src/components/preview/AccountPreview.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0912 | 57 | `Link` | `href="/pregled/pretraga"` |
| I0913 | 162 | `button` | `type="button"`; `onClick={() => setSection(item.id)}` |
| I0914 | 187 | `button` | `type="button"`; `onClick={() => setSection("profile")}` |
| I0915 | 206 | `button` | `type="button"`; `onClick={() => setSection("appointments")}` |
| I0916 | 240 | `button` | `type="button"`; `onClick={() => setSection(item.id)}` |

### src/components/preview/BusinessCard.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0917 | 34 | `button` | `type="button"`; `aria-label={'${saved ? "Ukloni" : "Sačuvaj"} ${business.name}'}`; `onClick={() => state.toggleSaved(business.id)}` |
| I0918 | 47 | `Link` | `href={'/pregled/djelatnost?profil=${business.id}'}` |

### src/components/preview/BusinessPreview.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0919 | 85 | `button` | `type="button"`; `onClick={() => setProfileId(null)}` |
| I0920 | 192 | `button` | `type="button"`; `onClick={() => setBookingId("forma")}` |
| I0921 | 195 | `button` | `type="button"`; `onClick={() => { setNote(""); setEditing("new"); }}` |
| I0922 | 207 | `input` | `type="checkbox"`; `onChange={(event) => setShowArchived(event.target.checked)}`; `checked={showArchived}` |
| I0923 | 260 | `button` | `type="button"`; `onClick={() => setMediaId(draft.id)}` |
| I0924 | 269 | `button` | `type="button"`; `onClick={() => setBookingId(draft.id)}` |
| I0925 | 278 | `button` | `type="button"`; `aria-label={'Prikaži ${draft.title}'}`; `onClick={() => setProfileId(draft.id)}` |
| I0926 | 288 | `button` | `type="button"`; `aria-label={'Uredi ${draft.title}'}`; `onClick={() => { setNote(""); setEditing({ ...draft, bookingEnabled: booking.getSettings(draft.id).enabled, }); }}` |
| I0927 | 303 | `button` | `type="button"`; `aria-label={'${draft.archived ? "Vrati" : "Arhiviraj"} ${draft.title}'}`; `onClick={() => archive(draft)}` |

### src/components/preview/MessagingPreview.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0928 | 48 | `Link` | `href={messageLink({ kind: "person", targetId: "preview-designer" }, true)}` |
| I0929 | 51 | `Link` | `href={messageLink({ kind: "business", targetId: "forma" }, true)}` |

### src/components/preview/PreviewHome.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0930 | 44 | `button` | `type="button"`; `onClick={() => setChoosingPlace(!choosingPlace)}` |
| I0931 | 61 | `button` | `type="button"`; `onClick={() => { setPlace(city); setChoosingPlace(false); }}` |
| I0932 | 95 | `Link` | `href="/o-nama"` |

### src/components/preview/PreviewPwa.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0933 | 21 | `button` | `type="button"`; `onClick={() => void pwa.install()}`; `disabled={pwa.installed &#124;&#124; pwa.accepted &#124;&#124; pwa.prompting}` |

### src/components/preview/PreviewShell.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0934 | 38 | `Link` | `href="/pregled"`; `aria-label="AhiBizz — početna"`; `onClick={() => setOpen(false)}` |
| I0935 | 49 | `Link` | `href={item.href}` |
| I0936 | 58 | `button` | `type="button"`; `aria-label={open ? "Zatvori meni" : "Otvori meni"}`; `onClick={() => setOpen(!open)}` |
| I0937 | 77 | `Link` | `href={item.href}`; `onClick={() => setOpen(false)}` |
| I0938 | 87 | `Link` | `href="/o-nama"`; `onClick={() => setOpen(false)}` |
| I0939 | 90 | `Link` | `href="/pregled/ljudi"`; `onClick={() => setOpen(false)}` |
| I0940 | 94 | `Link` | `href="/pregled/instaliraj"`; `onClick={() => setOpen(false)}` |
| I0941 | 101 | `Link` | `href={item.href}` |

### src/components/pwa/AppPermissions.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0942 | 106 | `button` | `type="button"`; `onClick={location.requestLocation}`; `disabled={location.status === "locating"}` |
| I0943 | 118 | `button` | `type="button"`; `onClick={onDismiss}` |

### src/components/pwa/DevicePush.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0944 | 248 | `button` | `type="button"`; `onClick={() => void change(enabled ? "disable" : "enable")}`; `disabled={busy}` |
| I0945 | 257 | `Link` | `href={'/prijava?nastavi=${encodeURIComponent(settings)}'}` |
| I0946 | 260 | `button` | `type="button"`; `onClick={() => setReload((n) => n + 1)}` |
| I0947 | 266 | `button` | `type="button"`; `onClick={() => void change("test")}`; `disabled={busy}` |

### src/components/pwa/InstallPage.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0948 | 52 | `button` | `type="button"`; `onClick={() => void pwa.install()}`; `disabled={pwa.prompting &#124;&#124; pwa.accepted}` |
| I0949 | 70 | `summary` | Native/roditeljska interakcija; vidi izvor |
| I0950 | 81 | `summary` | Native/roditeljska interakcija; vidi izvor |
| I0951 | 94 | `button` | `type="button"`; `onClick={() => void copyLink()}` |
| I0952 | 98 | `input` | `aria-label="Link za instalaciju"`; `value={manualLink}` |

### src/components/reels/ReelManager.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0953 | 261 | `form` | `onSubmit={(event) => { event.preventDefault(); void upload(event.currentTarget); }}` |
| I0954 | 283 | `Link` | `href={creditTopUpPath( selected ? '/nalog/reels?djelatnost=${selected}' : "/nalog/reels", )}` |
| I0955 | 295 | `select` | `name="business"` |
| I0956 | 305 | `input` | `name="title"` |
| I0957 | 309 | `textarea` | `name="caption"` |
| I0958 | 313 | `input` | `type="file"`; `name="video"`; `accept="video/mp4,.mp4"` |
| I0959 | 318 | `input` | `type="file"`; `name="poster"`; `accept="image/png,image/jpeg,image/webp"` |
| I0960 | 321 | `button` | `type="submit"`; `disabled={priceCredits === null &#124;&#124; balance === null &#124;&#124; insufficient}` |
| I0961 | 334 | `Link` | `href="/nalog?odjeljak=djelatnosti"` |
| I0962 | 390 | `button` | `type="button"`; `onClick={() => setPreview(reel.id)}` |
| I0963 | 401 | `video` | `aria-label={reel.title}`; `controls=true`; `src={reelMedia(reel.id, "video", true)}` |
| I0964 | 409 | `button` | `type="button"`; `onClick={() => setPreview("")}` |
| I0965 | 416 | `button` | `type="button"`; `onClick={() => void decide(reel, "approve")}`; `disabled={busy &#124;&#124; preview !== reel.id &#124;&#124; reel.priceCredits === null}` |
| I0966 | 424 | `form` | `onSubmit={(event) => { event.preventDefault(); void decide( reel, "reject", String(new FormData(event.currentTarget).get("reason") ?? ""), ); }}` |
| I0967 | 437 | `input` | `name="reason"`; `disabled={busy}` |
| I0968 | 439 | `button` | `type="submit"`; `disabled={busy}` |
| I0969 | 447 | `Link` | `href={'/reels/${reel.id}'}` |
| I0970 | 449 | `button` | `type="button"`; `onClick={() => { if (window.confirm("Povući ovaj reel? Snimak i naslovnica će se ukloniti.")) void decide(reel, "withdraw"); }}`; `disabled={busy}` |

### src/components/reels/ReelShelf.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0971 | 26 | `Link` | `href={reelCardPath( reel.id, businessScope, shelf ? (businessScope ? "profil" : "pocetna") : undefined, page, )}` |
| I0972 | 90 | `Link` | `href={listUrl}`; `aria-label="Pogledaj sve Reels objave"` |

### src/components/reels/ReelViewer.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0973 | 219 | `video` | `aria-label={reel.title}`; `src={reelMedia(reel.id, "video")}` |
| I0974 | 249 | `button` | `type="button"`; `aria-label={failed ? "Ponovo učitaj video" : playing ? "Pauziraj video" : "Pusti video"}`; `onClick={togglePlayback}` |
| I0975 | 265 | `Link` | `href={businessPath}` |
| I0976 | 279 | `button` | `type="button"`; `aria-label={muted ? "Uključi zvuk" : "Isključi zvuk"}`; `onClick={() => { const element = video.current; if (element) element.muted = !muted; onMute(!muted); }}` |
| I0977 | 291 | `Link` | `href={closePath}`; `aria-label="Zatvori Reels"` |
| I0978 | 304 | `button` | `type="button"`; `aria-label="Sviđa mi se"`; `onClick={() => void toggleLike()}`; `disabled={!engagement &#124;&#124; likePending}` |
| I0979 | 321 | `Link` | `href={messageLink({ kind: "business", targetId: reel.businessId })}` |
| I0980 | 329 | `button` | `type="button"`; `onClick={() => void share()}` |
| I0981 | 333 | `Link` | `href={reportUrl("reel", reel.id)}`; `aria-label="Prijavi Reel"` |
| I0982 | 370 | `Link` | `href={businessPath}` |
| I0983 | 384 | `input` | `value={manualShare}` |
| I0984 | 386 | `button` | `type="button"`; `onClick={() => setManualShare(null)}` |
| I0985 | 391 | `input` | `type="range"`; `aria-label="Pozicija u videu"`; `onChange={(event) => { const element = video.current; if (!element &#124;&#124; !Number.isFinite(element.duration)) return; element.currentTime = event.currentTarget.valueAsNumber; setPosition(element.currentTime); }}`; `disabled={!active &#124;&#124; failed}`; `value={Math.min(position, duration)}` |
| I0986 | 524 | `button` | `type="button"`; `onClick={() => void loadMore()}` |

### src/components/rentals/RentalCalendar.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0987 | 180 | `button` | `type="button"`; `aria-label="Prethodni mjesec"`; `onClick={() => browse(-1)}`; `disabled={busy &#124;&#124; (!actor && month <= today.slice(0, 7))}` |
| I0988 | 189 | `button` | `type="button"`; `aria-label="Sljedeći mjesec"`; `onClick={() => browse(1)}`; `disabled={busy}` |
| I0989 | 209 | `button` | `type="button"`; `aria-label={'${bookingDate('${day}T12:00:00Z', "UTC")}${taken ? ", ima zauzetih termina" : ""}'}`; `onClick={() => choose(day)}`; `disabled={busy &#124;&#124; (!actor && day < today)}` |
| I0990 | 229 | `button` | `type="button"`; `onClick={() => setRevision((v) => v + 1)}` |
| I0991 | 262 | `form` | `onSubmit={submit}` |
| I0992 | 266 | `input` | `type="datetime-local"`; `onChange={(e) => { setPickup(e.target.value); setError(""); setSuccess(""); if (e.target.value) { setMonth(e.target.value.slice(0, 7)); setSelected(e.target.value.slice(0, 10)); } }}`; `disabled={busy}`; `value={pickup}` |
| I0993 | 285 | `input` | `type="datetime-local"`; `onChange={(e) => { setDropoff(e.target.value); setError(""); setSuccess(""); }}`; `disabled={busy}`; `value={dropoff}` |
| I0994 | 308 | `button` | `type="button"`; `onClick={() => setRevision((v) => v + 1)}` |
| I0995 | 328 | `button` | `type="submit"`; `disabled={!valid &#124;&#124; !rangeReady &#124;&#124; occupied &#124;&#124; busy &#124;&#124; (!actor && total === null)}` |
| I0996 | 339 | `Link` | `href={'/prijava?nastavi=${encodeURIComponent('/djelatnosti/${car.businessId}#business-rentals')}'}` |
| I0997 | 350 | `Link` | `href={accountSectionPath("appointments")}` |

### src/components/rentals/RentalEntries.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I0998 | 69 | `Link` | `href={'/djelatnosti/${entry.businessId}'}` |
| I0999 | 80 | `button` | `type="button"`; `onClick={() => void decide("approve")}`; `disabled={working}` |
| I1000 | 89 | `button` | `type="button"`; `onClick={() => void decide("decline")}`; `disabled={working}` |
| I1001 | 100 | `button` | `type="button"`; `onClick={() => void decide("cancel")}`; `disabled={working}` |

### src/components/rentals/RentalFleet.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I1002 | 87 | `form` | `aria-label={car ? "Uredi automobil" : "Novi automobil"}`; `onSubmit={save}` |
| I1003 | 96 | `input` | `name="name"`; `placeholder="npr. Golf 8 Comfortline"` |
| I1004 | 106 | `select` | `name="brand"`; `aria-label="Marka"` |
| I1005 | 117 | `input` | `name="model"` |
| I1006 | 121 | `select` | `name="fuel"`; `aria-label="Gorivo"` |
| I1007 | 134 | `select` | `name="transmission"`; `aria-label="Mjenjač"` |
| I1008 | 152 | `input` | `type="number"`; `name="seats"` |
| I1009 | 156 | `input` | `type="number"`; `name="year"` |
| I1010 | 166 | `input` | `name="price"` |
| I1011 | 175 | `select` | `name="unit"`; `aria-label="Obračun"` |
| I1012 | 188 | `textarea` | `name="description"` |
| I1013 | 200 | `input` | `type="radio"`; `name="photo"`; `onChange={() => setPhoto(null)}`; `checked={photo === null}` |
| I1014 | 210 | `input` | `type="radio"`; `name="photo"`; `aria-label={'Fotografija ${asset.slot}'}`; `onChange={() => setPhoto(asset.slot)}`; `checked={photo === asset.slot}` |
| I1015 | 235 | `input` | `type="checkbox"`; `name="enabled"` |
| I1016 | 239 | `button` | `type="submit"` |
| I1017 | 242 | `button` | `type="button"`; `onClick={cancel}` |
| I1018 | 334 | `button` | `type="button"`; `onClick={refresh}` |
| I1019 | 358 | `button` | `type="button"`; `onClick={() => setEditor(null)}` |
| I1020 | 363 | `button` | `type="button"`; `onClick={onPhotos}` |
| I1021 | 421 | `button` | `type="button"`; `onClick={() => { setSelected(open ? null : car.id); setError(""); setArchiveId(null); }}` |
| I1022 | 437 | `button` | `type="button"`; `onClick={() => { setEditor(car); setArchiveId(null); }}` |
| I1023 | 449 | `button` | `type="button"`; `onClick={() => { setArchiveId(car.id); setError(""); }}` |
| I1024 | 461 | `button` | `type="button"`; `onClick={() => void archive(car)}`; `disabled={working}` |
| I1025 | 469 | `button` | `type="button"`; `onClick={() => setArchiveId(null)}`; `disabled={working}` |

### src/components/rentals/RentalRecovery.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I1026 | 88 | `button` | `type="button"`; `onClick={() => void recover()}`; `disabled={busy}` |
| I1027 | 97 | `Link` | `href={accountSectionPath("appointments")}` |

### src/components/reviews/BusinessReviews.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I1028 | 373 | `button` | `type="button"`; `aria-label="Osvježi recenzije"`; `onClick={() => void refresh()}`; `disabled={busy}` |
| I1029 | 413 | `Link` | `href={'/ljudi/${encodeURIComponent(review.author.id)}'}` |
| I1030 | 433 | `Link` | `href={reportUrl("review", review.id)}` |
| I1031 | 438 | `button` | `type="button"`; `onClick={() => void more()}`; `disabled={busy}` |
| I1032 | 448 | `Link` | `href={authReturnLinks('/djelatnosti/${businessId}#recenzije').login}` |
| I1033 | 460 | `form` | `onSubmit={(event) => { event.preventDefault(); void submit(pending?.action ?? "save"); }}` |
| I1034 | 477 | `input` | `type="radio"`; `name={'${labelId}-rating'}`; `onChange={() => setRating(value)}`; `checked={rating === value}`; `value={value}` |
| I1035 | 492 | `textarea` | `onChange={(event) => setText(event.target.value)}`; `disabled={busy &#124;&#124; pending !== null}`; `value={text}` |
| I1036 | 501 | `button` | `type="submit"`; `disabled={busy &#124;&#124; !text.trim()}` |
| I1037 | 511 | `button` | `type="button"`; `onClick={() => void submit("withdraw")}`; `disabled={busy &#124;&#124; (pending !== null && pending.action !== "withdraw")}` |

### src/components/reviews/ReviewsAdmin.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I1038 | 270 | `button` | `type="button"`; `onClick={() => void load(visible?.page ?? 1)}`; `disabled={busy}` |
| I1039 | 289 | `Link` | `href={'/djelatnosti/${item.businessId}'}` |
| I1040 | 298 | `button` | `type="button"`; `onClick={() => { setSelected(item); setReason(""); }}`; `disabled={busy &#124;&#124; pending !== null}` |
| I1041 | 310 | `form` | `onSubmit={(e) => { e.preventDefault(); void moderate(); }}` |
| I1042 | 319 | `textarea` | `onChange={(e) => setReason(e.target.value)}`; `disabled={busy &#124;&#124; pending !== null}`; `value={reason}` |
| I1043 | 328 | `button` | `type="submit"`; `disabled={busy &#124;&#124; !reason.trim()}` |
| I1044 | 331 | `button` | `type="button"`; `onClick={() => setSelected(null)}`; `disabled={busy &#124;&#124; pending !== null}` |
| I1045 | 347 | `button` | `type="button"`; `onClick={() => void load(visible.page - 1)}`; `disabled={busy}` |
| I1046 | 357 | `button` | `type="button"`; `onClick={() => void load(visible.page + 1)}`; `disabled={busy}` |

### src/components/stays/StayCalendar.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I1047 | 204 | `button` | `type="button"`; `aria-label="Prethodni mjesec"`; `onClick={() => browse(previous)}`; `disabled={frozen &#124;&#124; !previous &#124;&#124; (!actor && month <= today.slice(0, 7))}` |
| I1048 | 213 | `button` | `type="button"`; `aria-label="Sljedeći mjesec"`; `onClick={() => browse(next)}`; `disabled={frozen &#124;&#124; !next}` |
| I1049 | 233 | `button` | `type="button"`; `aria-label={ bookingDate('${value}T12:00:00Z', "UTC") + (taken ? ", zauzeta noć" : "") }`; `onClick={() => selectDay(value)}`; `disabled={frozen &#124;&#124; (!actor && value < today)}` |
| I1050 | 260 | `button` | `type="button"`; `onClick={retryRead}` |
| I1051 | 303 | `button` | `type="button"`; `onClick={(e) => void submit(e, true)}`; `disabled={working}` |
| I1052 | 311 | `Link` | `href={accountSectionPath("appointments")}` |
| I1053 | 320 | `form` | `onSubmit={submit}` |
| I1054 | 324 | `input` | `type="date"`; `onChange={(e) => { const date = e.target.value; if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) &#124;&#124; date > lastArrivalDate)) return; setArrival(date); if (date >= today) { setDay(date); setMonth(date.slice(0, 7)); } if (!date &#124;&#124; date >= departure) setDeparture(""); setChoosingEnd(true); clearMessage(); }}`; `disabled={frozen}`; `value={arrival}` |
| I1055 | 347 | `input` | `type="date"`; `onChange={(e) => { if (e.target.value && !/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) return; setDeparture(e.target.value); setChoosingEnd(false); clearMessage(); }}`; `disabled={frozen}`; `value={departure}` |
| I1056 | 368 | `button` | `type="button"`; `onClick={retryRead}` |
| I1057 | 386 | `button` | `type="submit"`; `disabled={frozen &#124;&#124; !valid &#124;&#124; !ready &#124;&#124; occupied}` |
| I1058 | 397 | `Link` | `href={'/prijava?nastavi=${encodeURIComponent('/djelatnosti/${unit.businessId}#business-stays')}'}` |
| I1059 | 408 | `Link` | `href={accountSectionPath("appointments")}` |

### src/components/stays/StayEntries.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I1060 | 71 | `Link` | `href={'/djelatnosti/${entry.businessId}'}` |
| I1061 | 80 | `button` | `type="button"`; `onClick={() => void decide("approve")}`; `disabled={working}` |
| I1062 | 90 | `button` | `type="button"`; `onClick={() => void decide("decline")}`; `disabled={working}` |
| I1063 | 100 | `button` | `type="button"`; `onClick={() => void decide("cancel")}`; `disabled={working}` |

### src/components/stays/StayUnits.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I1064 | 86 | `form` | `aria-label={unit ? "Uredi jedinicu" : "Nova jedinica"}`; `onSubmit={save}` |
| I1065 | 95 | `input` | `name="name"`; `placeholder="npr. Apartman s balkonom"` |
| I1066 | 105 | `select` | `name="type"` |
| I1067 | 112 | `input` | `type="number"`; `name="beds"` |
| I1068 | 123 | `input` | `name="price"` |
| I1069 | 132 | `textarea` | `name="description"` |
| I1070 | 144 | `input` | `type="checkbox"`; `aria-label={'Fotografija ${p.slot}'}`; `onChange={(e) => setSlots( e.currentTarget.checked ? [...slots, p.slot] : slots.filter((slot) => slot !== p.slot), ) }`; `checked={slots.includes(p.slot)}` |
| I1071 | 165 | `button` | `type="button"`; `onClick={onPhotos}` |
| I1072 | 170 | `input` | `type="checkbox"`; `name="enabled"` |
| I1073 | 174 | `button` | `type="submit"` |
| I1074 | 177 | `button` | `type="button"`; `onClick={cancel}` |
| I1075 | 219 | `button` | `type="button"`; `aria-label={'Prikaži fotografiju ${index + 1}'}`; `onClick={() => setSelected(photo.slot)}` |
| I1076 | 293 | `button` | `type="button"`; `onClick={refresh}` |
| I1077 | 316 | `button` | `type="button"`; `onClick={() => { setEditor(null); setError(""); }}` |
| I1078 | 369 | `button` | `type="button"`; `onClick={() => { setSelected(open ? null : unit.id); setArchiving(null); setError(""); }}` |
| I1079 | 386 | `button` | `type="button"`; `onClick={() => { setEditor(unit); setGallery(false); setArchiving(null); }}` |
| I1080 | 399 | `button` | `type="button"`; `onClick={() => { setArchiving(unit.id); setError(""); }}` |
| I1081 | 411 | `button` | `type="button"`; `onClick={() => void archive(unit)}`; `disabled={busy}` |
| I1082 | 419 | `button` | `type="button"`; `onClick={() => setArchiving(null)}`; `disabled={busy}` |

### src/components/support/CommunityRulesPrompt.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I1083 | 70 | `button` | `type="button"`; `onClick={state === "stale" ? () => window.location.reload() : read}` |
| I1084 | 83 | `summary` | Native/roditeljska interakcija; vidi izvor |
| I1085 | 87 | `Link` | `href="/pravila-zajednice"` |
| I1086 | 89 | `button` | `type="button"`; `onClick={accept}`; `disabled={busy}` |

### src/components/support/CopyPaymentDetails.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I1087 | 37 | `button` | `type="button"`; `onClick={() => void copy()}`; `disabled={status === "copying"}` |
| I1088 | 56 | `textarea` | `id={fallbackId}`; `value={text}` |

### src/components/support/RequestForm.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I1089 | 20 | `form` | `action={action}` |
| I1090 | 21 | `input` | `type="hidden"`; `name="actor"`; `value={actor}` |
| I1091 | 22 | `input` | `type="hidden"`; `name="subject"`; `value={target.subject}` |
| I1092 | 23 | `input` | `type="hidden"`; `name="reference"`; `value={target.reference}` |
| I1093 | 26 | `input` | `type="checkbox"`; `name="confirm"`; `value="yes"` |
| I1094 | 32 | `textarea` | `name="details"` |
| I1095 | 36 | `button` | `type="submit"`; `disabled={pending}` |

### src/components/support/RequestScreen.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I1096 | 37 | `Link` | `href={reelPath(target.reference)}` |
| I1097 | 39 | `Link` | `href="/privatnost"` |
| I1098 | 59 | `Link` | `href={'/prijava?nastavi=${encodeURIComponent(reportUrl("reel", target.reference))}'}` |
| I1099 | 77 | `a` | `href={email}` |

### src/components/support/SupportPage.tsx

| ID | Linija | Element | Odredište, vrijednost, handler i stanje |
|---|---|---|---|
| I1100 | 75 | `input` | `type="radio"`; `name="donation-method"`; `onChange={() => { setMethod(option.id); setChoice("10"); setCustomAmount(""); }}`; `checked={method === option.id}`; `value={option.id}` |
| I1101 | 98 | `input` | `type="radio"`; `name="donation-amount"`; `onChange={() => setChoice(option)}`; `checked={choice === option}`; `value={option}` |
| I1102 | 114 | `input` | `type="text"`; `onChange={(event) => setCustomAmount(event.target.value)}`; `value={customAmount}` |
| I1103 | 138 | `a` | `href={payment.href}`; `aria-label={'Doniraj ${amountText} putem PayPala (otvara se u novoj kartici)'}` |
| I1104 | 150 | `button` | `type="button"`; `disabled=true` |

## Env varijable — samo imena

Nisu čitani .env fajlovi niti produkcijske vrijednosti. Obaveznost označava modul: bez auth konfiguracije javne stranice još mogu raditi. Nije dopušteno zaključiti da je zastavica u produkciji uključena/isključena na osnovu defaulta.

| Ime | Namjena | Obavezno | Izvor |
|---|---|---|---|
| `AHIBIZZ_CREDIT_BANK_TRANSFER` | JSON potvrđenog bankovnog primaoca i podataka za dopune | Uslovno; prazno sakriva bankovne dopune | `src/server/wallet/bank-config.ts` |
| `AHIBIZZ_CREDIT_TOP_UP_BANK_ONLY` | Granica novčanika i dozvoljenih dopuna | Ne; upravlja komercijalnim tokom, ne mijenjati bez odluke | `src/server/paypal/credit-top-up-policy.ts` |
| `AHIBIZZ_DISTRIBUTION` | Izbor web/google-play prilikom builda | Ne; default web | `next.config.ts` |
| `AHIBIZZ_INGRESS_BOUNDARY_PROOF` | Privatni ingress proxy, dokaz granice/trust i observacija | Uslovno; enforce/trust default off | `scripts/ingress-policy.mjs` |
| `AHIBIZZ_INGRESS_BOUNDARY_SHA256` | Privatni ingress proxy, dokaz granice/trust i observacija | Uslovno; enforce/trust default off | `scripts/ingress-policy.mjs` |
| `AHIBIZZ_INGRESS_ENFORCE` | Privatni ingress proxy, dokaz granice/trust i observacija | Uslovno; enforce/trust default off | `scripts/ingress-policy.mjs`, `scripts/start.mjs` |
| `AHIBIZZ_INGRESS_OBSERVE` | Privatni ingress proxy, dokaz granice/trust i observacija | Uslovno; enforce/trust default off | `scripts/ingress-observe.mjs`, `scripts/start.mjs` |
| `AHIBIZZ_INGRESS_PROXY_PEERS` | Privatni ingress proxy, dokaz granice/trust i observacija | Uslovno; enforce/trust default off | `scripts/ingress-policy.mjs` |
| `AHIBIZZ_INGRESS_PUBLIC_PORT` | Privatni ingress proxy, dokaz granice/trust i observacija | Uslovno; enforce/trust default off | `src/server/auth/ingress.ts` |
| `AHIBIZZ_INGRESS_TRUST_ATTESTATION` | Privatni ingress proxy, dokaz granice/trust i observacija | Uslovno; enforce/trust default off | `scripts/ingress-policy.mjs` |
| `AHIBIZZ_INGRESS_TRUST_ATTESTATION_SHA256` | Privatni ingress proxy, dokaz granice/trust i observacija | Uslovno; enforce/trust default off | `scripts/ingress-policy.mjs` |
| `AHIBIZZ_INGRESS_TRUST_CLIENT_IP` | Privatni ingress proxy, dokaz granice/trust i observacija | Uslovno; enforce/trust default off | `scripts/ingress-policy.mjs`, `scripts/start.mjs`, `src/server/auth/ingress.ts` |
| `AHIBIZZ_INGRESS_WRAPPED` | Privatni ingress proxy, dokaz granice/trust i observacija | Uslovno; enforce/trust default off | `src/server/auth/ingress.ts` |
| `AHIBIZZ_INITIAL_OWNER_EMAIL` | Ciljani email za operatorovu inicijalizaciju vlasnika | Da samo za owner komandu | `scripts/initial-owner.mjs` |
| `AHIBIZZ_LIVE_SUBSCRIPTIONS_ENABLED` | Omogućavanje ugovora/paketa za odgovarajuće okruženje | Ne; default off | `src/server/paypal-subscriptions/config.ts` |
| `AHIBIZZ_NEXT_INTERNAL_PORT` | Privatni ingress proxy, dokaz granice/trust i observacija | Uslovno; enforce/trust default off | `scripts/ingress-policy.mjs`, `src/server/auth/ingress.ts` |
| `AHIBIZZ_PLATFORM_CREDITS_ONLY` | Granica novčanika i dozvoljenih dopuna | Ne; upravlja komercijalnim tokom, ne mijenjati bez odluke | `src/server/wallet/platform-policy.ts` |
| `AHIBIZZ_PLAY_SIGNING_SHA256` | SHA-256 Play App Signing certifikata za assetlinks | Da za verificirani TWA; bez njega nema asocijacije | `src/app/.well-known/assetlinks.json/route.ts` |
| `AHIBIZZ_SANDBOX_SUBSCRIPTIONS_ENABLED` | Omogućavanje ugovora/paketa za odgovarajuće okruženje | Ne; default off | `src/server/paypal-subscriptions/config.ts` |
| `AHIBIZZ_TEST_DATABASE_URL` | Izolovani testovi/fixture, nikad produkcijska baza | Samo za odgovarajuću provjeru | `tests/integration/*`, `.github/workflows/ci.yml` |
| `AHI_IMPORT_FIXTURE_PORT` | Izolovani testovi/fixture, nikad produkcijska baza | Samo za odgovarajuću provjeru | `scripts/verify-business-import-ui.mjs` |
| `APP_URL` | Ostatak primjerka konfiguracije; bez čitaoca | Ne | `.env.example (nema čitaoca u kodu)` |
| `BETTER_AUTH_SECRET` | Potpis autentifikacije | Da za auth | `src/server/auth/config.ts` |
| `BETTER_AUTH_URL` | Kanonikalni origin autentifikacije i povratnih ruta | Da za auth | `scripts/ingress-policy.mjs`, `src/app/(public)/administracija/emailovi/page.tsx`, `src/server/auth/config.ts`, `src/server/paypal-subscriptions/config.ts`, `src/server/paypal-subscriptions/http.ts`, `src/server/paypal-subscriptions/setup.ts` |
| `CI` | Izolovani testovi/fixture, nikad produkcijska baza | Samo za odgovarajuću provjeru | `tests/integration/*`, `.github/workflows/ci.yml` |
| `DATABASE_SSL_MODE` | TLS politika konekcije | Ne; lokalno disable, udaljeno require | `src/server/env.ts` |
| `DATABASE_URL` | PostgreSQL aplikacije | Da za rad sa podacima | `scripts/start.mjs`, `src/server/env.ts` |
| `DIRECTORY_MEMBER_BUSINESS_LIMIT` | Limit djelatnosti po članu | Ne; default u directory servisu | `src/server/business-ownership/service.ts`, `src/server/directory/service.ts` |
| `DODO_ENVIRONMENT` | Nedostupni testni adapter, kandidat za uklanjanje | Ne; nema javne rute | `src/server/dodo/test-adapter.ts` |
| `DODO_TEST_ADAPTER_ENABLED` | Nedostupni testni adapter, kandidat za uklanjanje | Ne; nema javne rute | `src/server/dodo/test-adapter.ts` |
| `DODO_TEST_API_KEY` | Nedostupni testni adapter, kandidat za uklanjanje | Ne; nema javne rute | `src/server/dodo/test-adapter.ts` |
| `DODO_TEST_BUSINESS_ID` | Nedostupni testni adapter, kandidat za uklanjanje | Ne; nema javne rute | `src/server/dodo/test-adapter.ts` |
| `DODO_TEST_HTTP_ENABLED` | Nedostupni testni adapter, kandidat za uklanjanje | Ne; nema javne rute | `src/server/dodo/runtime.ts` |
| `DODO_TEST_PRODUCT_ID` | Nedostupni testni adapter, kandidat za uklanjanje | Ne; nema javne rute | `src/server/dodo/test-adapter.ts` |
| `DODO_TEST_RETURN_ORIGIN` | Nedostupni testni adapter, kandidat za uklanjanje | Ne; nema javne rute | `src/server/dodo/test-adapter.ts` |
| `DODO_TEST_WEBHOOK_SECRET` | Nedostupni testni adapter, kandidat za uklanjanje | Ne; nema javne rute | `src/server/dodo/test-adapter.ts` |
| `HOSTNAME` | Runtime vrijednost Node/Next/start skripte | Postavlja runtime | `src/server/auth/ingress.ts` |
| `NEXT_PHASE` | Runtime vrijednost Node/Next/start skripte | Postavlja runtime | `src/instrumentation.ts`, `src/server/push/worker.ts` |
| `NEXT_PUBLIC_AHIBIZZ_DISTRIBUTION` | Javna build-time kopija prethodne vrijednosti | Postavlja next.config.ts | `src/lib/distribution.ts` |
| `NEXT_RUNTIME` | Runtime vrijednost Node/Next/start skripte | Postavlja runtime | `src/instrumentation.ts` |
| `NODE_ENV` | Runtime vrijednost Node/Next/start skripte | Postavlja runtime | `src/app/(public)/administracija/emailovi/page.tsx`, `src/server/auth/config.ts`, `src/server/auth/ingress.ts`, `src/server/auth/service.ts` |
| `PAYPAL_CHECKOUT_ENABLED` | Konfiguracija PayPal naplate/paketa; prefiks određuje live ili sandbox | Uslovno za odgovarajući omogućeni tok | `src/server/paypal/runtime.ts` |
| `PAYPAL_CHECKOUT_ENVIRONMENT` | Konfiguracija PayPal naplate/paketa; prefiks određuje live ili sandbox | Uslovno za odgovarajući omogućeni tok | `src/server/paypal-subscriptions/setup.ts`, `src/server/paypal/runtime.ts` |
| `PAYPAL_CHECKOUT_EUR_PRICE_APPROVED` | Konfiguracija PayPal naplate/paketa; prefiks određuje live ili sandbox | Uslovno za odgovarajući omogućeni tok | `src/server/paypal/runtime.ts` |
| `PAYPAL_CHECKOUT_FULFILLMENT_READY` | Konfiguracija PayPal naplate/paketa; prefiks određuje live ili sandbox | Uslovno za odgovarajući omogućeni tok | `src/server/directory/read-service.ts`, `src/server/paypal/runtime.ts` |
| `PAYPAL_CHECKOUT_PUBLIC_ORIGIN` | Konfiguracija PayPal naplate/paketa; prefiks određuje live ili sandbox | Uslovno za odgovarajući omogućeni tok | `src/server/paypal-subscriptions/setup.ts`, `src/server/paypal/runtime.ts` |
| `PAYPAL_CHECKOUT_REFUNDS_ENABLED` | Konfiguracija PayPal naplate/paketa; prefiks određuje live ili sandbox | Uslovno za odgovarajući omogućeni tok | `src/server/paypal/runtime.ts` |
| `PAYPAL_CREDIT_CARD_TOPUPS_ENABLED` | Konfiguracija PayPal naplate/paketa; prefiks određuje live ili sandbox | Uslovno za odgovarajući omogućeni tok | `src/server/paypal/runtime.ts` |
| `PAYPAL_CREDIT_CARD_TOPUPS_PILOT_OWNER` | Konfiguracija PayPal naplate/paketa; prefiks određuje live ili sandbox | Uslovno za odgovarajući omogućeni tok | `src/server/paypal/runtime.ts` |
| `PAYPAL_LIVE_CLIENT_ID` | Konfiguracija PayPal naplate/paketa; prefiks određuje live ili sandbox | Uslovno za odgovarajući omogućeni tok | `src/server/paypal/runtime.ts`, `src/server/paypal-subscriptions/config.ts` |
| `PAYPAL_LIVE_CLIENT_SECRET` | Konfiguracija PayPal naplate/paketa; prefiks određuje live ili sandbox | Uslovno za odgovarajući omogućeni tok | `src/server/paypal/runtime.ts`, `src/server/paypal-subscriptions/config.ts` |
| `PAYPAL_LIVE_MERCHANT_ID` | Konfiguracija PayPal naplate/paketa; prefiks određuje live ili sandbox | Uslovno za odgovarajući omogućeni tok | `src/server/paypal/runtime.ts`, `src/server/paypal-subscriptions/config.ts` |
| `PAYPAL_LIVE_PLAN_BASIC_ANNUAL` | Konfiguracija PayPal naplate/paketa; prefiks određuje live ili sandbox | Uslovno za odgovarajući omogućeni tok | `src/server/paypal-subscriptions/config.ts` |
| `PAYPAL_LIVE_PLAN_BASIC_MONTHLY` | Konfiguracija PayPal naplate/paketa; prefiks određuje live ili sandbox | Uslovno za odgovarajući omogućeni tok | `src/server/paypal-subscriptions/config.ts` |
| `PAYPAL_LIVE_PLAN_BUSINESS_ANNUAL` | Konfiguracija PayPal naplate/paketa; prefiks određuje live ili sandbox | Uslovno za odgovarajući omogućeni tok | `src/server/paypal-subscriptions/config.ts` |
| `PAYPAL_LIVE_PLAN_BUSINESS_MONTHLY` | Konfiguracija PayPal naplate/paketa; prefiks određuje live ili sandbox | Uslovno za odgovarajući omogućeni tok | `src/server/paypal-subscriptions/config.ts` |
| `PAYPAL_LIVE_PLAN_PREMIUM_ANNUAL` | Konfiguracija PayPal naplate/paketa; prefiks određuje live ili sandbox | Uslovno za odgovarajući omogućeni tok | `src/server/paypal-subscriptions/config.ts` |
| `PAYPAL_LIVE_PLAN_PREMIUM_MONTHLY` | Konfiguracija PayPal naplate/paketa; prefiks određuje live ili sandbox | Uslovno za odgovarajući omogućeni tok | `src/server/paypal-subscriptions/config.ts` |
| `PAYPAL_LIVE_SUBSCRIPTION_WEBHOOK_ID` | Konfiguracija PayPal naplate/paketa; prefiks određuje live ili sandbox | Uslovno za odgovarajući omogućeni tok | `src/server/paypal/runtime.ts`, `src/server/paypal-subscriptions/config.ts` |
| `PAYPAL_LIVE_WEBHOOK_ID` | Konfiguracija PayPal naplate/paketa; prefiks određuje live ili sandbox | Uslovno za odgovarajući omogućeni tok | `src/server/paypal/runtime.ts`, `src/server/paypal-subscriptions/config.ts` |
| `PAYPAL_SANDBOX_CLIENT_ID` | Konfiguracija PayPal naplate/paketa; prefiks određuje live ili sandbox | Uslovno za odgovarajući omogućeni tok | `src/server/paypal/runtime.ts`, `src/server/paypal-subscriptions/config.ts` |
| `PAYPAL_SANDBOX_CLIENT_SECRET` | Konfiguracija PayPal naplate/paketa; prefiks određuje live ili sandbox | Uslovno za odgovarajući omogućeni tok | `src/server/paypal/runtime.ts`, `src/server/paypal-subscriptions/config.ts` |
| `PAYPAL_SANDBOX_MERCHANT_ID` | Konfiguracija PayPal naplate/paketa; prefiks određuje live ili sandbox | Uslovno za odgovarajući omogućeni tok | `src/server/paypal/runtime.ts`, `src/server/paypal-subscriptions/config.ts` |
| `PAYPAL_SANDBOX_PLAN_BASIC_ANNUAL` | Konfiguracija PayPal naplate/paketa; prefiks određuje live ili sandbox | Uslovno za odgovarajući omogućeni tok | `src/server/paypal-subscriptions/config.ts` |
| `PAYPAL_SANDBOX_PLAN_BASIC_MONTHLY` | Konfiguracija PayPal naplate/paketa; prefiks određuje live ili sandbox | Uslovno za odgovarajući omogućeni tok | `src/server/paypal-subscriptions/config.ts` |
| `PAYPAL_SANDBOX_PLAN_BUSINESS_ANNUAL` | Konfiguracija PayPal naplate/paketa; prefiks određuje live ili sandbox | Uslovno za odgovarajući omogućeni tok | `src/server/paypal-subscriptions/config.ts` |
| `PAYPAL_SANDBOX_PLAN_BUSINESS_MONTHLY` | Konfiguracija PayPal naplate/paketa; prefiks određuje live ili sandbox | Uslovno za odgovarajući omogućeni tok | `src/server/paypal-subscriptions/config.ts` |
| `PAYPAL_SANDBOX_PLAN_PREMIUM_ANNUAL` | Konfiguracija PayPal naplate/paketa; prefiks određuje live ili sandbox | Uslovno za odgovarajući omogućeni tok | `src/server/paypal-subscriptions/config.ts` |
| `PAYPAL_SANDBOX_PLAN_PREMIUM_MONTHLY` | Konfiguracija PayPal naplate/paketa; prefiks određuje live ili sandbox | Uslovno za odgovarajući omogućeni tok | `src/server/paypal-subscriptions/config.ts` |
| `PAYPAL_SANDBOX_SUBSCRIPTION_WEBHOOK_ID` | Konfiguracija PayPal naplate/paketa; prefiks određuje live ili sandbox | Uslovno za odgovarajući omogućeni tok | `src/server/paypal/runtime.ts`, `src/server/paypal-subscriptions/config.ts` |
| `PAYPAL_SANDBOX_WEBHOOK_ID` | Konfiguracija PayPal naplate/paketa; prefiks određuje live ili sandbox | Uslovno za odgovarajući omogućeni tok | `src/server/paypal/runtime.ts`, `src/server/paypal-subscriptions/config.ts` |
| `PORT` | Javni port production entrypointa | Da za start | `scripts/ingress-policy.mjs`, `scripts/start.mjs`, `src/server/auth/ingress.ts` |
| `SMTP_FROM` | Email transport autentifikacije i obavijesti | Da za auth osim SMTP_SECURE (izveden iz porta) | `src/server/auth/config.ts` |
| `SMTP_HOST` | Email transport autentifikacije i obavijesti | Da za auth osim SMTP_SECURE (izveden iz porta) | `src/server/auth/config.ts` |
| `SMTP_PASSWORD` | Email transport autentifikacije i obavijesti | Da za auth osim SMTP_SECURE (izveden iz porta) | `src/server/auth/config.ts` |
| `SMTP_PORT` | Email transport autentifikacije i obavijesti | Da za auth osim SMTP_SECURE (izveden iz porta) | `src/server/auth/config.ts` |
| `SMTP_SECURE` | Email transport autentifikacije i obavijesti | Da za auth osim SMTP_SECURE (izveden iz porta) | `src/server/auth/config.ts` |
| `SMTP_USER` | Email transport autentifikacije i obavijesti | Da za auth osim SMTP_SECURE (izveden iz porta) | `src/server/auth/config.ts` |

Push potpisni par generiše se i sprema u tabelu `push_signer` (`src/server/push/service.ts`), nije VAPID env konfiguracija. Uploadi se normalizuju na serveru i podaci medija se čuvaju u PostgreSQL-u; ne pretpostavljati R2/S3 varijable koje kod ne čita.

## Skripte

| Fajl | Namjena | Poziv / zavisnost |
|---|---|---|
| `scripts/check-runtime-security.mjs` | Provjera izvještaja runtime image ranjivosti i identiteta | `.github/workflows/ci.yml`, `tests/runtime-security.test.ts` |
| `scripts/copy-standalone-assets.mjs` | Kopira public i static assete u standalone build | `package.json` |
| `scripts/ingress-evidence.mjs` | Validacija i hash dokazne granice proxyja | `Dockerfile`, `scripts/ingress-policy.mjs`, `tests/ingress-start.test.ts` |
| `scripts/ingress-forwarder.mjs` | Privatni reverse proxy i zaglavlja | `Dockerfile`, `scripts/ingress-start.mjs`, `tests/ingress-forwarder.test.ts`, `tests/ingress-start.test.ts`, `tests/integration/auth.test.mjs` |
| `scripts/ingress-observe.mjs` | Ograničena observacija ingress zahtjeva | `Dockerfile`, `scripts/start.mjs`, `tests/ingress-observe-start.test.ts`, `tests/ingress-observe.test.ts`, `tests/ingress-start.test.ts` |
| `scripts/ingress-policy.d.mts` | Tipovi ingress politike | Nema poziva u package/CI/testovima; ručna skripta |
| `scripts/ingress-policy.mjs` | Provjera politike i trusted peer dokaza | `Dockerfile`, `scripts/ingress-forwarder.mjs`, `scripts/ingress-start.mjs`, `scripts/start.mjs`, `tests/ingress-forwarder.test.ts`, `tests/ingress-policy.test.ts`, `tests/ingress-start.test.ts`, `tests/integration/auth.test.mjs` |
| `scripts/ingress-start.mjs` | Pokretanje Next-a iza zaštićenog ingress proxyja | `Dockerfile`, `scripts/start.mjs`, `tests/ingress-start.test.ts` |
| `scripts/initial-owner.mjs` | Provjera/aktivacija početnog owner naloga (operatorska izmjena) | `Dockerfile`, `package.json`, `tests/initial-owner-command.test.ts`, `tests/integration/initial-owner.test.mjs` |
| `scripts/migrate.mjs` | Provjera i primjena hronoloških migracija | `Dockerfile`, `package.json`, `scripts/start.mjs`, `tests/ingress-observe-start.test.ts`, `tests/ingress-start.test.ts`, `tests/integration/account-erasure.test.mjs`, `tests/integration/auth.test.mjs`, `tests/integration/bank-credit-topup.test.mjs`, `tests/integration/billing.test.mjs`, `tests/integration/booking.test.mjs`, `tests/integration/business-details.test.mjs`, `tests/integration/business-favorites.test.mjs`, `tests/integration/business-media.test.mjs`, `tests/integration/business-ownership.test.mjs`, `tests/integration/business-reviews.test.mjs`, `tests/integration/connections.test.mjs`, `tests/integration/directory.test.mjs`, `tests/integration/dodo-checkout.test.mjs`, `tests/integration/initial-owner.test.mjs`, `tests/integration/messaging.test.mjs`, `tests/integration/paypal-checkout.test.mjs`, `tests/integration/paypal-subscriptions.test.mjs`, `tests/integration/people.test.mjs`, `tests/integration/postgres.test.mjs`, `tests/integration/reels.test.mjs`, `tests/server-migrate.test.ts`, `tests/server-start.test.ts` |
| `scripts/start.mjs` | Production startup i uslovne migracije | `Dockerfile`, `package.json`, `tests/ingress-observe-start.test.ts`, `tests/ingress-observe.test.ts`, `tests/ingress-start.test.ts`, `tests/runtime-security.test.ts`, `tests/server-start.test.ts` |
| `scripts/verify-business-details-ui.mjs` | Stara browser fixture provjera detalja djelatnosti | Nema poziva u package/CI/testovima; ručna skripta |
| `scripts/verify-business-import-ui.mjs` | Stara browser fixture provjera uvoza | Nema poziva u package/CI/testovima; ručna skripta |
| `scripts/verify-business-ownership-ui.mjs` | Stara browser fixture provjera vlasništva | Nema poziva u package/CI/testovima; ručna skripta |
| `scripts/verify-favorites-ui.mjs` | Stara browser fixture provjera favorita | Nema poziva u package/CI/testovima; ručna skripta |

## Migracije po temama

Svih 53 postojeće migracije ostaju neizmijenjene. Primijenjeni checksum i redoslijed su dio ugovora migratora. Naziv test/sandbox tabele ne opravdava brisanje migracije ni historijskih zapisa.

| Tema | Migracije |
|---|---|
| Platforma, auth, privatnost i nalozi | `db/migrations/0001_platform.sql`, `db/migrations/0002_auth.sql`, `db/migrations/0003_account_management.sql`, `db/migrations/0019_account_approval_email.sql`, `db/migrations/0026_community_rules.sql`, `db/migrations/0043_people_blocks.sql`, `db/migrations/0048_account_activity.sql`, `db/migrations/0051_account_erasure.sql` |
| Imenik, detalji, mediji, vlasništvo, verifikacija i favoriti | `db/migrations/0004_directory.sql`, `db/migrations/0008_business_media.sql`, `db/migrations/0011_business_details.sql`, `db/migrations/0012_business_reviews.sql`, `db/migrations/0013_business_favorites.sql`, `db/migrations/0014_business_ownership.sql`, `db/migrations/0015_profile_verification.sql`, `db/migrations/0018_directory_revisions.sql`, `db/migrations/0031_directory_removal.sql`, `db/migrations/0046_saved_searches.sql` |
| Termini, lični profili, prijatelji i poruke | `db/migrations/0005_booking.sql`, `db/migrations/0006_personal_profiles.sql`, `db/migrations/0007_people_connections.sql`, `db/migrations/0009_messaging.sql`, `db/migrations/0016_vehicle_rentals.sql`, `db/migrations/0017_accommodation.sql` |
| Naplata, ugovori, dopune i novčanik | `db/migrations/0010_billing.sql`, `db/migrations/0021_paypal_checkout.sql`, `db/migrations/0022_dodo_test_checkout.sql`, `db/migrations/0023_sandbox_package_contracts.sql`, `db/migrations/0024_sandbox_subscription_settlement_hold.sql`, `db/migrations/0027_live_package_contracts.sql`, `db/migrations/0030_production_orders.sql`, `db/migrations/0032_ahi_credit_wallet.sql`, `db/migrations/0033_wallet_category_promotion.sql`, `db/migrations/0034_wallet_package_periods.sql`, `db/migrations/0052_bank_credit_topups.sql`, `db/migrations/0053_production_credit_purchases.sql` |
| Podrška i push | `db/migrations/0020_push_devices.sql`, `db/migrations/0025_support_requests.sql` |
| Marketing, publike i rasporedi | `db/migrations/0028_marketing_offers.sql`, `db/migrations/0029_marketing_online_checkout.sql`, `db/migrations/0035_marketing_campaign_briefs.sql`, `db/migrations/0036_ad_delivery.sql`, `db/migrations/0037_ad_rate_card.sql`, `db/migrations/0038_marketing_ad_asset.sql`, `db/migrations/0039_ad_audience_preferences.sql`, `db/migrations/0040_ad_audience_sample.sql`, `db/migrations/0041_ad_geo_schedule.sql`, `db/migrations/0042_ad_sample_devices.sql` |
| Videozapisi i članci | `db/migrations/0044_business_reels.sql`, `db/migrations/0045_content_hub.sql`, `db/migrations/0047_paid_business_reels.sql`, `db/migrations/0049_reel_engagement.sql`, `db/migrations/0050_reel_reports.sql` |

## Testovi po oblastima

`pnpm test` / `pnpm check`: unit `tsx --test tests/*.test.ts`. Integracijski testovi zahtijevaju izolovani PostgreSQL i `AHIBIZZ_TEST_DATABASE_URL`; CI ih eksplicitno pokreće. Ovdje su testovi popisani, ne označeni kao pokrenuti. Fixture TSX nije test sam po sebi.

| Oblast | Test fajlovi |
|---|---|
| Nalozi, administracija i podrška | `tests/account-authority.test.ts`, `tests/account-overview.test.ts`, `tests/account-return.test.ts`, `tests/account-settings.test.ts`, `tests/activity.test.ts`, `tests/admin-accounts-http.test.ts`, `tests/admin-accounts.test.ts`, `tests/admin-authority.test.ts`, `tests/admin-navigation.test.ts`, `tests/community-rules.test.ts`, `tests/help-center.test.ts`, `tests/mail-examples.test.ts`, `tests/mail-preview.test.ts`, `tests/onboarding-mail.test.ts`, `tests/support.test.ts`, `tests/transactional-email.test.ts` |
| Marketing i videozapisi | `tests/ad-brief.test.ts`, `tests/ad-commerce.test.ts`, `tests/ad-event-token.test.ts`, `tests/reels-public-read.test.ts`, `tests/reels.test.ts` |
| Navigacija, izgled, PWA i instalacija | `tests/android-association.test.ts`, `tests/appearance.test.ts`, `tests/header-menu.test.ts`, `tests/home-nearby.test.ts`, `tests/home.test.ts`, `tests/preview-pwa.test.ts`, `tests/profile-media.test.ts`, `tests/push.test.ts`, `tests/pwa.test.ts`, `tests/server-integration-guard.test.ts`, `tests/session-navigation.test.ts`, `tests/verification-response.test.ts`, `tests/visual-design-schema.test.ts` |
| Auth, runtime i sigurnost | `tests/auth-ingress.test.ts`, `tests/auth-return.test.ts`, `tests/ingress-forwarder.test.ts`, `tests/ingress-observe-start.test.ts`, `tests/ingress-observe.test.ts`, `tests/ingress-policy.test.ts`, `tests/ingress-start.test.ts`, `tests/initial-owner-command.test.ts`, `tests/runtime-security.test.ts`, `tests/server-auth-config.test.ts`, `tests/server-auth-http.test.ts`, `tests/server-db.test.ts`, `tests/server-env.test.ts`, `tests/server-health.test.ts`, `tests/server-migrate.test.ts`, `tests/server-start.test.ts` |
| Naplata, ugovori i novčanik | `tests/bank-credit-topup.test.ts`, `tests/billing-ui-model.test.ts`, `tests/billing.test.ts`, `tests/checkout-http.test.ts`, `tests/checkout-layout.test.ts`, `tests/checkout-methods.test.ts`, `tests/checkout-order-read.test.ts`, `tests/checkout-promotion-recovery.test.ts`, `tests/credit-topup-view.test.ts`, `tests/dodo-http.test.ts`, `tests/dodo-test-adapter.test.ts`, `tests/dodo-test-return.test.ts`, `tests/live-package-setup.test.ts`, `tests/paypal-card-flow.test.ts`, `tests/paypal-card-sdk.test.ts`, `tests/paypal-directory.test.ts`, `tests/paypal-live.test.ts`, `tests/paypal-sandbox.test.ts`, `tests/paypal-store.test.ts`, `tests/sandbox-subscription-provider.test.ts`, `tests/sandbox-subscription-return.test.ts`, `tests/stale-paypal-attempt.test.ts`, `tests/wallet-subscription-status.test.ts` |
| Termini, najam i smještaj | `tests/booking-client-authority.test.ts`, `tests/booking-format.test.ts`, `tests/booking-http.test.ts`, `tests/booking-list.test.ts`, `tests/booking-manual-contract.test.ts`, `tests/booking-preview.test.ts`, `tests/booking-resume.test.ts`, `tests/booking-return.test.ts`, `tests/booking-submission.test.ts`, `tests/booking-time.test.ts`, `tests/customer-appointments-state.test.ts`, `tests/next-appointment.test.ts`, `tests/public-booking-offer.test.ts`, `tests/rental-submission.test.ts`, `tests/rental-time.test.ts`, `tests/rentals-http.test.ts`, `tests/stay-calendar.test.ts`, `tests/stay-submission.test.ts`, `tests/stay.test.ts` |
| Imenik, djelatnosti, recenzije i favoriti | `tests/business-details.test.ts`, `tests/business-import.test.ts`, `tests/business-location-batch.test.ts`, `tests/business-location.test.ts`, `tests/business-media-http.test.ts`, `tests/business-media-normalize.test.ts`, `tests/business-media-preview.test.ts`, `tests/business-media-recovery.test.ts`, `tests/business-media.test.ts`, `tests/business-ownership-client.test.ts`, `tests/business-ownership.test.ts`, `tests/business-today.test.ts`, `tests/device-location.test.ts`, `tests/directory-client.test.ts`, `tests/directory-create-submission.test.ts`, `tests/directory-mutation-recovery.test.ts`, `tests/directory-navigation.test.ts`, `tests/favorite-recovery.test.ts`, `tests/favorites.test.ts`, `tests/geocoding.test.ts`, `tests/public-business.test.ts`, `tests/public-directory-read.test.ts`, `tests/public-review.test.ts`, `tests/reviews-http.test.ts`, `tests/reviews-memory.test.ts`, `tests/reviews.test.ts`, `tests/saved-search.test.ts` |
| Ljudi, prijatelji i poruke | `tests/connections-contract.test.ts`, `tests/connections-http.test.ts`, `tests/connections-preview.test.ts`, `tests/messaging-command-state.test.ts`, `tests/messaging-http.test.ts`, `tests/messaging-preview.test.ts`, `tests/messaging-recovery-storage.test.ts`, `tests/messaging.test.ts`, `tests/people-client.test.ts`, `tests/people-http.test.ts`, `tests/people-preview.test.ts`, `tests/public-person-businesses.test.ts` |
| Integracija PostgreSQL | `tests/integration/account-erasure.test.mjs`, `tests/integration/auth.test.mjs`, `tests/integration/bank-credit-topup.test.mjs`, `tests/integration/billing.test.mjs`, `tests/integration/booking.test.mjs`, `tests/integration/business-details.test.mjs`, `tests/integration/business-favorites.test.mjs`, `tests/integration/business-media.test.mjs`, `tests/integration/business-ownership.test.mjs`, `tests/integration/business-reviews.test.mjs`, `tests/integration/connections.test.mjs`, `tests/integration/directory.test.mjs`, `tests/integration/dodo-checkout.test.mjs`, `tests/integration/initial-owner.test.mjs`, `tests/integration/messaging.test.mjs`, `tests/integration/paypal-checkout.test.mjs`, `tests/integration/paypal-subscriptions.test.mjs`, `tests/integration/people.test.mjs`, `tests/integration/postgres.test.mjs`, `tests/integration/reels.test.mjs` |

## Kandidati za brisanje i dokaz

| Fajl/grupa | Dokaz | Odluka prije brisanja |
|---|---|---|
| `src/app/pregled/**` | Šest javnih demo stranica, sintetički profili; zaseban layout i preview state. Stvarne rute su iznad. | Ukloniti javne demo rute po nalogu vlasnika. |
| `src/components/preview/AccountPreview.tsx`, `BusinessCard.tsx`, `BusinessPreview.tsx`, `MessagingPreview.tsx`, `PeoplePreview.tsx`, `PreviewBooking.tsx`, `PreviewHome.tsx`, `PreviewPwa.tsx`, `PreviewShell.tsx` i njihove CSS datoteke | Koriste ih javne demo rute/međusobno; provjeriti da nema preostalog produkcijskog importa nakon uklanjanja rute. | Ukloniti samo zatvoreni demo podgraf. |
| `public/preview-app.webmanifest`, `public/preview-sw.js`, `public/preview-offline.html`, `tests/preview-pwa.test.ts` | Isključivo preview instalacija i njeni testovi. Stvarna PWA koristi `app.webmanifest`, `sw.js`, `app-offline.html`. | Ukloniti preview instalaciju; ikone dijele obje PWA pa ostaju. |
| `src/server/dodo/**`, `src/lib/dodo-test-return.ts`, pripadajući unit/integracijski testovi | Nema `src/app/api/dodo-test` rute ni produkcijskog poziva. Importi zatvoreni u ovoj grupi/testovima; CI samo testira izolovani adapter. | Ukloniti kod/testove i pripadajući CI korak, sačuvati migraciju 0022. |
| `src/server/paypal-sandbox.ts`, `tests/paypal-sandbox.test.ts` | Samostalni stari prototip; nema importa iz ruta ili stvarnog checkout runtimea, samo test. | Ukloniti prototip. |
| `scripts/verify-*-ui.mjs` | Ručne stare fixture skripte, nema package/CI runtime poziva. | Prije brisanja zadržati korisne fixture i pokrivenost; zabilježiti browser jaz. |
| `docs/AUTH-INGRESS-ENFORCEMENT-CANDIDATE.md`, `docs/AUTH-INGRESS-OBSERVATION.md` i zastarjeli pregledi modula | Candidate/observation opisuju historijsko stanje; važeća pravila moraju se prenijeti u arhitekturu/operativne upute. | Konsolidovati, ne izgubiti dokaze o trust granici ni operatorske zabrane. |

Ne brisati: `src/components/preview/PreviewState.tsx` i `preview-data` koji su još vezani za administratorski simulator, `public/preview/*.webp` dok ih simulator koristi, preview props na stvarnim komponentama koje simulator još koristi, `src/server/paypal-subscriptions/**` i sandbox/live grane zajedničkog checkouta koji obrađuje historiju. Default zastavica nije dokaz produkcijske vrijednosti.

Mogući nepozvani exporti `src/lib/ad-render.ts`, `bank-credit-topup.ts`, `business-ownership.ts`, `verification.ts` koriste se kroz tipove/testove ili pomoćne veze; samo AST analiza runtime importa ih ne može proglasiti mrtvim. Potrebno je pretražiti sve reference imena prije odluke. Framework `layout.tsx` i `not-found.tsx` nisu mrtvi zato što nemaju eksplicitni import.

Nije nađen praćeni `artifacts/` sadržaj u početnom `git ls-files` popisu. Ne brisati korisnikove nepraćene artefakte bez provjere.
