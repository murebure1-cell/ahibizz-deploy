# Radno vrijeme i sadržaji

Vlasnik ili administrator otvara **Moje djelatnosti → Uredi → Radno vrijeme i sadržaji**. Osnovni obrazac prvo treba sačuvati ako ima neposlanih izmjena. Novi profil nema radno vrijeme niti pogodnosti. Izbor vremenske zone u obrascu je samo lokalni nacrt do čuvanja.

- Isključeno radno vrijeme znači nepoznato i ne pojavljuje se na javnom profilu/kartici. Uključivanjem se unosi cijela sedmica; dan bez intervala je izričito zatvoren.
- Do četiri vremenska intervala dnevno, bez preklapanja. Rad preko ponoći se unosi u oba dana: npr. nedjelja 22:00–24:00 i ponedjeljak 00:00–02:00.
- Radno vrijeme i booking su nezavisni. Ovo ne stvara termine, cijene ili rezervacije i ne mijenja postojeći booking raspored.
- Pogodnosti su isključivo označene činjenice: Wi-Fi, parking, pristupačan ulaz, kućni ljubimci, kartično plaćanje i pogodnost za porodice. Ne označavaju verifikaciju ili certifikaciju.

Migracija `0011_business_details.sql` dodaje jednu opcionu `directory_business_details` vrstu po djelatnosti, sa IANA vremenskom zonom, JSON sedmicom, stabilnim identifikatorima pogodnosti i posljednjom verzijom osnovne djelatnosti. DB nezavisno provjerava oblik, nepreklapanje, katalog i vezu verzija. Ne popunjava postojeće djelatnosti.

`GET/PUT /api/business-details/mine/:businessID` koristi potpisanu sesiju, odobren/potvrđen nalog, njegovu stvarnu ulogu i vlasništvo te `X-AhiBizz-Account-ID`. PUT zahtijeva JSON i isti Origin; GET isti Origin ili preglednikov `Sec-Fetch-Site: same-origin`. Tijelo je najviše 16 KiB. Odgovori se ne keširaju.

PUT koristi `expectedVersion` osnovne djelatnosti. Iste postojeće zaključane korisničke/sesijske/poslovne vrste i transakcija mijenjaju verziju i metapodatke zajedno. Članova izmjena objavljene djelatnosti vraća je na pregled; administratorova ostaje objavljena uz postojeći moderation audit. Arhivirana djelatnost se ne uređuje. Greška sidecara poništava osnovnu izmjenu. Poslije neizvjesnog odgovora ili sukoba verzija interfejs zahtijeva ponovno učitavanje, bez slijepog ponavljanja PUT-a.

Javni DTO uključuje podatke u postojećem upitu; nema dodatnog API poziva po kartici. Vidljivost prati postojeće objavljivanje i potvrđen/odobren nalog vlasnika. Kartica prikazuje samo poznat status i unesene pogodnosti. Profil prikazuje cijelu unesenu sedmicu. Trenutni status je lokalno računanje stvarnog trenutka u vremenskoj zoni djelatnosti, sa pravilima ljetnog računanja vremena; interval uključuje početak i isključuje kraj. Nema statusa kada radno vrijeme nije poznato.

Provjere su odvojene:

- `tests/business-details.test.ts`: validacija, granice/pauze, DST, ponoć, HTTP/actor/origin i ograničenja klijenta.
- `tests/integration/business-details.test.mjs`: zasebna loopback CI baza/uloga `ahibizz_ci`, nasumična schema; prava potpisana prijava, moderacija, CAS utrka, neovisni DB guardovi, rollback i opoziv ovlasti/sesije. Pokretanje zahtijeva izričitu izoliranu CI konfiguraciju. Vanjski mrežni pozivi i stvarni emailovi su zabranjeni.
- `scripts/verify-business-details-ui.mjs`: stvarne UI komponente na `127.0.0.1:4464`, memorijski podaci, mrežni API blokiran. Posebne kontrole probaju izgubljeni odgovor, paralelnu izmjenu i dvostruko slanje. Ova proba nije dokaz stvarne poslovne transakcije.
