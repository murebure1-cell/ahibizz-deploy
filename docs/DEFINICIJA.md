# AhiBizz — definicija aplikacije

Stanje na 25. 11. 2026. Ovaj dokument kaže gdje šta živi, kako se dijelovi spajaju i kako se
aplikacija ponaša. Svaka nova izmjena mora se uklopiti u njega; ako ne može, prvo se mijenja ovaj
dokument, pa tek onda kod.

Oznake: **[važi]** je već tako u kodu, **[cilj]** je dogovoreno ali još nije izgrađeno.

## 1. Šta je AhiBizz

Imenik djelatnosti s ljudima iza njih: posjetilac traži uslugu, vidi djelatnost, piše joj ili
zakazuje termin. Vlasnik djelatnosti uređuje svoj profil, odgovara na poruke i vodi termine.
Vlasnik platforme odobrava naloge i sadržaj.

Četiri lica iste aplikacije:

| Lice | Ko ga koristi | Adresa |
|---|---|---|
| Javno | svako | `ahibizz.com` **[važi od 25. 11. 2026.]** |
| Nalog | prijavljeni član | `ahibizz.com/nalog` |
| Administracija | vlasnik platforme | `admin.ahibizz.com` **[cilj]**, danas `/administracija` |
| CMS | vlasnik platforme, kasnije urednik | `cms.ahibizz.com` **[cilj]**, danas dio `/administracija` |

## 2. Adrese i šta gdje ide

Jedna aplikacija, jedna baza, tri adrese. Adresa određuje koje se stranice smiju otvoriti; prijava
je zajednička.

**`ahibizz.com` — javno i nalog [važi]**

- Početna `/`, pretraga `/pretraga`, djelatnost `/djelatnosti/[id]`, ljudi `/ljudi`, karta `/mapa`,
  Reels `/reels`, blog `/blog`, pomoć `/pomoc`.
- Prijava `/prijava`, registracija `/registracija`, lozinka `/zaboravljena-lozinka`, `/nova-lozinka`.
- Nalog `/nalog` s odjeljcima: profil, djelatnosti, poruke, termini, sačuvano, postavke;
  `/nalog/obavijesti`, `/nalog/reels`.
- Pravne i pomoćne: `/o-nama`, `/privatnost`, `/pravila-zajednice`, `/prijavi-sadrzaj`,
  `/brisanje-naloga`, `/instaliraj`, `/podrzi`.

**`admin.ahibizz.com` — rad s ljudima i djelatnostima [cilj]**

- Danas (šta čeka odluku), odobrenja naloga, pregled djelatnosti prije objave, nalozi,
  djelatnosti, recenzije, zahtjevi i prijave, moderacija Reelsa, verifikacija profila,
  poslani emailovi, uvoz prijava, lokacije.

**`cms.ahibizz.com` — sadržaj koji vidi posjetilac [cilj]**

- Članci bloga, izgled početne, kategorije djelatnosti, tekstovi centra za pomoć.

Pravila za adrese **[cilj]**:

1. Stranice administracije i CMS-a ne otvaraju se na `ahibizz.com`; stara putanja
   `/administracija` preusmjerava na odgovarajuću adresu.
2. Javne stranice ne otvaraju se na `admin.` i `cms.`; te adrese nisu u pretraživačima.
3. Kolačić prijave važi za sve tri adrese, ali svaka stranica i svaka radnja i dalje sama
   provjerava ulogu na serveru. Adresa nikad ne daje pravo.

## 3. Gdje šta ide u kodu [važi]

| Mjesto | Šta tu živi | Šta tu ne smije |
|---|---|---|
| `src/app` | stranice i API rute; samo spajaju | pravila, SQL |
| `src/components` | ono što se vidi i klika | pristup bazi, tajne |
| `src/lib` | čista logika koju dijele server i preglednik: putanje, formati, prevodi | pristup bazi, mreža |
| `src/server` | pravila, provjera prava, SQL, email, push | React, CSS |
| `db/migrations` | numerisane izmjene baze | izmjena već primijenjene migracije |
| `tests` | provjere; `tests/integration` s pravim Postgresom | živa baza, pravi email |
| `scripts` | pokretanje, migracije, provjere izdanja | poslovna pravila |
| `docs` | odluke i uputstva | tajne, IBAN |

Lanac jednog zahtjeva je uvijek isti: **stranica ili API ruta → servis u `src/server` → baza**.
Stranica nikad ne piše SQL. Servis nikad ne vjeruje podatku iz preglednika: ulogu i vlasništvo čita
iz baze u istoj transakciji u kojoj mijenja podatke.

Nova cjelina dobija isti raspored: `src/lib/<ime>.ts` (tipovi i putanje),
`src/server/<ime>/service.ts` (pravila), `src/server/<ime>-http.ts` (ulaz i izlaz),
`src/app/api/<ime>/route.ts` (spoj), `src/components/<ime>/` (prikaz), `tests/<ime>.test.ts` i
`tests/integration/<ime>.test.mjs`.

## 4. Ko šta smije [važi]

| Uloga | Kako nastaje | Šta smije |
|---|---|---|
| Gost | bez prijave | gleda javno |
| Član na čekanju | registracija i potvrđen email | ništa dok ga vlasnik ne odobri |
| Član | vlasnik platforme ga odobri | profil, djelatnosti, poruke, termini, recenzije |
| Vlasnik platforme | postavlja se pri pokretanju | sve iz administracije i CMS-a |

- Svaki nalog, i onaj preko Googlea, čeka ručno odobrenje.
- Djelatnost ide: nacrt → na pregledu → objavljena. Izmjena objavljene djelatnosti opet ide na
  pregled; dok čeka, vidi se stara verzija.
- Paket ili plaćanje nikad ne daje značku provjerenog identiteta ni Halal značku.

## 5. Kako se spaja

- **Prijava:** better-auth, sesija u bazi, kolačić. Email i lozinka ili Google. Ograničenje pokušaja
  po adresi i po emailu.
- **Poruke i obavijesti:** poruka ili promjena termina upisuje red u aktivnosti naloga; pozadinski
  posao iz toga šalje push. Email ide samo za potvrdu adrese, lozinku i odobrenje naloga.
- **Slike i video:** u bazi, smanjeni pri uploadu. Javne slike preglednik čuva 30 dana jer adresa
  nosi verziju. Reel traje 24 sata i onda se briše.
- **Pozadinski poslovi:** push, istek Reelsa i email odobrenja rade u istom procesu kao stranice.
  Zato aplikacija radi kao jedna kopija dok se ovo ne razdvoji.
- **Jezici:** bosanski je izvor; engleski, njemački, arapski (zdesna nalijevo) i turski su prevodi u
  `src/lib/i18n`. Svaki tekst postoji na jednom mjestu sa sva četiri prevoda.

## 6. Kako reaguje

- **Klik:** odmah traka napretka na vrhu; stranica otvorena u zadnjih 30 sekundi vraća se bez
  čekanja.
- **Čekanje:** kostur liste samo na pretrazi i Reelsima; drugdje traka.
- **Prazno:** rečenica šta ovdje ide i jedno dugme za sljedeći korak.
- **Greška:** kratka poruka na jeziku korisnika i šta može uraditi. Server nikad ne vraća detalje
  baze ni interne poruke.
- **Bez prava:** gost ide na prijavu i poslije nje nazad gdje je krenuo; član bez prava ide na
  svoj nalog.
- **Upis:** svaka izmjena nosi verziju koju je korisnik vidio. Ako je neko drugi u međuvremenu
  mijenjao, upis se odbija i traži osvježenje, umjesto da pregazi tuđu izmjenu.

## 7. Podaci

- Jedna PostgreSQL baza. Izmjene samo kroz numerisane migracije.
- Finansijski zapisi, potvrde o brisanju naloga i historija odluka ne mogu se mijenjati ni brisati
  iz aplikacije.
- Brisanje naloga na zahtjev anonimizira nalog i čuva potvrdu.
- Backup prije svakog izdanja; čuva se 30 dana.

## 8. Navigacija — jedan model [cilj, čeka potvrdu vlasnika]

Današnji meni se uklanja i postavlja iznova po ovome:

- **Donja traka na telefonu (prijavljen):** Početna · Pretraga · Objavi · Poruke · Nalog.
- **Zvono u zaglavlju:** obavijesti, s brojem nepročitanih.
- **Nalog (jedan ekran umjesto menija):** profil, moje djelatnosti, termini, sačuvano, postavke,
  pomoć, odjava. Jezik i tema su u postavkama.
- **Gost:** Početna · Pretraga · Ljudi · Prijava.
- **Računar:** iste stavke u zaglavlju, bez donje trake.
- **Administracija i CMS:** svaka adresa ima svoj bočni meni sa svojim stavkama iz dijela 2 i
  linkom nazad na javnu stranicu.

Pravilo: jedna stavka postoji na jednom mjestu. Ako je u donjoj traci, nije i u meniju.

## 9. Izdanje [važi]

Grana → PR u `integration/ahibizz` → CI (provjere, testovi s pravom bazom, proba produkcijske
slike) → spajanje tek kad CI prođe → backup → izdanje u `ahibizz-deploy` → Redeploy → provjera
zdravlja i same izmjene uživo.

## 10. Šta je odloženo

- Isticanje i oglasni prostor: stari model je uklonjen 25. 11. 2026.; novi se tek dogovara.
- Razvojni fond i njegov pravni model: poslije osnovne aplikacije.
- Rezervacije stolova, Facebook prijava, Wise: ne rade se dok vlasnik ne zatraži.
- Probno okruženje s vlastitom bazom: potrebno, još ne postoji.

## 11. Redoslijed do puštanja

1. Očistiti probne podatke. Urađeno 25. 11. 2026.; vidi `docs/handover/OBRISANO.md`.
2. Prebaciti `ahibizz.com` na OctaDeploy; email ostaje na starom serveru. Urađeno
   25. 11. 2026.; vidi `docs/handover/OPERACIJE.md`.
3. Odvojiti `admin.` i `cms.` po dijelu 2.
4. Nova navigacija po dijelu 8.
5. Zajedničke komponente (dugme, kartica, polje, lista) i prelazak ekrana na njih.
6. Pregled koda po cjelinama: prijava, djelatnosti, poruke, termini, Reels, administracija.
7. Probno okruženje.
8. Pred puštanje: SEO (sitemap, robots, opisi), pravni tekstovi, provjera emaila s nove domene.
