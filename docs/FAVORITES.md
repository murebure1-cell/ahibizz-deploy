# Sačuvani profili

Potvrđen i odobren nalog može sačuvati javnu djelatnost preko srca na kartici ili
profilu. Odjeljak **Sačuvani** ostaje unutar istog korisničkog panela. Privatna
lista nije dostupna drugim korisnicima ni kroz administratorski pregled.
Posjetilac se nakon prijave vraća na isti javni profil, uz radnju **Sačuvaj**.
Prijava sama ne dodaje profil u sačuvane; korisnik potvrđuje tu radnju.

Stanje se čuva u bazi, odvojeno po nalogu i djelatnosti. Uklanjanje zadržava verziju
kako stara kartica ili ponovljena komanda ne bi ponovo uključila staro stanje.
Svaka izmjena nosi očekivanu verziju, željeno stanje i ključ komande. Isti
potvrđeni pokušaj se može prepoznati bez nove izmjene; historijski odgovor ne
smije pregaziti kasnije stanje. Neizvjestan odgovor ne znači uspjeh: **Provjeri**
ponovo čita stanje prije nove radnje, bez automatskog ponavljanja izmjene.
Ako čitanje još pokazuje istu verziju, prvobitni pokušaj je i dalje neizvjestan.
Tada se može izričito ponoviti samo isti ključ, željeno stanje i očekivana verzija.
Mali dnevnik te komande čuva se na uređaju, odvojeno po potvrđenom nalogu i
djelatnosti, pa osvježavanje ne stvara novi pokušaj. Ako se dnevnik ne može
sačuvati, izmjena se ne šalje. Kasnija viša verzija dokazuje da stari CAS više ne
može izmijeniti trenutno stanje; tek tada se nudi nova radnja.

Backend provjerava aktuelni potpisani nalog, odobrenje i rok sesije nakon čekanja
transakcijskih zaključavanja. Lista i statusi uvijek pripadaju tom nalogu;
parametar za tuđi nalog ne postoji. Vidljiva srca grupišu čitanje statusa u
zahtjeve do 50 ID-jeva. Javne kartice zadržavaju odvojeno javno dohvaćanje;
sačuvano stanje se ne dodaje u javni imenik niti dijeljeni HTML.

Sačuvana djelatnost se prikazuje samo dok je objavljena, a vlasnikov nalog
potvrđen i odobren. Nacrt, arhiva, blokiran ili nepotvrđen vlasnik skrivaju taj
profil bez brisanja privatnog izbora. Kasnija ponovna objava ga može vratiti.
Privatni vlasnički ID, statusi i napomene administracije nisu dio rezultata.
Lista ima najviše 20 rezultata po stranici i ograničen broj stranica.

Promjena kartice/fokusa skriva privatno stanje i pokreće novu provjeru ovlasti.
Zakašnjeli odgovori prethodnog naloga se odbacuju. Pregled `/pregled` ostaje
izolirana proba i nije omotan stvarnim FavoritesProviderom.

Automatizovane provjere, pregled stvarnih komponenti na testnim podacima i žive
poslovne izmjene vode se odvojeno. Ovaj modul ne aktivira FB, naplatu, pakete,
promocije, verifikaciju ili druge odgođene integracije.
