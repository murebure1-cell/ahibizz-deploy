# Privremeno posmatranje ingressa

Ovo je faza prikupljanja dokaza. Ne mijenja proxy, auth pravila, rate limiter,
ovlasti, HTTP odgovore ili granicu povjerenja. Auth prepreka lansiranju ostaje.

`AHIBIZZ_INGRESS_OBSERVE=true` uključuje `scripts/ingress-observe.mjs` preko
Node `--import` samo za standalone server dijete. Zadano je isključeno; migracija
ne učitava observer. Ne postavlja se `NODE_OPTIONS`.

Posmatra se samo tačan `GET /api/health/live?ingressProbe=<UUID>`, bez drugih
parametara ili fragmenta. UUID je javni korelacijski podatak, ne tajni token.
Nema novog endpointa: postojeći health odgovor ostaje isti.

Jedan odgovarajući zahtjev daje jednu JSON liniju `ahibizz_ingress_observe`,
najviše 24 linije u 60 sekundi i 96 za život procesa. Ponavljanje istog UUID-a
je dopušteno radi poređenja ruta. Nakon dostizanja granice nema dodatnih logova.

Samo privatni/loopback socket peer smije imati normalizovanu adresu u logu.
Ostali peerovi i sve validne IP vrijednosti posmatranih headera imaju samo
SHA-256 otisak `nonce + normalizedIp`. IPv4-mapped IPv6 se svodi na IPv4.
`X-Real-IP` mora imati jednu vrijednost; XFF je ograničen na 16 vrijednosti.
Dupla polja, neispravne i preduge vrijednosti daju samo fiksni opis problema.
Ne loguju se cookies, tijelo, tokeni, URL osim UUID-a ili drugi headeri.

Dokaz mora odvojeno pokazati canonical socket peer i direktni javni peer te
stvarno proxy prepisivanje headera. Ako oba puta imaju isti gateway peer, sam
socket allowlist ne zatvara bypass. Log nije dozvola da se headeru vjeruje.

Kanál je dokumentovan u [Node24 diagnostics_channel](https://nodejs.org/docs/latest-v24.x/api/diagnostics_channel.html#event-httpserverrequeststart).
Stvarni localhost HTTP testovi pokrivaju channel oblik i transparentnost.
