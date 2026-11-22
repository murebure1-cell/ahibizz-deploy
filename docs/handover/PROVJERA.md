# Provjera ekrana i tokova

## Završni lokalni rezultat — 22. 11. 2026.

**787 jediničnih testova prošlo je u 123 fajla**, bez grešaka i otkazanih testova u tom prolazu. To je alternativni lokalni prolaz, ne potvrda standardnog CI-ja: TypeScript je emitovan u privremeni folder, Node `registerHooks` je učitavao emitovani JavaScript uz originalne URL-ove izvora, a svaki testni fajl pokrenut je zasebno bez child-process test izolacije. Testovi nisu mijenjani da bi se zaobišle provjere.

Osam fajlova koji pokreću zasebne procese nije uključeno u taj uspješni prolaz: `ingress-observe`, `ingress-observe-start`, `ingress-start`, `initial-owner-command`, `reels-public-read`, `runtime-security`, `server-migrate`, `server-start` (sve `.test.ts`). Standardni `pnpm test` pokušava pokretanje svih fajlova, ali ga zaustavlja sandbox `spawn EPERM`. Ovi testovi i svi PostgreSQL scenariji ostaju obavezni u punom CI-ju.

| Faza / komanda | Stvarni rezultat |
| --- | --- |
| Faze 1–6: `pnpm exec biome check .` | Prolazi; završni prolaz ima 14 postojećih upozorenja i 14 informativnih nalaza, bez grešaka. Privremena greška formatiranja tokom faze 2 ispravljena je prije faznog commita. |
| Faze 1–6: `pnpm exec tsc --noEmit` | Prolazi. Emitovani TypeScript za alternativne testove također je kompajliran. |
| Faze 1–6: `pnpm test` | Ne prolazi zbog `spawn EPERM`, bez izvršenja standardnog testnog skupa. |
| Faza 2: izravni `node tests/pwa.test.ts` | 14/14 prošlo. |
| Faza 3: `account-overview` i `next-appointment` preko privremenog runnera | 4/4 prošlo: format datuma, vremenske zone i kalendarski prikaz. |
| Faza 4: ciljani support/ad-preference/settlements/display/booking/people/connections testovi | Svi izvršeni testovi prolaze; uključeni su i u širi prolaz od 787 testova. |
| Faza 5: PWA, Android association, pomoć i Play ograničenja | 25/25 prošlo; web/Play rewrites i HTML/JSON 404 provjereni izvršenjem testova. |
| Završni `pnpm check` | Biome i TypeScript prolaze; testni korak staje na `spawn EPERM`. |
| `pnpm build` | Next konfiguracija učitana i produkcijska kompilacija završena; zasebni TypeScript proces zatim staje na `spawn EPERM`. Build nije završen i nije označen prolaznim. |
| `git diff --check` i relativni Markdown linkovi | Prolaze; provjerenih deset Markdown dokumenata nema nepostojeći relativni link. |
| Zaštićene datoteke | Prazan diff kartica djelatnosti, mobilnog menija, pripadajućih stilova/navigacije, `db/migrations` i `.env.example`. Aktivne ikone su premještene bez izmjene slikovnih bajtova. |

Nije korištena živa baza niti su pokrenuti email, push, bankovni ili PayPal tokovi. Nema browser klikanja, fizičkog Android testa, generisanog/potpisanog APK/AAB-a, provjere produkcijskog potpisa ili objave.

Čišćenje je dodatno uklonilo nepozvane `preview` propove iz šest stvarnih komponenti te sandbox UI granu `PackageCheckout`. Administratorski simulator zadržava svoje stvarno korištene memorijske adaptere. Cijene, ugovori i historijska čitanja nisu promijenjeni.

## Obim i značenje oznaka

Početna [INVENTURA.md](INVENTURA.md) ima 48 `page.tsx` ruta i 1.104 statička interaktivna JSX mjesta. Uklonjeno je šest javnih demonstracijskih stranica pod `/pregled`, pa aplikacija ima 42 preostale stranice. Layouti, dinamičke instance kontrola i query pod-ekrani nisu nove `page.tsx` rute.

**Pregled koda** znači da su pročitani ulaz stranice, relevantni handleri/servisi i navedena pravila. **Statički trag** znači da je potvrđeno postojanje odredišta/importa/kontrole, ali nije izvršen korisnički klik niti puna provjera svake dinamičke grane. **Test-oblast** pokazuje gdje se nalaze odgovarajući testovi; samo po sebi ne znači da su izvršeni ili da pokrivaju cijeli ekran. **Browser ostaje** važi za svaku preostalu stranicu i svaki njen interaktivni element, uključujući zaštićene kartice djelatnosti i mobilni meni.

Ovim radom se ne tvrdi da je svih 1.104 kontrola ručno izvršeno niti da je svaki tok s bazom prošao. Nema lokalnog PostgreSQL-a/Dockera, nisu izvođene stvarne uplate, slanje emaila ni push poruka. Završne rezultate komandi i preostale build/CI provjere bilježi završni izvještaj zadatka.

## Izvršene provjere i ograničenja

| Provjera | Rezultat / granica |
| --- | --- |
| Statički pregled literalnih `href`/`action` odredišta u `src` prema postojećim `page.tsx` i `route.ts` obrascima | Na početnom snapshotu nije pronađeno nepostojeće literalno odredište. Dinamički URL-ovi, hash odredišta i uslovno renderovanje zahtijevaju test konkretnog toka. |
| Pregled pristupa | Svježa sesija, uloga i/ili vlasništvo pregledani u auth/account, imenik, booking/inventar, ljudi/veze, favoriti, podrška, novčanik, marketing i Reels servisima. Nalaz zatvaranja prijave iz zastarjelog administratorskog ekrana obrađen je zasebnom ispravkom. |
| Ciljani lint ispravke podrške | `pnpm exec biome check` za stranicu zahtjeva, servis, novi helper i oba testna fajla: 5 fajlova, bez grešaka. |
| Ciljani unit ispravke podrške | `tests/support-action.test.ts`: 3 prošla, 0 pala. Pokrenuto putem privremenog Node import loadera nad TypeScript izlazom (`tsc --noEmit false --incremental false`); kompilacija je prošla. Ovo nije standardni puni `pnpm check`. |
| Ciljani unit privatnosti oglasa i pregleda transakcija | `tests/ad-preference-state.test.ts` i `tests/package-settlements.test.ts`: po 3 prošla, 0 pala; ista privremena kompilacija/Node loader. Pojedinačno ponovo pokrenut i `support-action`: 3/3. Ukupno 9 ciljnih testova prošlo. |
| Tipovi i lint | Tačne komande, faze i rezultate vidi u završnom izvještaju; ne izjednačavati lint/typecheck sa browser provjerom. |
| Jedinični testovi | Vidi rezultat izvršavanja uz završni izvještaj. Zasebne test-oblasti u tabeli ispod predstavljaju mapu pokrivenosti, ne tvrdnju o izvršenju pojedinačnog scenarija u browseru. |
| Integracijski testovi `tests/integration` | Pripremljeni za izoliranu CI bazu. Ovdje nisu izvršeni jer nema lokalne testne baze; ne koristiti produkcijsku bazu kao zamjenu. |
| Browser, Android uređaj i TWA | Nisu izvršeni. Claude Code/tim provodi ih poslije ovlaštene objave pregledane revizije. |

## Ispravke iz pregleda podrške

- Forma za zatvaranje prijave sada šalje identitet prikazanog operatora. `resolveSupportRequest` ga veže za request zaglavlje prije provjere potpisane sesije, pa drugi prijavljeni administrator ne može neprimjetno izvršiti staru radnju iz tuđeg ekrana.
- Nedostupan servis više ne izgleda kao uspješno zatvaranje: akcija vodi na jasno upozorenje da treba provjeriti status.
- Ponovljeno zatvaranje već obrađene obične prijave vraća uspjeh bez promjene `resolved_at`/`resolved_by`. Zahtjev za brisanje i dalje mora proći odvojeni postupak, ne može se zatvoriti običnom akcijom.
- `tests/integration/support-cases.mjs` sada provjerava promijenjeni identitet operatora, ponavljanje i nepromijenjeno vrijeme/autora zatvaranja u stvarnoj izoliranoj bazi. Ovi novi integracijski slučajevi nisu lokalno izvršeni.
- Privatnost oglasa sada odbacuje stari GET započet prije snimanja, čeka završetak snimanja pri zatvaranju/ponovnom otvaranju i ponovo čita stanje. Odgovor mora sadržavati dozvoljen izbor. Promjena naloga pravi zasebno stanje; kasni rezultat prethodnog naloga se zanemaruje. Zahtjevi imaju timeout, a dvostruko slanje se ne izvršava.
- Pregled transakcija paketa validira uspješan JSON odgovor prije prikaza: niz uplata, broj stranice, iznos, datum, status i logička polja. Neispravan odgovor daje postojeću poruku greške umjesto rušenja ekrana. Zadržana su sva četiri historijska statusa uplate/povrata i granica zadnje API stranice.

## Svaki preostali ekran

`tests/*.test.ts` označava jedinične testove, a nazivi `tests/integration/*` izolirane integracijske scenarije. Redovi ispod bilježe i ono što ostaje za stvarni browser.

| Ekran | Pregled koda / statički trag | Test-oblast | Ostaje za browser |
| --- | --- | --- | --- |
| `/` | Javna čitanja objavljenih djelatnosti; opcionalni blokovi i fallback; linkovi na profile/pretragu. Kartice i mobilni meni samo inventarisani, nisu mijenjani. | `home`, `home-nearby`, `public-directory-read`, `device-location` | Svaki blok, geolokacija dozvoljena/odbijena, skrol, prazni podaci, kartice i zajednička navigacija. |
| `/pretraga` | Parsiranje filtera, paginacija, clear/search, javna vidljivost i blokade; kartice sačuvane. | `directory-navigation`, `directory-client`, `public-directory-read`, `saved-search`; integracija `directory` | Kombinacije filtera, neispravan URL, prazna lista, naredna/prethodna, sačuvaj pretragu i omiljene. |
| `/djelatnosti/[id]` | Javna podobnost, 404, kontakti/galerija, booking/rental/stay ponude i recenzije. Server zasebno provjerava korisnika i stanje ponude. | `public-business`, `public-booking-offer`, `business-details`, `reviews-http`, booking/rentals/stays testovi | Svaka galerija, mapa, telefonski/email/web link, rezervacija za gosta/korisnika/vlasnika, promjena dostupnosti i greška mreže. |
| `/ljudi` | `PeopleSearch` koristi normalizovan upit i javni profil; privatne veze ostaju iza provjere sesije. | `connections-http`, `connections-contract`; integracija `connections` | Pretraga, paginacija, prazan rezultat i otvaranje profila. |
| `/ljudi/[id]` | Javni/privatni profil, odgovori za nestali profil, vezivanje zahtjeva za prijateljstvo, blokiranje i lista stvarnih djelatnosti. | `connections-http`, `public-person-businesses`, `people-client`; integracija `connections` | Sve kartice profila, prijateljstvo/prihvati/odbij/ukloni, blokiranje, promjena naloga u drugoj kartici. |
| `/blog` | Objavljeni članci, teme, search, paginacija i privatni filter sačuvanih članaka; jasna prazna/nedostupna stanja. | integracija `content-hub-cases` kroz `connections` | Svaka tema, upit, featured članak, prazna i sačuvana lista za gosta/člana. |
| `/blog/[slug]` | Samo objavljen članak; privatno čuvanje veže actor za sesiju; povratak na blog i temu. | integracija `content-hub-cases` | Čuvanje/uklanjanje, dvostruki klik, zastarjeli nalog, nestali članak. |
| `/o-nama` | Statički tekst i postojeća odredišta; Play uslov za komercijalne linkove je zaseban audit. | `pwa` / Play audit | Svi linkovi i responzivni prikaz. |
| `/privatnost` | Javno dostupna stranica i link za brisanje; opis se upoređuje sa stvarnim modulima u arhitekturi/Play dokumentu. | Play readiness provjere | Otvaranje bez prijave, čitljivost i svaki kontakt/link. |
| `/pravila-zajednice` | Javna pravila, prijava sadržaja, prihvatanje pravila na zaštićenim doprinosima. | `community-rules`; integracija `community-cases` | Otvaranje bez prijave; prihvati, otkaži i pokušaj doprinosa bez prihvatanja. |
| `/pomoc` | Lokalni vodič pitanja, linkovi i slanje podršci kroz actor-bound server action; validacija teme/reference. | `help-center`; integracija `support-cases` | Pretraga pitanja, sva brza pitanja, prenos u formu, prazna/duga poruka i ponovljeno slanje. |
| `/prijavi-sadrzaj` | Bez reference vodi na pomoć; neispravan target na 404; server provjerava stvarnu vidljivost prijavljenog sadržaja. | `community-rules`; integracija `support-cases` | Gost/član, svaki tip prijave, uklonjen sadržaj, mrežna greška i ponovljen submit. |
| `/brisanje-naloga` | Javne upute; zahtjev preko podrške; administrator obrađuje nakon provjera zavisnosti. Ne obećava brisanje potvrđenih uplata. | integracija `account-erasure`, `support-cases` | Bez prijave, prijavljen korisnik, potvrda zahtjeva i odgovarajući status. Destruktivni završetak samo u izoliranim podacima. |
| `/instaliraj` | PWA tok, dozvole i platformni uslovi; statički manifest i service worker pregledani u Play fazi. | `pwa`, `android-association` | Android instalacija, već instalirana app, iOS upute, odbijene dozvole, offline i povratak online. |
| `/prijava` | Poznati nalog se preusmjerava sigurnim return-path parserom; istekla/nedostupna sesija ostavlja formu. | `auth-return`, `session-navigation`, `server-auth-http`, `auth-ingress` | Ispravna/pogrešna prijava, neodobren nalog, potvrda emaila, povratak na namjeru i dva klika. |
| `/registracija` | Zatvoreni povratni URL, validacija forme i prihvatanje pravila; server auth ograničenja. | `server-auth-config`, `server-auth-http`, `auth-return`; integracija `auth` | Registracija testnog naloga, postojeći email, nedostupna mreža i testni email transport. |
| `/zaboravljena-lozinka` | Forma zahtjeva, ograničenja auth servisa, neutralan odgovor bez otkrivanja naloga. | `server-auth-http`; integracija `auth` | Testni email, ponovljen submit, nepostojeći email i greška mreže. |
| `/nova-lozinka` | Token i potvrda nove lozinke; neispravan/nedostajući token ima fallback link. | `server-auth-http`; integracija `auth` | Važeći/istekli/iskorišten token, nejednake lozinke, dvostruki submit. |
| `/nalog` | Zahtijeva odobren, potvrđen nalog; section/return parametri imaju zatvorene parsere. Komponente čuvaju granice identiteta i jasna stanja. | `account-*`, `session-navigation`, `admin-authority`; integracija `auth` i moduli ispod | Svi pod-ekrani iz naredne tabele, promjena naloga, refresh/back, mrežna greška. |
| `/nalog/obavijesti` | Čitanje pripada primaocu; označavanje veže nalog i verziju; cilj se gradi iz tipa aktivnosti. | `activity`; integracija `community-cases` | Otvori svaku vrstu, označi sve, paginacija, uklonjen predmet, dva klika. |
| `/nalog/reels` | Vlastiti zapisi, prava na djelatnost, paginacija i blokirana kreacija u Play; medij i kredit server validiraju zasebno. | `reels`, `reels-public-read`; integracija `reels` | Učitavanje dijelova, prekid/retry, predaja, povlačenje, cijena i odsustvo kupovine u Play. |
| `/blokirani-korisnici` | Privatna lista, granica naloga, verzionirana promjena blokade. | `connections-http`; integracija `connections` | Prazno stanje, pretraga/paginacija ako prikazana, odblokiranje, promjena naloga. |
| `/sacuvane-pretrage` | Privatno čitanje i uklanjanje; odredišta su normalizovani filteri. | `saved-search`; integracija `community-cases` | Otvaranje/uklanjanje svake pretrage, prazna lista, mrežna greška. |
| `/reels` | Javno vidljivi zapisi, pripadajuća djelatnost, paginacija i ulazak u viewer. | `reels-public-read`; integracija `reels` | Feed bez zapisa, filter djelatnosti, paginacija i otvaranje videa. |
| `/reels/[id]` | Publikacija/vidljivost i stream provjere; reakcija veže nalog, dijeljenje ima clipboard fallback. | `reels`, `reels-public-read`; integracija `reels` | Play/pause/mute/seek, stariji/noviji, back, rotacija uređaja, like/retry, share bez API-ja, prijava. |
| `/paketi` | Katalog i postojeća cijena; Play dostupnost pregledana u fazi 5. Cijena i uslovi nisu promijenjeni. | `billing`, `billing-ui-model`, `live-package-setup` | Poređenje, mjesečno/godišnje, nastavak na vlastitu djelatnost i Play ograničenje. |
| `/paketi/placanje` | Odabir paketa/djelatnosti, provjera ugovora i postojećeg prava; ishod određuje server. | `wallet-subscription-status`, `live-package-setup`; integracija `wallet-package-cases` | Vlasnik/tuđa djelatnost, nedovoljno kredita, nepoznat ishod, dva klika, historijski ugovor. |
| `/naplata` | Zatvoreni parametri narudžbe; kreditni put i zadržana historija kartičnog toka; pristup vlasnika u servisu. | `checkout-*`, `paypal-*`; integracija `paypal-checkout`, `wallet-promotion-cases` | Stvarna potvrda naplate nije rađena; testnim podacima provjeriti nedovoljno stanje, ponavljanje i odustajanje. |
| `/naplata/povratak` | Povratni URL ne potvrđuje uplatu; klijent ponovo čita status na serveru. | `checkout-order-read`, `paypal-card-flow`, `stale-paypal-attempt` | Povratak potvrđen/nepotvrđen, mrežna greška, osvježavanje i dupli povratak. |
| `/naplata/odustajanje` | Siguran odustanak i čitanje stvarnog statusa, historijski zapis ostaje. | `checkout-order-read`, `paypal-card-flow` | Otkazano, već plaćeno, prozor zatvoren usred pokušaja i povratak. |
| `/oglasavanje` | Katalog, izbor prostora, podatak publike i postojeći kontakti; server ne pretpostavlja uplatu. | `ad-brief`, `ad-commerce`, `ad-event-token`; integracija `marketing-cases`, `ad-campaign-cases` | Svi formati, filtri, priprema ponude, kontakti, Play ograničenje i prazna statistika. |
| `/podrzi` | Eksplicitna javna konfiguracija primaoca/metoda; odvojena od kupovine Ahi kredita. | `support`, `pwa` | Isključen/uključen tok, iznos, copy fallback, vanjski link i Play ograničenje. |
| `/administracija` | Uloga `owner`, početni section parser i privatni servisi; redirect ostalih korisnika. | `admin-*`, `account-authority`; integracija `auth`, `directory`, `billing` | Svi pod-ekrani, gubitak ovlasti, dva otvorena administratorska taba i greške mreže. |
| `/administracija/blog` | Owner, editor revizija, objavi/nacrt, featured i paginacija. | integracija `content-hub-cases` | Kreiraj/izmijeni testni članak, konflikt revizije, uklanjanje featured i povratak. |
| `/administracija/emailovi` | Owner; prikazuje primjere bez slanja pošte. | `mail-examples`, `mail-preview`, `transactional-email` | Svi tipovi i jezici predloška, mobilni preview i linkovi primjera; ne slati stvarni email. |
| `/administracija/izgled` | Owner; actor i revision u server action, publish invalidira cache. | `visual-design-schema`, `appearance`; integracija `design-cases` | Svaka dozvoljena postavka, preview, nacrt, konflikt, odustajanje. Zabranjene kartice/meni ostaju netaknuti. |
| `/administracija/izgled/pregled` | Zaštićeni simulator stvarne aplikacije, ostaje odvojen od uklonjene javne demo aplikacije. | `visual-design-schema` | Svi viewporti i simulator ekrani, povratak bez neželjenih mutacija. |
| `/administracija/lokacije` | Owner; grupni prijedlog lokacija i revizije; adresa/provenance odvojene od potvrde. | `business-location`, `business-location-batch`, `geocoding` | Pripremi, pregledaj, odbaci/primijeni izolirani prijedlog, greška mreže i konflikt. |
| `/administracija/oglasi` | Owner za administraciju; ponude/kreative/odobrenje bankovne dopune imaju verzije i eksplicitne podatke. | `ad-*`, `bank-credit-topup`; integracija `bank-credit-topup`, `ad-campaign-cases` | Svaki status, filter, ponuda i uplata samo izolirano; ponovljena potvrda, isti izvod, greška mreže. |
| `/administracija/reels` | Owner, odobravanje/odbijanje i paginacija; pravo provjerava server. | `reels`; integracija `reels` | Preview medija, approve/reject, nestali zapis, dva klika i opozvane ovlasti. |
| `/administracija/uvoz-prijava` | Owner; parser i validacija fajla, plan prije upisa i kontrola duplih zapisa. | `business-import`, `directory-create-submission`; integracija `directory` | Validan/nevalidan upload, preview, izbor redova, prekid i ponovni pokušaj bez duplikata. |
| `/administracija/zahtjevi` | Owner; moderacija prijave i obrada brisanja. Zatvaranje se veže za prikazanog operatora i podnosi ponavljanje. | `support-action`; integracija `support-cases`, `account-erasure` | Svaka vrsta prijave, odgovor emailom, close/retry, zahtjev već obrađen, blokirano i uspješno izolirano brisanje. |

## Pod-ekrani naloga i administracije

Ove kontrole pripadaju gornjim rutama, ali svaki pod-ekran mora imati svoj browser prolaz. Za svakog primijeniti: učitavanje; prazno; ispravan rezultat; 401/403; 404 ili konflikt; spora/odbijena mreža; dupli klik; refresh/back i promjena naloga.

| Pod-ekran | Trag koda i obavezne kontrole |
| --- | --- |
| Nalog — pregled | `AccountOverview`, `BusinessToday`, `NextAppointmentCard`: otvori djelatnost, zadatak, sljedeći termin i postojeći paket. |
| Nalog — profil | `PersonalProfileWorkspace`: promijeni dozvoljena polja, foto/cover upload, obriši medij, javnost profila, pregled javnog profila. |
| Nalog — djelatnosti | `BusinessManager`: nova, izmjena, kategorija, adresa/mapa, mediji, detalji, predaja, povlačenje/uklanjanje, termini, inventar. Kartice iz javne pretrage nisu preuređivane. |
| Nalog — termini | `CustomerAppointments`, `OwnerCalendarPanel`, `BusinessBookingManager`, rentals/stays: odabir datuma/usluge/inventara, zahtjev/potvrda/otkaz/blokada/završetak. |
| Nalog — prijatelji | `ConnectionsPanel`: zahtjevi, prihvatanje, odbijanje, uklanjanje, profil. |
| Nalog — poruke | `MessagingInbox`: otvori osobu/djelatnost, pošalji, retry iste komande, čitanje, blokiranje, prijava i povratak. |
| Nalog — sačuvano | `SavedBusinesses`, `SavedSearchList`, blog sačuvano: otvori/ukloni i prazno stanje. |
| Nalog — postavke | `AccountSettings`, `AccountPassword`, `DevicePush`, `AdPreference`, `AudienceSettings`: tema, lozinka, dozvole, uključivanje/isključivanje pristanka i privatnost. |
| Nalog — paketi | `PackageCheckout`: vlastita djelatnost, postojeći ugovor, period, stanje i obnova prema važećem modelu. |
| Nalog — oglasi/krediti | `MarketingWorkspace`, `CreditBankTransfers`: ponuda, kreativni materijal, upute za uplatu, otkaz zahtjeva i historija. U Play izdanju provjeriti odsustvo zabranjene kupovine. |
| Administracija — danas | `AdminToday`: svi redovi vode na postojeći predmet i zadržavaju potrebni filter. |
| Administracija — odobrenja/nalozi | `AccountApprovals`: filter, paginacija, odobri/suspenduj; bez promjene administratorskog naloga preko običnog toka. |
| Administracija — pregled/djelatnosti/kategorije | `BusinessManager`, `BusinessChanges`, `CategoryManager`, `BusinessOwnershipManager`, `ProfileVerification`: moderacija, prijenos, verifikacija, kategorije i konflikti verzija. |
| Administracija — obračuni/naplata/transakcije | `BillingAdmin`, `PackageSettlements`: unesi potvrdu, korekciju i pregled historije. Nepoznati porezi/naknade ostaju prazni; produkcijske uplate nisu korištene u provjeri. |
| Administracija — recenzije | `ReviewsAdmin`: filtriranje, sakrij/vrati, vlastita/verzionirana promjena i opozvane ovlasti. |

## Uklonjeni javni ekrani

| Ranija ruta | Završna provjera |
| --- | --- |
| `/pregled` | Uklonjena javna demo početna i njeni lažni podaci; nakon objave očekivati 404. |
| `/pregled/pretraga` | Uklonjena javna demo pretraga; nakon objave očekivati 404. |
| `/pregled/djelatnost` | Uklonjen demo profil; nakon objave očekivati 404. |
| `/pregled/ljudi` | Uklonjeni lažni ljudi i demo veze; nakon objave očekivati 404. |
| `/pregled/prostor/[section]` | Uklonjen demo nalog i njegove simulirane transakcije; nakon objave očekivati 404 za sve sekcije. |
| `/pregled/instaliraj` | Uklonjena demo instalacija; nakon objave očekivati 404. Obična `/instaliraj` ostaje. |

## API i rubni slučajevi za CI/browser prijem

Svih 47 route-handler putanja su u inventuri. Za svaki privatni handler obavezni su gost, obični nalog, tuđi predmet, vlasnik predmeta i administrator. Za mutacije dodatno: pogrešan origin, neispravan sadržaj/veličina, zastarjela verzija, istekao nalog/sesija i ponovljena komanda. Javni handleri trebaju odbiti neobjavljen/uklonjen sadržaj, a ne otkriti privatna polja. Zasebno potvrditi:

- `/api/auth/**`: siguran povratni URL i generičke poruke za reset; rate limit i ingress provjere.
- `/api/directory/**`, business media/details/ownership: stvarna veza vlasništva, moderacija, normalizacija uploadova i historija prijenosa.
- `/api/booking/**`, rentals/stays: preklapanje, vremenske zone, promijenjena ponuda, retry komanda i prava obje strane.
- `/api/people/**`, connections, public-people, favorites, blocks i saved-searches: granica naloga, javnost, blokade i privatna lista.
- `/api/marketing/**`, checkout, billing, paketi, bank-topups: server iznos/valuta, vezivanje narudžbe, finalno stanje, idempotentnost i očuvana historija. Na Play originu dokazati 404/uskraćenu novu kupovinu gdje je propisano izdanjem.
- `/api/reels/**`: javni/privatni medij, byte-range/HEAD, ograničenje uploadova, like kao gost i kao član; nema dvostrukog kreditnog terećenja.
- `/api/push/**`: dozvola browsera, vezivanje uređaja za nalog i odjava/odvezivanje; stvarnu poruku testirati isključivo uz odobren testni nalog.
- Health, manifest, service worker, offline i `/.well-known/**`: status/Content-Type/cache, offline fallback, asocijacija ispravnim potpisom, izlazak iz aplikacije i Android back.

Odbijena ili spora mreža nije dokaz da upis nije izvršen. UI mora pročitati stvarno stanje ili ponoviti istu identifikovanu komandu prije stvaranja nove finansijske/rezervacijske namjere. Nijedna provjera ne smije ponoviti stvarnu uplatu radi testa.
