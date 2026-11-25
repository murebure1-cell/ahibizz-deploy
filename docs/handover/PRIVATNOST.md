# Privatnost, brisanje i Data safety

Stanje: 23. 11. 2026, grana `claude/play-internal-test`. Stranice `/privatnost` i `/brisanje-naloga` opisuju ono što kod stvarno radi. Ništa ovdje nije pravni savjet niti poslana Play deklaracija.

## Šta kod radi (dokazi)

| Podatak | Obavezno? | Gdje u kodu | Ko vidi / kome ide | Rok |
| --- | --- | --- | --- | --- |
| Ime, email, lozinka (hash) | Obavezno za nalog | Better Auth, `auth_user`, `auth_account` | Korisnik; ime prema vidljivosti | Do brisanja naloga |
| IP adresa i user agent sesije | Obavezno za prijavu | `auth_session` (`ipAddress`, `userAgent`) | Sigurnost prijave | Do odjave/isteka sesije; brisanje redova nakon isteka nije provjereno |
| Datum rođenja | Opcionalno, privatno | `personal_profile.birth_date`, editor ga označava „ne prikazuje se na profilu“ | Samo vlasnik | Do brisanja naloga |
| Profil: grad, država, opis, vještine, status, fotografije | Opcionalno | `personal_profile`, `personal_profile_image` | Prema vidljivosti profila | Do brisanja |
| Djelatnost: opis, kontakt, adresa, koordinate, radno vrijeme, fotografije | Opcionalno | `directory_business*` | Javno nakon objave | Do brisanja djelatnosti (sada briše i sadržaj, migracija 0056) |
| Reels: video i naslovnica | Opcionalno | `business_reel`, `business_reel_part` | Javno nakon odobrenja | Najviše 24 h od objave, zatim server briše bajtove (0055 + `expiry-worker`) |
| Poruke, prijave sadržaja, podrška | Opcionalno | `message_message`, `support_request` | Učesnici / moderatori | Do brisanja; kod brisanja naloga tekst poruke → „[Poruka obrisana]“ |
| Termini i podaci gostiju (ime, email, telefon) | Opcionalno | `booking_entry`, `rental_booking`, `stay_booking` | Gost i djelatnost | Prošli termini ostaju; kod brisanja naloga gosta ime/kontakt se uklanjaju |
| Lokacija uređaja | Opcionalno (dozvola) | `device-location.ts`, `home-nearby.ts` | Server prima koordinate zaokružene na 0,001° (~100 m) u upitu; ne upisuju se u bazu | Uređaj: ~1 km područje, najviše 24 h; serverski/hosting logovi: rok nepoznat |
| Adresa / tačka lokacije djelatnosti | Opcionalno | `geocoding.ts`, `LocationPicker.tsx` | Preglednik šalje direktno Photonu (photon.komoot.io); kod „moja lokacija“ i GPS koordinate | Kod pružaoca: nepoznato |
| Karte | Opcionalno | Google Maps (ako je `GOOGLE_MAPS_API_KEY`); bez ključa se karta ne prikazuje | Preglednik učitava pločice direktno (IP, područje) | Kod pružaoca |
| Push pretplata | Opcionalno | `push_device`, `push_delivery` | Push servis preglednika (Android: obično FCM) | Do odjave/isključenja |
| Email | Obavezno za nalog | SMTP konfiguracija | Pružalac email usluge | Kod pružaoca |

## Odluke Ajdina (24. 11. 2026) — ugrađene

- **Upravljač podataka**: Ajdin Tabaković, Tuzla, Bosna i Hercegovina (fizičko lice), kontakt email podrške. Navedeno na `/privatnost`.
- **Najmanja dob**: 18 godina. Navedeno na `/privatnost`; registracija traži potvrdu „Imam najmanje 18 godina“ uz pravila i privatnost. Play Target audience: 18+.
- **Rok za zahtjeve i brisanje**: najkasnije 30 dana. Navedeno na `/privatnost` i `/brisanje-naloga`.
- **Hosting**: OctaDeploy (aplikacija i baza). Javni DNS ahibizz.com vodi Octagon Solution.
- **Play host**: `app.ahibizz.com` (vidi `GOOGLE-PLAY.md`).

## Još otvoreno

1. **SMTP pružalac**: javni SPF za ahibizz.com dozvoljava samo vlastiti server `mail.ahibizz.com` (65.21.171.158). Potvrditi naziv `SMTP_HOST` u OctaDeployu (bez lozinke) i ko vodi taj mail server; zatim ga navesti na `/privatnost` umjesto „pružalac email usluge“.
2. **Pravni okvir**: na koji zakon se pozivamo (BiH ZZLP, GDPR za korisnike iz EU) i kome se podnosi prigovor (nadzorni organ).
3. **Rokovi**: evidencija uplata (zakonski rok), serverski/hosting logovi i rezervne kopije (OctaDeploy panel prikazuje „Čuva se 30 dana“ za backup aplikacije).
4. **Prenos djelatnosti pri brisanju naloga**: ko odobrava prenos vlasništva i šta treba od nove osobe.
5. **Pregled teksta**: Ajdin ili pravnik čita `/privatnost` i `/brisanje-naloga` prije unosa URL-ova u Play Console.

## Data safety radni popis (prema kodu)

- Prikuplja se: ime, email, korisnički ID (Personal info); fotografije i video (Photos and videos, opcionalno); poruke (Messages, opcionalno); precizna lokacija (Location, opcionalno, obrada za funkcionalnost); aktivnost u aplikaciji (favoriti, pretrage, sviđanja); identifikatori uređaja/sesije za sigurnost i push.
- Dijeljenje: prenos Photonu i kartama radi korisnik svjesno kod uređivanja lokacije/gledanja karte; provjeriti da li to Play smatra „dijeljenjem“ ili izuzetkom za obrađivača. Hosting, SMTP i push su obrađivači.
- Šifrovanje u prenosu: tvrditi samo nakon provjere HTTPS-a na finalnom Play hostu.
- Brisanje: korisnik može zatražiti brisanje u aplikaciji (Postavke → Brisanje naloga) i bez aplikacije na `/brisanje-naloga` ili emailom; djelatnost i Reel briše sam.
- Kupovine: Play izdanje nema kupovina; ne deklarisati podatke o plaćanju za Play.
