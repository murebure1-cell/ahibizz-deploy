# Arhitektura AhiBizza

Stanje je opisano iz koda grane `codex/handover-cleanup`. Ovo je mapa za održavanje; stvarni rad na produkciji i stvarne poslovne transakcije nisu potvrđeni ovim dokumentom. Rute i pojedinačne kontrole su u [INVENTURA.md](INVENTURA.md), dok [PROVJERA.md](PROVJERA.md) razlikuje pregled koda, izvršene testove i preostale browser provjere.

## Slojevi i tok zahtjeva

1. `src/app` sadrži Next.js App Router stranice, server actions i HTTP rute. Grupe `(public)` i `(viewer)` nisu dio URL-a. Javna grupa obuhvata i zaštićene stranice: naziv grupe nije pravilo pristupa.
2. `src/components` sadrži korisničke tokove po oblastima. Klijentske komponente koriste transport i provjeru odgovora iz `src/lib`, a server stranice čitaju servise direktno.
3. `src/lib` sadrži tipove, formatiranje, parsiranje odgovora, izračune i klijentske modele za ponavljanje zahtjeva. Ovdje nema autoritativnog odobravanja radnje.
4. `src/server/*-http.ts` i `src/app/api/**/route.ts` provjeravaju metod, putanju, ulaz, veličinu tijela i porijeklo mutacije. Servisi u `src/server` provjeravaju svježu sesiju, pravo pristupa i poslovna pravila unutar transakcije.
5. `src/proxy.ts` stoji ispred stranica (ne ispred `/api`, fajlova Next.js-a ni fajlova s ekstenzijom) i ima jedan posao: dok dan otvaranja iz `src/lib/opening.ts` nije prošao, gostu bez kolačića sesije umjesto javne stranice prikaže `/uskoro`, bez promjene adrese. Bez upisanog dana propušta sve. Nije pravilo pristupa: zaštićene stranice i servisi i dalje sami provjeravaju sesiju.
6. PostgreSQL čuva naloge, sadržaj, komande, historiju. `db/migrations` sadrži primijenjeni redoslijed sheme, ograničenja, trigere i SQL funkcije. Ne mijenjati stare migracije niti ponovo kreirati produkcijsku bazu.

Uobičajena promjena: forma → klijentski transport → HTTP handler/server action → provjera identiteta i uloge → validacija i zaključavanje redova → promjena i potvrda iste transakcije → provjeren odgovor → osvježavanje UI-ja.

## Identitet i ovlasti

`auth_user.role='owner'` znači administrator platforme. Vlasnik pojedinačne djelatnosti se određuje preko `directory_business.owner_user_id`; korisnik može imati djelatnost uz ulogu `member`. Ova dva pojma se ne smiju zamijeniti.

Better Auth koristi `auth_user`, `auth_session`, `auth_account`, `auth_verification` i `auth_rate_limit`. Operativni nalog mora imati potvrđen email, `approval='approved'` i dozvoljenu ulogu. Servisi ponovo provjeravaju sesiju uz isključen cookie cache i zaključavaju autoritativne redove. `X-AhiBizz-Account-ID` veže radnju za nalog koji je prikazan u klijentu; to je dodatna provjera, a ne zamjena za sesiju. `expectedVersion`, `expected` i identifikatori komande štite od zastarjelog ekrana i ponovljenog zahtjeva.

Glavna mjesta: `src/server/auth/service.ts`, `src/server/auth/accounts.ts`, `src/server/auth/config.ts`, `src/server/auth/ingress.ts`. Početno aktiviranje administratora je eksplicitna operatorska komanda u `scripts/initial-owner.mjs`; nije dio obične registracije.

`AccountAuthorityBoundary` pri gubitku fokusa, skrivanju dokumenta ili odlasku sa stranice sakriva privatni panel. Pri povratku provjerava isti nalog i ulogu. Sakrivanje ne briše DOM, memoriju ni postojeće nacrte; zato svaka podređena mutacija i dalje provjerava sesiju na serveru. Sačuvani nacrt ili rezultat starog zahtjeva nikad se ne smije prikazati kao podatak drugog naloga. Samostalni administratorski ekrani imaju vlastite granice pristupa.

## Mapa modula

| Modul i ulaz | Glavni kod | Ključni podaci i pravila |
| --- | --- | --- |
| Prijava, registracija, reset lozinke | `components/auth/AuthForm.tsx`; `server/auth-http.ts`; `server/auth` | Better Auth tabele; odobravanje naloga i poništavanje sesija u `auth/accounts.ts`; promjena lozinke ograničava pokušaje i odjavljuje druge uređaje. |
| Nalog i administracija | `components/account`; `components/admin`; `server/account-http.ts`; `server/account-overview.ts`; `server/admin-today.ts` | `auth_account_preferences`, `auth_account_audit`, prikaz aktivnosti i administrativnih redova. Server provjerava ulogu `owner` za administraciju. |
| Imenik i javni profil djelatnosti | `components/directory`; `server/directory`; `lib/public-business.ts` | `directory_category`, `directory_business`, `directory_create_commands`, `directory_moderation_audit`. Javna dostupnost zavisi od statusa objave, naloga vlasnika i `package_allows_listing`. Uklanjanje je odvojeno od arhivske historije. |
| Detalji, fotografije, lokacije | `server/business-details-http.ts`; `server/business-media`; `lib/business-location*.ts`; `server/media/normalize-image.ts` | `directory_business_details`, `directory_business_image`, `directory_business_image_proposal`, medijske komande i događaji. Upload ima provjeru tipa, veličine i normalizaciju; javna izmjena prolazi pravila odobravanja. |
| Prenos vlasništva i verifikacija | `server/business-ownership`; `server/verification.ts`; odgovarajuće admin komponente | `directory_ownership_transfer`, `profile_verification_decision`; zaključavanje prethodnog i novog vlasnika, verzija djelatnosti, svježa sesija. Verifikacija se može poništiti promjenom profila/vlasništva. |
| Termini usluga | `components/booking`; `server/booking`; `lib/booking-time.ts` | `booking_settings`, `booking_service`, `booking_entry`, `booking_entry_event`, `booking_create_commands`. Vremenska zona je dio konfiguracije; server i SQL sprečavaju preklapanje. |
| Iznajmljivanje vozila | `components/rentals`; `server/rentals`; `lib/rental-submission.ts` | `rental_vehicle`, `rental_booking`, `rental_booking_event`; zasebna dostupnost inventara, blokade, zahtjevi i potvrde. |
| Smještaj | `components/stays`; `server/stays`; `lib/stay-calendar.ts` | `stay_unit`, `stay_unit_photo`, `stay_booking`, `stay_booking_event`; lokalni datumi dolaska/odlaska i dostupnost jedinice. Ne pretvarati datume boravka u UTC trenutke bez pravila modula. |
| Ljudi, profil i prijateljstva | `components/people`; `components/connections`; `server/people`; `server/connections` | `personal_profile`, `personal_profile_image`, `personal_profile_entitlement`, `people_connection`, komande i događaji. Objavljivanje profila je eksplicitno; javni podaci su odvojeni od privatnih. |
| Blokiranje korisnika | `server/account-blocks.ts`; `components/account/BlockedPeople.tsx`; `components/connections/ProfileBlockAction.tsx` | `people_block` i `people_contact_blocked`; blokiranje utiče na kontakte, poruke i prikaz u pretrazi. Postojeća historija razgovora ostaje za prijavu sadržaja. |
| Poruke | `components/messaging/MessagingInbox.tsx`; `server/messaging`; `lib/messaging-command-state.ts` | `message_thread`, `message_thread_member`, `message_message`, `message_command`. Učesništvo i vlasništvo djelatnosti se provjeravaju na serveru; klijent čuva oporavak nepotvrđene komande, a SQL štiti historiju. |
| Reels | `components/reels`; `server/reels`; `lib/reels.ts` | `business_reel`, `business_reel_part`, `business_reel_like`, `business_reel_view`. Upload se sastavlja iz dijelova; provjeravaju se medij, vlasništvo, status objave, ograničenja iz `lib/reels.ts`. Javna reprodukcija podržava byte range. |
| Recenzije | `components/reviews`; `server/reviews`; `lib/reviews.ts` | `business_review`, `business_review_command`, `business_review_event`. Pravo objave, vlastita recenzija, povlačenje, moderacija i zbirni rezultat provjeravaju se posebno; skrivena recenzija nije javna. |
| Sačuvane djelatnosti i pretrage | `components/favorites`; `server/favorites`; `server/saved-search.ts` | `business_favorite`, `business_favorite_command`, `directory_saved_search`; privatni podaci po nalogu. Sačuvana pretraga čuva normalizovane filtre, ne proizvoljan URL. |
| Blog i pomoć | `components/content-hub`; `server/content-hub.ts`; `lib/help-center.ts` | `blog_article`, `blog_bookmark`. Administrator objavljuje uz reviziju članka; javni sadržaj je samo objavljen članak. Vodič pomoći koristi sadržaj u kodu, ne AI servis. |
| Pravila, prijave i brisanje | `components/support`; `server/support-requests.ts`; `server/community-rules.ts`; `server/account-erasure.ts` | `support_request`, `community_rules_acceptance`, `account_erasure_receipt`; brisanje provjerava naloge, aktivne rezervacije, djelatnosti. `erase_account_content` uklanja privatni sadržaj uz zadržavanje potrebne historije. |
| Push i email | `components/pwa`; `server/push`; `server/auth/mail.ts`; `server/auth/approval-worker.ts`; `server/mail` | `push_device`, `push_signer`, `push_delivery`, `push_test_limit`, `account_approval_email`. `instrumentation.ts` pokreće radnike u Node runtimeu izvan builda. Email/push radnici su stvarni vanjski izlazi, pa lokalne provjere koriste izolaciju i zamjene. |
| PWA/Android i izgled | `components/pwa`; `lib/distribution.ts`; `lib/android-association.ts`; `components/design`; `server/visual-design-store.ts` | Manifest, service worker, offline stranica, Android asocijacija i `platform_settings`. Play izdanje se određuje tokom builda. Vidi [GOOGLE-PLAY.md](GOOGLE-PLAY.md). Administratorski pregled izgleda je alat za stvarnu aplikaciju. |

## Pravila javnog sadržaja i oporavka

- Isključeno ili neuneseno radno vrijeme je nepoznato, ne zatvoreno. Uključeno radno vrijeme ima svih sedam dana; dan bez intervala znači zatvoreno. Do četiri intervala po danu ne smiju se preklapati. Rad preko ponoći pripada dvama danima. Radno vrijeme je nezavisno od booking rasporeda i ne stvara termine. Pogodnosti su izjave vlasnika, ne verifikacijski certifikati.
- Autor recenzije mora biti potvrđen i odobren; vlasnik ne ocjenjuje vlastitu djelatnost. Jedna trajna recenzija po nalogu/djelatnosti ima izmjene, povlačenje i moderaciju s historijom. Skrivena/povučena recenzija ne ulazi u javni zbir; prenos vlasništva može raniju recenziju učiniti vlastitom i isključiti je. Privatni profil autora javno se prikazuje kao „Korisnik AhiBizza“, bez privatnog identiteta.
- Favoriti su privatni čak i prema običnom administratorskom pregledu. Sačuvan izbor ostaje pohranjen kada djelatnost privremeno nije javna, ali ne prikazuje privatni sadržaj. Ponovno objavljivanje može vratiti stavku. Komanda ima očekivanu verziju, željeno stanje i isti ključ pri ponavljanju; lokalni dnevnik sprečava slučajno slanje nove namjere poslije nepoznatog ishoda. Prijava sama ne izvršava namjeru „sačuvaj“.
- Grupna korekcija lokacija zahtijeva stvarnu adresu, izvor prijedloga, pregled i važeću verziju. Centar grada, približna ulica ili dvosmislena adresa ne postaju precizna lokacija bez potvrde. Nakon neizvjesnog odgovora prvo se čita stanje.
- Zahtjev za brisanje naloga nije finansijski povrat niti otkaz rezervacije. Administrator rješava aktivne obaveze prije brisanja. Transakcija zamjenjuje podatke obrisanog naloga, briše sesije i privatni sadržaj, te njegove poslane poruke označava obrisanim sadržajem. Poruke drugih učesnika i potrebna finansijska historija ostaju. Administratorski nalog ima dodatnu zaštitu i zasebnu operatorsku obradu.

## Operativno održavanje

`scripts/start.mjs` pokreće migracije ako je postavljen `DATABASE_URL`, a zatim standalone server. Zbog toga ga ne pokretati nad produkcijskom konfiguracijom radi obične provjere. `src/server/db.ts` i `env.ts` pružaju konfiguraciju baze bez ispisivanja tajni. Liveness i readiness imaju odvojene rute: `/api/health/live` potvrđuje proces, `/api/health/ready` uključuje bazu.

`scripts/ingress-*` su dio sigurnog ulaza kada je uključen. Ne uklanjati ih samo zato što ih stranice ne importuju: učitavaju ih start i CI. Povjerenje proslijeđenom IP-u zavisi od eksplicitne konfiguracije, ne proizvoljnog zaglavlja korisnika.

CI u `.github/workflows/ci.yml` pokreće jedinice, izolirane PostgreSQL scenarije, produkcijski image, sigurnosni pregled i smoke provjere. Lokalni `pnpm check` ne znači da su ove dodatne provjere prošle. Migracije, integracijski scenariji, browser, uređaj i stvarna finansijska transakcija su odvojeni slojevi dokaza.

Promjena se priprema na zasebnoj grani iz `origin/integration/ahibizz`, uz jednog vlasnika zadatka i PR u `integration/ahibizz`. Put do produkcije je privatna integracija → `murebure1-cell/ahibizz-deploy` → OctaDeploy app 213. Ovlašteni objavljivač potvrđuje tačnu reviziju, svjež backup, objavu i rezultat na živoj aplikaciji. Ovaj zadatak ne objavljuje promjene.
