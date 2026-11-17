# Granica prikaza prijavljenog naloga

`AccountAuthorityBoundary` obuhvata cijeli korisnički panel, uključujući identitet,
profil, prijatelje, poruke, termine, djelatnosti i postavke. Server već odobrava
početni prikaz. Običan prelazak između odjeljaka ne dodaje novi zahtjev za nalog.

`blur`, `pagehide` i skrivanje dokumenta odmah sakrivaju cijeli privatni prikaz iz
vidljivog i pristupačnog interfejsa.
Povratak traži svježi `GET /api/account`, vezan za isti očekivani nalog. Samo
trenutno odobren korisnik s potvrđenim emailom, istim ID-jem i istom početnom
ulogom ponovo vidi panel. Promjena uloge traži novi serverski prikaz; ne otkriva
se ranije montiran panel s drugim ovlastima.
Drugi nalog, odbijen pristup, nedostupan odgovor ili timeout ostavljaju neutralni
prikaz s ponovnom provjerom i prijavom u zasebnoj kartici.

Provjere koriste epoch i prekid čitanja. Stari uspjeh ili odbijanje poslije
promjene A → B → A ne mogu otkriti ili ponovo sakriti noviji potvrđeni prikaz.
Više istovremenih događaja povratka dijeli jednu provjeru. Ova cjelina ne šalje
niti ponavlja poslovne komande.

Podređene komponente ostaju montirane. Time se čuvaju neuneseni tekstovi i već
poslani/neizvjesni booking ili chat pokušaji koji imaju vlastita pravila oporavka.
Njihova postojeća aktivnost po odjeljku ostaje nepromijenjena. To omogućava da
povratak iz ranije otvorenog sistemskog odabira datoteke obradi lokalni izbor i
dovrši njegov izričito započeti upis dok traje provjera vidljivosti. Svaki takav
upis i dalje nezavisno provjerava potpisanog aktera na serveru; drugi nalog ne
može pisati za stari profil. Granica prikaza ne pokreće i ne ponavlja upis.
Ovo je **zaštita vidljivosti i pristupačnosti**, ne brisanje skrivenog DOM-a,
JavaScript memorije ili lokalno sačuvanih nacrta. Nije zamjena za serversku provjeru
potpisane sesije i ovlasti pri svakoj privatnoj radnji. Samostalni administrator
ima odvojene tokove; ovom cjelinom se ne tvrdi globalna zaštita svih admin panela.

Izolirana provjera koristi stvarne komponente profila, prijatelja i poruka uz
memorijske adaptere bez produkcijske mreže. Fizički telefon, drugi pravi nalog i
poslovne transakcije ostaju zaseban prihvat.
