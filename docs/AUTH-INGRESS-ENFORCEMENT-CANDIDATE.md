# Izričita, zadano isključena ingress granica

Ova cjelina povezuje Node transport, produkcijski startup i BetterAuth konfiguraciju.
Kandidat još nije objavljen niti sam po sebi zatvara prepreku javnom lansiranju.
Vanjski ingress guard i povjerenje client-IP headeru su odvojene kontrole.
Planirana aktivacija uključuje samo guard, uz `AHIBIZZ_INGRESS_TRUST_CLIENT_IP=false`.
Postojeći zajednički rezervni ključ atomskog DB limitera tada ostaje nepromijenjen;
ovim korakom se ne proglašava riješen problem dijeljenja limita prijave.
Bez `AHIBIZZ_INGRESS_ENFORCE=true` postojeći startup i prazna lista pouzdanih
IP headera ostaju nepromijenjeni. Neispravna uključena konfiguracija prekida
startup prije migracije; nema prelaska na nesigurni rezervni način rada.

## Server konfiguracija i dokaz

Izričito uključivanje traži različite `PORT` i `AHIBIZZ_NEXT_INTERNAL_PORT`,
HTTPS `BETTER_AUTH_URL`, tačan `AHIBIZZ_INGRESS_PROXY_PEERS` socket peer bez CIDR-a,
te `AHIBIZZ_INGRESS_BOUNDARY_PROOF` i njegov SHA-256 u
`AHIBIZZ_INGRESS_BOUNDARY_SHA256`. Stvarne peer adrese i operaterski dokaz su
privatna server konfiguracija; ne unose se u javni izvorni kod.

JSON dokaz schema2 sadrži `appId`, `origin`, `operatorReviewed`,
`observerSourceCommit`, `deployment` (sourceCommit, manifest, completedUtc),
`observerProof`, `controlledRequests` i originalni `providerLog`. Validator veže
svih devet kontrolisanih GET health zahtjeva, jedinstven nonce, source/image,
status200, po jedan pokušaj, odsustvo auth cookies/tijela/DB izmjena, redoslijed i
SHA cijelog loga te tačne JSON događaje opažanja. Provider i lokalni sat smiju
imati ograničen pomak do30sekundi; to nije mjerenje latencije. Dokaz se ne odbija
samo zato što je aplikacija kasnije ponovo pokrenuta.

Dokaz mora pokazati isti tačan privatni canonical socket peer kroz svih šest
canonical varijanti, stabilan jedan X-Real-IP uprkos podmetanju i duplim poljima,
te različit javni socket peer kroz tri direktne varijante. Canonical client-IP
fingerprint mora odgovarati direktnom socketu. Ako se canonical i direct put
pojave s istim gateway peerom, konfiguracija se odbija. Sintetični testni dokaz
nikada se ne smije prekopirati u produkcijske postavke.

Opažanja opisuju jednu provjerenu konfiguraciju i trenutak, nisu trajno obećanje
providera. Promjena Nginx prepisivanja headera uz isti socket peer može narušiti
pretpostavku povjerenja. Aktivacija traži pregledanu operatersku granicu,
ponovnu provjeru nakon promjene ingressa i mogućnost sigurnog vraćanja.
Deployment gate zasebno traži svježi dokaz i provjeru poslije objave.

## Zasebno, zadano isključeno povjerenje client-IP adresi

Tačan socket peer može biti zajednički Docker host gateway. Devet vanjskih proba
razlikuje posmatrani HTTPS i direktni put, ali ne autentifikuje Nginx proces niti
dokazuje da druga host-lokalna ili susjedna aplikacija ne može doći istim peerom.
Opća providerova DPA tvrdnja o izolaciji nije dokaz ACL-a za objavljeni port
aplikacije213. Takav ugovor nije prihvaćena vrsta trust potvrde.

Samo zaseban `AHIBIZZ_INGRESS_TRUST_CLIENT_IP=true` uz već validiran guard može
omogućiti privatni IP header. Dodatno traži `AHIBIZZ_INGRESS_TRUST_ATTESTATION`
i njegov tačan `AHIBIZZ_INGRESS_TRUST_ATTESTATION_SHA256`. Schema1 potvrda mora
imati vrstu `app_specific_network_acl`, appId213, isti origin, boundarySha256 i
proxyPeers, izričit reviewed status/datum te pregledan HTTPS providerEvidence
za tu konkretnu aplikaciju s hashom sačuvanog dokaza. Potvrda mora navesti blokiran
pristup neovlaštenim host/tenant izvorima i dozvoljen pristup samo ovlaštenom
proxyju. Scope je `app_specific_boundary`; ne tvrdi se autentifikacija Nginx
procesa. Nepoznata vrsta, opći DPA, druga aplikacija, nepoznat dokaz ili neslaganje
hasha prekidaju startup. Podrška za autentifikovani proxy marker nije implementirana.

Hash veže tačno operaterski pregledane bajtove; nije providerov digitalni potpis
i validator sam ne provjerava firewall. Stvarni ACL dokaz trenutno ne postoji,
pa se trust ne uključuje. Pozitivna potvrda u testovima je isključivo sintetična.

## Startup i transport

Migracija završava prije pokretanja aplikacije. Privatno Next dijete veže se
isključivo na127.0.0.1 i interni port. Parent nakon lokalnog health odgovora otvara
jedini javni listener na postojećem `PORT`. Nema dodatnog javnog Next listenera.
Child-only `AHIBIZZ_INGRESS_WRAPPED` i `AHIBIZZ_INGRESS_PUBLIC_PORT` postavlja
startup, ne korisnik ili browser. BetterAuth prihvata privatni IP header samo
kada marker, loopback HOSTNAME, interni PORT, ponovo validirana politika i zasebno
omogućeno app-specific povjerenje odgovaraju. Guard bez tog povjerenja ostavlja
praznu listu auth IP headera.

Normalni zahtjev mora imati tačan socket peer, tačno jedan sintaksno validan Host
i jedan validan X-Real-IP. Incoming Host authority se odbacuje: nije izvor rute,
canonical origina ili client-IP povjerenja. Tako podržani proxy Host prepisan na
interno ime/IP i port ne zavisi od javne domene. Missing/dupli Host, kontrolni
znakovi, whitespace, userinfo, putanja/query/fragment i nevažeći port se odbijaju.
Origin i Referer se čuvaju kao originalni podaci zahtjeva radi postojećih CSRF
provjera; nikada se ne prepisuju u pouzdan origin. XFF nije izvor povjerenja.
Host nije bio obuhvaćen početnim observerom:
uspješan stvarni HTTPS zahtjev poslije uključivanja mora potvrditi kompatibilnost.
Validacija sintakse Hosta i fiksna rekonstrukcija origina su odvojene provjere;
vrijednost incoming authority ne dodjeljuje nikakva prava ili povjerenje.

Caller `x-ahibizz-ingress-*`, Forwarded, X-Forwarded-* i hop-by-hop headeri,
uključujući caller Connection listu, uklanjaju se. Privatni client-IP postavlja
se server-side poslije uklanjanja samo kada je zasebno povjerenje omogućeno.
U guard-only režimu taj header se uopće ne prosljeđuje. `X-AhiBizz-Account-ID`, cookies, Authorization
i tijelo ostaju aplikacijski podaci. Canonical transport headeri dolaze iz
konfigurisanog origin-a. BetterAuth `trustedProxyHeaders` ostaje false, praćenje
IP-a uključeno i postojeći atomski DB limiter ne mijenja se.

Samo loopback GET na bare `/api/health/live` ili `/api/health/ready` ima health
izuzetak bez client IP-a. Nema izuzetka za POST, query ili druge rute. WebSocket,
CONNECT i TRACE izričito se odbijaju; tuneli nisu podržani ovim transportom.

Request/response streaming koristi Node backpressure; Set-Cookie niz i Location
se čuvaju. Tijelo je ograničeno na32MiB, iznad trenutne business-media granice4MiB;
postojeće uže aplikacijske granice ostaju. Budući video/resource modul nije
aktiviran ovom izmjenom. Upstream je fiksni loopback, sa redigiranim greškama,
timeoutom i prekidom pri otkazivanju klijenta.

SIGTERM/SIGINT prvo zatvaraju prihvat javnih zahtjeva i daju aktivnim odgovorima
ograničeno vrijeme da završe, zatim gase dijete. Neuspjeh/spontani izlazak djeteta
zatvara javni listener i završava parent; nema automatskog ponavljanja childa ili
poslovnih mutacija. Naredni restart ponovo prolazi konfiguraciju i migracijski gate.

## Ograničeno opažanje i provjera

Uz enforcement i `AHIBIZZ_INGRESS_OBSERVE=true`, postojeći ograničeni observer
učitava se u parentu poslije uspješne migracije, prije javnog listenera. Ne učitava
se u migraciji ili privatnom Next djetetu. Tako bilježi stvarni vanjski socket i
originalne headere za tačne nonce health probe zahtjeve, uključujući odbijene
direktne pokušaje. Ne bilježi cookies, tijelo, tokene ili druge rute. Bez
enforcementa observer zadržava postojeće opt-in child ponašanje.

Izolirani testovi koriste stvarni Node HTTP, različite loopback klijente i pinned
BetterAuth. Testni startup pokriva migraciju, child bind, ograničenja, body/cookies,
streaming, parent-only observer, signal/drain i restart. To nije dokaz stvarnog
telefona, provider Hosta, produkcijskog login toka ili spremnosti čitave aplikacije.
Prije aktivacije trebaju nezavisni pregled, puni build/CI, backup i svježa provjera
canonical/direct granice i autorizovanih tokova poslije objave.
