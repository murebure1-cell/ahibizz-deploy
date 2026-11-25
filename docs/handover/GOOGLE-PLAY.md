# Android i Google Play

Stanje pregleda: 22. 11. 2026. Put je **Trusted Web Activity (TWA) kroz Bubblewrap**, oko posebnog web builda. Repo još nema generisan Android projekat, potpisani APK/AAB, potvrđenu Play domenu ni produkcijski potpis. Ovaj dokument priprema predaju; ne potvrđuje da je aplikacija objavljena ili da je Google odobrio aplikaciju.

## Šta već postoji

| Dio | Izvor i ponašanje |
| --- | --- |
| Android identitet | `src/lib/android-association.ts`: `com.ahibizz.app`; `.qa` se prepoznaje samo kao probno pokretanje, a nije objavljeni paket u assetlinks odgovoru. |
| Play build | `next.config.ts` čita `AHIBIZZ_DISTRIBUTION=google-play` i ugrađuje `NEXT_PUBLIC_AHIBIZZ_DISTRIBUTION`; `src/lib/distribution.ts` izvozi `IS_PLAY_EDITION`. Vrijednost je zamrznuta tokom builda. |
| Manifest | `public/app.webmanifest`: AhiBizz, `id=/`, `start_url=/?source=pwa`, `scope=/`, `standalone`, bosanski jezik, tema `#0b0d10`, pozadina `#f2f4f6`, PNG 192/512 i maskable 512 u `public/app-icons/`. Ikone su prenesene iz bivšeg preview foldera bez promjene slike. |
| PWA | `src/components/pwa/AppPwa.tsx` registruje `/sw.js` na `/`; prepoznaje instalirani prikaz i Android referrer. Referrer je samo pomoć za izgled, nije ovlaštenje. |
| Offline | `public/sw.js` i `public/app-offline.html`: mreža za navigaciju; pri prekidu veze neutralna poruka, bez podataka prethodnog naloga. API, RSC i korisnički mediji se ne pohranjuju u offline cache. Cache v2 zamjenjuje stare app/preview cacheove. |
| Veza domene i aplikacije | `src/app/.well-known/assetlinks.json/route.ts`: u Play buildu objavljuje samo valjani `AHIBIZZ_PLAY_SIGNING_SHA256`. Bez potpisa vraća 404; placeholder se ne predstavlja kao valjano povezivanje. |
| Oznaka distribucije | `/.well-known/ahibizz-distribution.json` vraća `google-play` ili `web`, bez podataka o nalogu. |
| Privatnost i brisanje | `/privatnost` i `/brisanje-naloga` su javne stranice. Prijavljeni korisnik može poslati zahtjev u aplikaciji; dostupan je i email `podrska@ahibizz.com` bez ponovne instalacije. Stvarni pristup bez prijave kroz hosting i ingress tek treba potvrditi u browseru. |

## Stanje za interni test (23. 11. 2026, grana `claude/play-internal-test`)

| Provjera | Rezultat |
| --- | --- |
| Play web build (`AHIBIZZ_DISTRIBUTION=google-play pnpm build`) | Prolazi lokalno. Pokrenut bez baze na `127.0.0.1`: `/privatnost`, `/brisanje-naloga`, `/reels` 200; `/istakni`, `/paketi`, `/podrzi`, `/nalog/isticanja`, `/api/checkout/orders` 404; `ahibizz-distribution.json` = `google-play`; stranica privatnosti u Play izdanju ne spominje web uplatu. |
| `assetlinks.json` u Play buildu | Sa postavljenim `AHIBIZZ_PLAY_SIGNING_SHA256` vraća 200, paket `com.ahibizz.app`, relaciju `handle_all_urls`. Provjereno samo s izmišljenim testnim otiskom; stvarni otisak još ne postoji. |
| Trenutni javni host `ahibizz-deploy.octadeploy.com` | Web build: privatnost i brisanje 200 bez prijave; `assetlinks.json` 404; distribucija `web`. Nije Play host. |
| Android projekat, AAB, potpis, instalacija | Nije urađeno: na ovom računaru nema JDK-a ni Android SDK-a. Ništa nije poslano u Play Console. |

### Play servis `app.ahibizz.com` (odluka 24. 11. 2026)

Play build ima vlastiti servis na istoj bazi; web `ahibizz-deploy` (app 213) ostaje nepromijenjen. Svaki korak u OctaDeployu i DNS-u radi se tek uz Ajdinovu potvrdu.

1. U OctaDeployu nova aplikacija (npr. `ahibizz-play`) iz istog repozitorija `murebure1-cell/ahibizz-deploy`, grana `main`, Next.js.
2. Varijable: iste kao app 213 (ista `DATABASE_URL`, SMTP, ključevi), uz razlike:
   - `AHIBIZZ_DISTRIBUTION=google-play` (mora biti dostupna i pri buildu),
   - `BETTER_AUTH_URL=https://app.ahibizz.com`,
   - `AHIBIZZ_PLAY_SIGNING_SHA256=<SHA-256 App signing ključa iz Play Consolea>` (kad postoji).
3. DNS kod Octagon Solution (`dns1/dns2.octagonsolution.com`): zapis za `app.ahibizz.com` prema OctaDeploy serveru (trenutno `178.105.125.128`, isti kao `ahibizz-deploy.octadeploy.com`), zatim domena i TLS u OctaDeployu. Postojeći `ahibizz.com` (stara aplikacija i mail na `65.21.171.158`) se ne mijenja.
4. Oba servisa rade migracije pri startu i pozadinske poslove; reels istek, push i approval emailovi uzimaju posao uz `SKIP LOCKED`, pa nema dvostrukog slanja. Approval email poslan s Play servisa vodi na `app.ahibizz.com/prijava`.
5. Provjera nakon pokretanja: `https://app.ahibizz.com/.well-known/ahibizz-distribution.json` = `google-play`, `/privatnost` i `/brisanje-naloga` 200 bez prijave, kupovne stranice 404, `assetlinks.json` 200 s pravim otiskom.

### Šta tačno treba za potpisani AAB i interni test

1. **Finalni Play host** (HTTPS) sa zasebnim Play buildom. Zamijeniti `PLAY_HOST` u `docs/handover/android/twa-manifest.example.json`.
2. **Play Console nalog** i aplikacija `com.ahibizz.app`, uključen Play App Signing.
3. **Upload ključ** (keystore) napravljen i sačuvan izvan Gita, s imenovanom odgovornom osobom.
4. **Build računar** (24. 11. 2026. postavljen na Ajdinovom računaru, izvan repozitorija): `AhiBizzNext\tools\android` s Temurin JDK 17.0.21, Android cmdline-tools 23, platformom **android-36**, build-tools 36.1.0 i platform-tools; licencu Android SDK-a prihvatio je Ajdin.
5. Projekat se pravi neinteraktivno skriptom `docs/handover/android/generate-twa.mjs` (`@bubblewrap/core` 1.24.1, paket `com.ahibizz.app`, host `app.ahibizz.com`) u `AhiBizzNext\android-twa`. Alat postavlja `targetSdkVersion 35`; u `app/build.gradle` se postavlja **`targetSdkVersion 36`** (`compileSdkVersion 36` već jeste). Provjeriti trenutni [target API zahtjev](https://support.google.com/googleplay/android-developer/answer/11926878).
6. `gradlew bundleRelease` daje nepotpisani AAB; potpisati ga upload ključem (`jarsigner` ili signingConfig iz `twa-manifest.json`), upload na **Internal testing**, pa iz Play Consolea uzeti SHA-256 **App signing** ključa i postaviti ga u `AHIBIZZ_PLAY_SIGNING_SHA256` na Play hostu. `gradlew assembleDebug` daje probni APK potpisan debug ključem: dobar za instalaciju, ali bez TWA verifikacije (prikazaće browser traku dok assetlinks ne sadrži i debug otisak).
7. Instalirati iz internog testa na fizički Android i proći tabelu „Provjera na uređaju“ ispod. Tek tada je izdanje provjereno.

## Izdanje bez kupovine

Konačna odluka vlasnika od 22. 11. 2026: Play izdanje ne nudi kupovinu, cijene, bankovne upute ni linkove na web kupovinu. Donacije ostaju skrivene. Istaknute djelatnosti i fiksni baner prikazuju se normalno. Direktno otvaranje nedostupne stranice daje kratku poruku i povratak; API za kreiranje narudžbe vraća 404.

## Od izvornog koda do AAB-a

Ove korake obavlja imenovani izdavač nakon odobrenja. Tokom ove predaje nije pokrenut deploy, Android build, registracija ni slanje u Play Console.

1. Odabrati vlasnika Play Console naloga, potvrditi naziv pravnog lica/osobe i pristupe timu. Potvrditi trajni paket `com.ahibizz.app`, zemlje distribucije i izdanje bez kupovine. Paket ne mijenjati nakon prve objave.
2. Izabrati trajni HTTPS origin za **Play build**. Web i Play imaju različito ugrađene mogućnosti: isti build se ne smije prebacivati između njih samo runtime varijablom. Na izabranoj domeni potvrditi kanonski origin, TLS, pristup pravilima privatnosti i brisanju bez prijave. Aplikacija i njeni API-ji moraju koristiti isti origin; ne uvoditi preusmjeravanje nazad na web kupovinu.
3. Na Node 24 i pnpm 12.18.0 pokrenuti `pnpm install --frozen-lockfile`, `pnpm check` i CI integracijske testove sa izoliranom PostgreSQL bazom. Zabilježiti commit i rezultat. Sandbox `spawn EPERM` nije prolazan test.
4. Napraviti zaseban Play build. Primjer za PowerShell, uz vraćanje ranije vrijednosti varijable:

   ```powershell
   $previousDistribution = $env:AHIBIZZ_DISTRIBUTION
   try {
     $env:AHIBIZZ_DISTRIBUTION = 'google-play'
     pnpm build
   } finally {
     $env:AHIBIZZ_DISTRIBUTION = $previousDistribution
   }
   ```

   CI od 23. 11. 2026. na svakom pushu gradi Play izdanje i pada ako bilo koja kupovna stranica (`/istakni`, `/nalog/isticanja`, `/paketi`, `/oglasavanje`, `/naplata`, `/podrzi`) nije preusmjerena na `/store-unavailable`.

   Docker put: `docker build --build-arg AHIBIZZ_DISTRIBUTION=google-play --tag ahibizz:play .`. Lokalni Play build koristi zaseban radni/build folder kako `.next` ne bi zamijenio web build. Deploy ostaje `integration/ahibizz → ahibizz-deploy → OctaDeploy app 213`; domena i zaseban Play servis traže potvrdu vlasnika. Prije autorizovanog deploya napraviti svjež backup i potvrditi odabrani commit.
5. Na pripremljenoj domeni provjeriti `/.well-known/ahibizz-distribution.json` (`google-play`), manifest, PNG ikone, `/sw.js`, `/privatnost`, `/brisanje-naloga` i sve kupovne zabrane. Običan web build sa skrivenim menijem nije Play build.
6. U posebnom Android folderu, izvan aplikacijskog izvornog koda, instalirati pregledanu i zapisanu verziju `@bubblewrap/cli`. Bubblewrap treba JDK i Android SDK; instalaciju radi tim na svom build računaru. Ne instalirati PostgreSQL/Docker samo zbog omotača.
7. Pokrenuti `bubblewrap init --manifest https://<PLAY_HOST>/app.webmanifest`. Potvrditi naziv AhiBizz, paket, HTTPS host i početni URL. U generisanom `twa-manifest.json` pregledati verziju, ikone, `display`, theme/background i target SDK. Prema trenutno objavljenom zahtjevu novi mobilni build treba Android 16 / API 36 ili više; prije predaje ponovo provjeriti [target API zahtjev](https://support.google.com/googleplay/android-developer/answer/11926878).
8. Postaviti potpisivanje i uključiti Play App Signing. Keystore, lozinke, upload ključ, service-account JSON i privatne certifikate čuvati izvan Gita i izvan javnih exporta. Sačuvati oporavak pristupa i imenovati odgovornu osobu.
9. U Play Console uzeti **SHA-256 certifikata App signing key**, ne samo upload ključa. Na Play serveru postaviti javni fingerprint u `AHIBIZZ_PLAY_SIGNING_SHA256` kroz odobrenu konfiguraciju. Više valjanih potpisa podržano je kao lista odvojena zarezom. Predložak je `assetlinks.example.json` u ovom folderu; zamijeniti njegov placeholder stvarnim javnim fingerprintom. U aplikaciji se odgovor generiše rutom, pa ne praviti drugi konkurentski javni `assetlinks.json`.
10. Provjeriti `https://<PLAY_HOST>/.well-known/assetlinks.json`: status 200 bez prijave/preusmjeravanja, `application/json`, ispravan paket, relacija `delegate_permission/common.handle_all_urls` i stvarni potpis. Za lokalno potpisani probni APK njegov potpis mora takođe biti povezan ili koristiti zaseban probni host/paket. Dokumentacija: [TWA i Digital Asset Links](https://developer.chrome.com/docs/android/trusted-web-activity/quick-start).
11. Pokrenuti `bubblewrap build`. Sačuvati izlazne `app-release-signed.apk` i `app-release-bundle.aab` izvan Gita, uz hash i commit web builda. Provjeriti stvarne nazive u korištenoj verziji alata. Opis alata i izlaza: [Bubblewrap CLI](https://github.com/GoogleChromeLabs/bubblewrap/tree/main/packages/cli).
12. Instalirati APK na fizički Android za osnovnu provjeru. Nakon uploada AAB-a ponoviti instalaciju iz internog Play testa: taj build koristi Play potpis i stvarno provjerava povezivanje domene. Pojava browser trake znači da TWA povezivanje treba ispraviti, a ne sakriti.
13. Popuniti Play Console stavke ispod, pokrenuti pre-launch report, riješiti nalaze i dostaviti podatke za pristup pregledniku aplikacije. Za lične naloge koji potpadaju pod pravilo novih naloga sada se traži najmanje 12 testera neprekidno 14 dana u zatvorenom testu; potvrditi zahtjev konkretnog naloga u [pravilu testiranja](https://support.google.com/googleplay/android-developer/answer/14151465).
14. Tek nakon pregledanih nalaza zatražiti produkcijski pristup/objavu. Sačuvati odobreni AAB, verziju, potpis, commit, backup i ko je objavio. Nakon objave provjeriti instalaciju iz Playa, prijavu i povratak u aplikaciju.

## Data safety: odgovori zasnovani na kodu

Ovo je radni popis za vlasnika koji popunjava formular, ne već poslata deklaracija. Provjeriti stvarni Play build i konfiguraciju servera. Podaci poslani serveru jesu obrada podataka i kada se koriste kroz TWA; ne označavati cijelu aplikaciju kao aplikaciju bez prikupljanja. Definicije prikupljanja, dijeljenja i izuzetaka za obrađivače: [Data safety](https://support.google.com/googleplay/android-developer/answer/10787469).

| Podatak / predložena kategorija | Nalaz u kodu | Namjena i izbor |
| --- | --- | --- |
| Ime, email, korisnički identifikator | `auth_user`, Better Auth, `src/server/auth`; profil, podrška i pristup nalogu | Upravljanje nalogom i funkcionalnost; potrebni za prijavljene tokove. Pregled imenika postoji i bez naloga. |
| Telefon, adresa i dodatni podaci profila/djelatnosti | `personal_profile`, `directory_business`, `directory_business_details` | Opcionalan korisnički sadržaj; dio je javnog profila prema vidljivosti. Provjeriti kategorije Personal info u formularu. |
| Precizna lokacija | `DeviceLocation`, `device-location`, `geocoding`, pretraga imenika | Opcionalna dozvola; koordinate putuju upitom za blizinu i mogu se koristiti za Photon obrnuto geokodiranje. Ne tvrditi da lokacija ostaje isključivo na uređaju. Tačan period zadržavanja logova nije utvrđen iz koda. |
| Fotografije, video i korisnički sadržaj | `src/server/people/media.ts`, `business-media`, opisi, recenzije, `api/reels` | Opcionalno uređivanje profila/djelatnosti; javna objava prema vidljivosti/moderaciji. Reels se objavljuju i iz Play izdanja (upload, pregled moderatora, objava). Objavljeni Reel je vidljiv najviše 24 sata; server ga zatim označi kao istekao i obriše video i naslovnicu (`expireReels`, migracija 0055), bez obzira da li iko otvori aplikaciju. Video se prikuplja: deklarisati ga u Data safety. |
| Poruke, podrška i prijave sadržaja | `message_message`, `support_request` | Korisnička komunikacija, podrška i sigurnost; povezano s nalogom. Nisu SMS ni pristup imeniku telefona. |
| Termini i podaci rezervacije | `booking_entry`, `rental_booking`, `stay_booking` | Opcionalno korištenje rezervacija; podatke vide učesnici i ovlaštena djelatnost. |
| Kupovine | Play izdanje ne prikuplja podatke za nove kupovine niti podatke kartice. Arhivski zapisi ranije naplate ostaju u bazi i aplikacijski kod ih ne koristi. | Formular se popunjava prema stvarnom Play buildu i obradi podataka. |
| Aktivnost u aplikaciji | Sačuvane pretrage, favoriti, veze/blokade, reakcije na reels, prihvatanje pravila | Funkcionalnost i sigurnost; zapisano uz nalog. Mjerenje oglasne publike je uklonjeno. |
| IP, user agent i uređaj za push | `auth_session` (`ipAddress`, `userAgent`), `push_device`, `push_delivery` | Sigurnost sesije i opcionalne obavijesti; push identitet povezan s nalogom/sesijom. Ne koristiti oglasni ID. Hosting logove dodatno provjerava tim. |
| Lokalni podaci | Tema, dozvola lokacije, neposlane poruke i oznake pokušaja | Lokalno pamćenje samo po sebi nije slanje serveru. Sačuvana postavka naloga i poslata poruka jesu serverski podaci. SW ne čuva privatne stranice/API odgovore. |

Vanjski primaoci u kodu su pružalac hostinga/baze, SMTP za email, browser push servis (npr. FCM), Photon za adrese, Google Maps za karte kad je postavljen `GOOGLE_MAPS_API_KEY` (inače OpenStreetMap). Uređaj lokalno pamti samo približno područje (~1 km, najviše 24 sata) radi brzog prikaza djelatnosti u blizini; briše se pri isključenju lokacije i odjavi. Povezivanje javnog profila ili slanje poruke takođe otkriva odabrane podatke drugim korisnicima. Da li neki prenos spada u izuzetak za obrađivača ili svjesnu korisničku radnju treba potvrditi prema stvarnom ugovoru i konfiguraciji; ne označavati automatski „nema dijeljenja“.

TLS u produkciji, zadržavanje backupova/logova, stvarni SMTP/hosting obrađivači i rokovi brisanja nisu dokazani lokalnim pregledom. Za tvrdnju „šifrovano u prenosu“ izdavač mora potvrditi HTTPS i serverske veze. Kamera i mikrofon su zatvoreni web Permissions-Policy zaglavljem; upload izabranog fajla nije dokaz pristupa svim fotografijama uređaja.

## Privatnost, brisanje, sadržaj i pristup za pregled

- U Store listing upisati javne HTTPS URL-ove `/privatnost` i `/brisanje-naloga` na potvrđenom Play originu. Stranice moraju raditi izvan naloga i aplikacije. Izvor: [priprema aplikacije za pregled](https://support.google.com/googleplay/android-developer/answer/9859455).
- Brisanje se pokreće iz Postavki ili javne stranice i obrađuje ovlaštena podrška. `src/server/account-erasure.ts` odbija neriješene rezervacije, aktivne/pripadajuće uplate i neprenesene djelatnosti. `erase_account_content` briše/rediguje sadržaj, a anonimizirani identitet i zakonske finansijske evidencije ostaju. Vlasnik treba odrediti i javno navesti razumni rok obrade, kontakt pravnog upravljača i rokove zakonskog zadržavanja. Ne obećavati trenutni potpuni nestanak svih zapisa. Izvor za dostupnost zahtjeva unutar i izvan aplikacije: [brisanje naloga](https://support.google.com/googleplay/android-developer/answer/13327111).
- App content / Content rating: prijaviti korisničke profile, fotografije, tekstove, reels, recenzije i poruke među korisnicima. Postoje prijava sadržaja, blokiranje, moderacija i pravila zajednice. Ne izabrati „nema korisničkog sadržaja“ niti izmišljati dobnu ocjenu: odgovoriti IARC formularom prema stvarnim mogućnostima.
- Oglasi: istaknute djelatnosti i fiksni baner su komercijalni prikaz. Formular odgovara stvarnom Play buildu; sistem mjerenja publike je uklonjen.
- U App access dostaviti poseban **odobren i email-potvrđen** pregledni nalog s važećom lozinkom i stabilnim podacima. Podatke dostaviti samo sigurnim Play Console poljem, nikada u Git/dokument. Pripremiti vlastitu probnu djelatnost ako pregled vlasničkih ekrana to zahtijeva; ne dati administratora nad živim korisničkim podacima. Navesti gostujući pristup, prijavu, odjeljke naloga, profile, rezervacije, prijavu sadržaja, blokiranje i zahtjev za brisanje; objasniti odsustvo kupovine u Play izdanju.

## Provjera na uređaju prije predaje

| Provjera | Očekivanje / dokaz koji tim zapisuje |
| --- | --- |
| Hladno pokretanje i deep link | Pokreće Play origin, bez browser trake; duboki link otvara postojeći ekran. |
| Nazad | Android Back vraća prethodni ekran/navigacijsko stanje; zatvoreni modal ne napušta aplikaciju. Na početnoj se aplikacija može zatvoriti. Ponoviti za auth povratak, rezervaciju, poruke, kalendar i reels. Web kod ne uvodi opšti presretač Android Back dugmeta. |
| Offline i povrat mreže | Poslije online instalacije prekid veze prikazuje neutralnu stranicu; „Pokušaj ponovo“ otvara početnu. Privatni sadržaj prethodnog naloga nije u cacheu. |
| Dozvole | Odbijena lokacija/push ne sprečava osnovni pregled. Prvi zahtjev proizlazi iz korisničkog izbora, a promjena dozvole u Android postavkama se odrazi u aplikaciji. |
| Vanjski linkovi | Interna navigacija ostaje na originu; telefon/email/mapa/korisnička web stranica otvaraju predviđenu aplikaciju/browser. Ne dodavati vanjsku kupovinu. |
| Promjena naloga | Odjava uklanja pristup privatnim podacima; povratak, offline i ponovna prijava drugog korisnika ne pokažu prethodni sadržaj. |
| Kupovne zabrane | Provjeriti ručno unesene `/istakni`, `/paketi`, `/oglasavanje`, `/podrzi` i njihove API-je, pomoć i direktne query linkove u nalog. Nema kupovne forme ni poziva na vanjsko plaćanje. |
| Javne informacije | Privatnost i brisanje rade bez prijave i poslije deinstalacije; tim prima i može obraditi zahtjev. |

Lokalno su pokrenuti `tsc --noEmit`, PWA testovi (14/14) direktno Nodeom i testovi pomoći, Android povezivanja i Play ponašanja (11/11) pomoću privremenog Node loadera koji transformiše TypeScript bez subprocessa. To nisu standardni `pnpm test` ni Android/browser testovi. PWA test provjerava dimenzije PNG ikona i izolaciju cachea; maskable slika je dodatno vizuelno pregledana.

Stvarni Android uređaj, Bubblewrap build, potpis, Play instalacija, browser klikovi i poslovne transakcije nisu provjereni u ovom lokalnom radu. Konačni status lokalnih testova vodi se u `PROVJERA.md`; bez ovih završnih dokaza ne označavati izdanje spremnim za objavu.
