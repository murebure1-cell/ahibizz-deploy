# AhiBizz — specifikacija proizvoda

Od 25. 11. 2026., po zahtjevima vlasnika. `docs/DEFINICIJA.md` kaže gdje šta živi u kodu; ovaj
dokument kaže šta korisnik dobija.

Oznake: **[postoji]** već radi, **[novo]** treba izgraditi, **[odlučeno]** vlasnik je potvrdio
25. 11. 2026., **[pitanje]** još čeka odluku vlasnika.

## 1. Kojim redom se aplikacija dizajnira

1. **Ko je korisnik i šta smije:** uloge i paketi (dio 2).
2. **Šta čuvamo:** podaci koje ti ekrani trebaju (djelatnost, jelovnik, pregledi).
3. **Tokovi:** put od prijave do objavljene djelatnosti, korak po korak (dijelovi 3–6).
4. **Ekrani:** tek sad, jer se zna šta svaki mora pokazati.
5. **Izgled:** jedan sistem komponenti za sve ekrane (dio 9).
6. **Mjerenje i naplata:** analitika i plaćanje dolaze na gotove tokove.

Greška koju smo do sada pravili je obrnut red: dotjerivali smo izgled ekrana čiji sadržaj još nije
bio odlučen.

## 2. Paketi

Tri paketa: **Basic**, **Startup**, **Business**. Paket određuje koliko djelatnosti nalog smije
imati i koliko analitike vidi. Paket pripada nalogu, a ne pojedinoj djelatnosti; nalog bez upisa
ima Basic **[postoji]**. Dok ne bude naplate na webu, paket ručno mijenja administrator u
`/administracija` → Nalozi → Odobreni → „Paket”, uz razlog koji ostaje zapisan **[postoji]**.
Stare oznake `basic`, `business`, `premium` žive samo u arhivi ranijih ugovora i ne koriste se.

| | Basic | Startup | Business |
|---|---|---|---|
| Djelatnosti | 1 | do 3 | do 10 |
| Cijena mjesečno | besplatno prvih 12 mjeseci, zatim 19,90 KM | 39,90 KM | 79,90 KM |
| Analitika | osnovna | proširena | puna |
| Reels | 1 sedmično | 3 sedmično | 1 svaki dan |
| Oznaka na profilu | „Basic”, neutralna | „Startup” | „Business”, zlatna slova |

Brojevi djelatnosti i cijene su **[odlučeno]**. Granica broja djelatnosti se provodi
**[postoji]**; cijene se još nigdje ne naplaćuju ni prikazuju. Administratorski nalog nema paket
ni granicu. Paket se ne može spustiti ispod broja djelatnosti koje nalog već vodi; arhivirane
djelatnosti se ne broje.

Broj Reelsa po paketu je **[odlučeno]**: Basic jedan sedmično, Startup tri sedmično, Business jedan
svaki dan. Kod to još ne provodi po paketu **[novo]**: danas dopušta najviše 3 aktivna Reela po
djelatnosti i 12 po nalogu, a objavljeni Reel se prikazuje 24 sata **[postoji]**. Reels se prikazuju
na početnoj **[postoji]** i ostaju tamo i u novom izgledu **[odlučeno]**. Broj važi po nalogu, za
sve njegove djelatnosti zajedno **[odlučeno]**. Nije rečeno kojim danom počinje sedmica ni ostaje
li prikaz od 24 sata **[pitanje]**.

Pravila koja već važe i ostaju:

- Paket ne daje značku provjerenog identiteta ni Halal oznaku. To su odvojene, ručne provjere.
- Plaćanje postoji samo na webu. U Android aplikaciji nema plaćanja; tamo piše da se uplata
  obavlja na `ahibizz.com`.
- Ove cijene zamjenjuju ranije potvrđene 29/49/89 KM mjesečno i 290/490/890 KM godišnje. Nije
  rečeno postoji li godišnja uplata s popustom ni obaveza od 12 mjeseci za Startup i Business
  **[pitanje]**.
- Besplatnih 12 mjeseci Basica teče od objave prve djelatnosti **[pitanje: ili od registracije]**.
  Šta biva s djelatnošću kad rok istekne bez uplate (skriva se ili ostaje vidljiva bez izmjena)
  nije odlučeno **[pitanje]**.

Kad nalog dosegne granicu paketa, dugme „Dodaj djelatnost” objašnjava granicu prije nego što se
obrazac otvori **[postoji]**. Ponuda višeg paketa s tog mjesta dolazi s naplatom **[novo]**.

## 3. Moj profil

Prvi ekran nakon prijave (`/nalog`, odjeljak Pregled). Kostur je izgrađen 25. 11. 2026.: zaglavlje,
moje djelatnosti i lista prečica **[postoji]**. Odozgo nadolje:

1. **Zaglavlje:** naslovna slika, profilna slika, ime, oznaka paketa, značka verifikacije ako
   postoji, „član od” s datumom **[postoji]**. Business je ispisan zlatnim slovima na tamnoj
   podlozi. Slike se mijenjaju u odjeljku „Moj profil”; promjena dodirom iz zaglavlja, s mekim
   prelazom, tek dolazi **[novo]**. Vlastitu naslovnu sliku danas ima samo nalog kojem je uključena
   **[pitanje: da li je dobijaju svi paketi]**.
2. **Pregled:** brojke po paketu (dio 7). Na Basicu dvije: pregledi profila i pregledi djelatnosti.
3. **Moje djelatnosti:** do pet djelatnosti sa stanjem (nacrt, na pregledu, objavljeno), brojač
   „1 od 1” i dugme za dodavanje; kad je paket pun, umjesto dugmeta stoji objašnjenje **[postoji]**.
4. **Poruke:** broj nepročitanih **[postoji]**; zadnji razgovori na samom pregledu **[novo]**.
5. **Termini:** sljedeći termin, ako djelatnost prima termine **[postoji]**.
6. **Sponzorisano:** gdje se djelatnost prikazuje i s kakvim rezultatom (dio 6) **[novo]**.
7. **Postavke** i **Pomoć**, a na telefonu i **Odjava** na dnu liste **[postoji]**.

Sve što danas stoji na profilu, a nije na ovom spisku, uklanja se nakon pregleda ekrana.

## 4. Postavke

U postavkama danas stoje **[postoji]**: podaci naloga i lozinka; verifikacija profila (stanje i
link za zahtjev; dodjela ostaje ručna); jezik; tema (uređaj, svijetla, tamna); obavijesti na
uređaju; blokirani korisnici, pravila privatnosti, pristup podacima i brisanje naloga.

Još nema **[novo]**: obavijesti emailom po vrsti; vidljivost profila iz postavki (danas je u
uređivanju profila); povezani Google nalog; aktivne prijave po uređajima s odjavom pojedine.

## 5. Dodavanje djelatnosti

Jedan tok u koracima umjesto dugog obrasca **[novo; dijelovi postoje]**:

1. **Kategorija i potkategorija.** Izbor određuje koje korake tok ima dalje.
2. **Osnovno:** naziv, opis, telefon, email, web.
3. **Lokacija:** upis adrese pronalazi mjesto i postavlja PIN na kartu; PIN se može povući da se
   ispravi. Alternativa je „Koristi moju lokaciju”. Bez potvrđenog PIN-a nema objave.
4. **Slike:** logo, naslovna, galerija.
5. **Dio koji zavisi od kategorije:**
   - **Rent-a-car:** odmah se otvara „Dodaj vozilo” **[modul postoji]**.
   - **Smještaj:** odmah se otvara „Dodaj sobu ili apartman” **[modul postoji]**.
   - **Usluge s terminima:** usluge, trajanje i radno vrijeme **[modul postoji]**.
   - **Ugostiteljstvo** (restoran, fast food, kafić, pekara, slastičarna, catering): jelovnik i
     porijeklo mesa **[novo]**, opisano ispod.
6. **Pregled i slanje na odobrenje.**

**Jelovnik:** učitavanje PDF-a ili slika, ili unos stavki s cijenom. Rezervacije stolova ostaju
izvan aplikacije.

**Porijeklo mesa:** vlasnik navodi od koga nabavlja meso, posebno za piletinu i za crveno meso.
Ako je dobavljač (mesnica ili mesna industrija) registrovan na AhiBizzu, bira se s liste i
dobavljač potvrđuje saradnju; tek tada piše „Potvrđena saradnja” s vezom na njegov profil. Ako
nije registrovan, upisuje se naziv i prikazuje se kao navod vlasnika. Ovo je podatak o dobavljaču,
a ne Halal certifikat, i tako mora i izgledati **[odlučeno]**.

## 6. Sponzorisano (bivše „isticanje”)

Stari model je uklonjen 25. 11. 2026. Naziv je „Sponzorisano” **[odlučeno]**; mjesta, trajanja i
cijene se tek dogovaraju **[pitanje]**. Okvir:

- Vlasnik bira mjesto prikaza. Svako mjesto ima ikonu koja kaže gdje se vidi: telefon (mobilna
  aplikacija) ili ekran (web), i koji dio: početna, pretraga, kategorija, blizina.
- Na profilu se vidi stanje (čeka uplatu, aktivno do datuma, završeno) i rezultat: koliko puta je
  prikazano, koliko puta otvoreno, koliko poruka i poziva je iz toga nastalo.
- U aplikaciji nema plaćanja; piše da se uplata obavlja na `ahibizz.com`.
- Sponzorisani prikaz ne daje nikakvu značku i uvijek je označen kao sponzorisan.

## 7. Analitika

Danas se broje samo pregledi Reelsa **[postoji]**. Sve ostalo je **[novo]**.

Šta se bilježi: prikaz profila, prikaz djelatnosti, pojavljivanje u rezultatima, dodir na telefon,
poruku, kartu i web. Bilježi se zbirno po danu, bez praćenja pojedinog posjetioca, i čuva 13
mjeseci.

| | Basic | Startup | Business |
|---|---|---|---|
| Pregledi profila i djelatnosti, 30 dana | da | da | da |
| Po danima, graf | — | da | da |
| Odakle dolaze (pretraga, kategorija, karta) | — | da | da |
| Dodiri na telefon, poruku, kartu | — | da | da |
| Poređenje s prethodnim periodom | — | — | da |
| Po gradovima i po satima | — | — | da |
| Rezultati sponzorisanog prikaza po mjestu | zbir | zbir | detaljno |
| Izvoz | — | — | da |

## 8. Kategorije

Lista treba pokriti sve poslovne djelatnosti od prvog dana **[novo; danas ih je nekoliko]**:
Ugostiteljstvo; Smještaj; Rent-a-car i prevoz putnika; Transport i logistika; Auto-moto servisi;
Ljepota i njega; Zdravstvo; Trgovina; Hrana i poljoprivreda (mesnice, mesna industrija, farme,
pekare); Proizvodnja; Građevina i majstori; Dom i vrt; Čišćenje i održavanje; IT i digitalne
usluge; Poslovne usluge (računovodstvo, pravo, marketing, prevodi); Finansije i osiguranje;
Nekretnine; Obrazovanje i kursevi; Sport i rekreacija; Događaji i vjenčanja; Turizam i putovanja;
Mediji, foto i dizajn; Djeca i porodica; Kućni ljubimci; Udruženja i fondacije. Svaka dobija
potkategorije; tačan spisak ide vlasniku na potvrdu prije unosa.

## 9. Izgled

- **Minimalizam:** jedna mirna površina, tanke linije, mnogo prostora, malo boja.
- **Paleta [odlučeno 25. 11. 2026.]:** isti logo, nove boje. Grafitna osnova u dvije teme (tamna i
  svijetla) i jedan akcenat za glavnu radnju: mint na tamnoj, tirkizna na svijetloj. Vrijednosti su
  u `src/app/globals.css` (`--ui-*`); boja se u stilove ne upisuje direktno.
- **Zlato** samo za riječ Business, uvijek na tamnoj podlozi. Glavna radnja je u boji akcenta.
  Jedini izuzetak je zlatnik u animaciji otvaranja i pri povlačenju za osvježavanje, koji je
  vlasnik tražio.
- **Logo [odobreno 25. 11. 2026., uz animaciju otvaranja]:** oblik znaka i slova je nepromijenjen.
  „ahi” i tačka su u boji akcenta, znak i „bizz” u boji teksta teme; na podlozi u boji akcenta i
  preko fotografije logo je jednobojan. Crta ga komponenta `AhiLogo`.
- **Otvaranje [odobreno 25. 11. 2026.]:** pri prvoj posjeti početnoj na jednom uređaju odigra se
  jednom: zlatnik padne ispod znaka, uskoči u krug u njegovom ćošku i postane ta rupa, zatim
  isklizne natpis i ispod njega „Naša mreža, naša snaga.” Traje oko četiri i po sekunde, dodir ili
  tipka je prekida, a uz smanjeno kretanje se ne prikazuje.
- **Povlačenje za osvježavanje [odobreno 25. 11. 2026.]:** na Početnoj, Pretrazi, Porukama i
  Obavijestima, samo kad je ekran na samom vrhu. Sadržaj ide za prstom, sve teže što se dalje
  vuče, a zlatnik se kotrlja po njegovom rubu prema znaku. Na 80 px zlatnik uskoči u rupu i znak
  dobije punu boju; ko tada pusti, osvježava. Zlato postane rupa, svjetlo ide rubom znaka dok
  sadržaj ne stigne (najmanje 0,6 s), zatim znak ode gore. Ko pusti ranije, sve se vrati za 200 ms
  i ništa se ne učitava. Na Početnoj logo putuje sa fotografijom, na ostalim ekranima zaglavlje
  stoji. Uz smanjeno kretanje nema zlatnika: znak se pojavi i blago pulsira dok traje učitavanje.
  Pravila su u `src/lib/pull-to-refresh.ts`.
- **Pismo:** Manrope za cijeli interfejs, s vlastitog servera; arapski tekst koristi sistemsko pismo.
- **Oblik:** jedna ljestvica zaobljenja (`--ui-radius-xs` do `--ui-radius-xl`): kontrole 16 px,
  kartice 24 px, oznake potpuno zaobljene.
- **Donja traka:** lebdi iznad sadržaja, samo ikone, tačka ispod trenutne i krug u boji akcenta za
  objavu.
- **Kartica djelatnosti [urađeno 25. 11. 2026.]:** fotografija s gradacijom, srce i stanje
  („Otvoreno do 22:00” ili „Zatvoreno”) preko nje, ocjena na pločici u boji akcenta, logo na rubu
  fotografije, naziv s oznakom verifikacije, mjesto, dva reda opisa, sadržaji kao kružići i tri
  radnje u dnu. Nivo cijena je na crtežu, ali podatak još ne postoji **[novo]**.
- **Početna, pretraga i stranica djelatnosti [urađeno 25. 11. 2026.]:** po crtežima; raspored na
  širokom ekranu nije crtan i izveden je iz telefonskog.
- **Zamućenje** samo na slojevima koji leže preko sadržaja: donja traka, meni, listovi koji
  izlaze odozdo, prelaz pri zamjeni slike. Ne na karticama.
- **Pokret:** kratak (150–250 ms) i sa svrhom. Tačkice za „učitavam” i za „novo”.
- **Jedan skup komponenti** (dugme, polje, kartica, lista, list odozdo, značka) na koji se sele svi
  ekrani; bez toga isti element i dalje izgleda drugačije od ekrana do ekrana.
- Ekrani koje svaka aplikacija mora imati, a kod nas su nedovršeni: prvi koraci nakon prve prijave,
  prazna stanja, greška, bez mreže, učitavanje.

## 10. Redoslijed gradnje

Svaka faza završava nečim što se vidi i može probati.

1. Paketi i granice u modelu, novi kostur profila i sređene postavke (urađeno 25. 11. 2026.).
   Iz ove faze ostaju aktivne prijave po uređajima i zadnji razgovori na pregledu.
2. Tok dodavanja djelatnosti s lokacijom i PIN-om; nova lista kategorija.
3. Jelovnik i porijeklo mesa; vezivanje vozila i soba u tok.
4. Prikupljanje analitike i prikaz po paketu; broj Reelsa po paketu.
5. Verifikacija iz postavki i značke.
6. Sponzorisano po novom modelu, s rezultatima.
7. Naplata na webu.

Zajedničke komponente i izgled grade se uz prvu fazu i koriste u svim ostalim.

## 11. Šta čeka odluku vlasnika

1. Od kada teče besplatnih 12 mjeseci Basica, i šta biva s djelatnošću kad isteknu bez uplate.
2. Postoji li godišnja uplata s popustom i obaveza od 12 mjeseci za Startup i Business.
3. Mjesta, trajanja i cijene za „Sponzorisano”.
4. Tačan spisak potkategorija.
5. Primjeri animacija koje vlasnik želi poslati kao uzor.
6. Da li vlastitu naslovnu sliku profila dobijaju svi paketi.
7. Reels: kojim danom počinje sedmica i ostaje li prikaz od 24 sata.
