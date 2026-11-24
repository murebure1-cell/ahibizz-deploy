# Dodo: priprema samo za web (naplata nije uključena)

Stanje: 23. 11. 2026. Ovo je spisak za odluku, ne implementacija. Na ovoj grani nema Dodo koda, ključeva, checkout rute ni promjene cijena. Play izdanje ostaje bez kupovine, cijena i linkova na web checkout.

## Model koji Ajdin opisuje (ne mijenjati bez potvrde)

- **Pretplate** Basic, Startup i Business (AI Pro): mjesečno ili godišnje, plaćaju se novcem.
- **Krediti** se kupuju zasebno i troše na banere i isticanje.

## Šta je sada u kodu

- Isticanje se plaća bankovnom uplatom na webu (promotions-v2). Play build zatvara `/istakni`, `/paketi`, `/oglasavanje`, `/naplata`, `/podrzi`, `/nalog/isticanja` i `/api/checkout`, `/api/paketi` (CI to provjerava).
- Raniji Dodo **test** (sandbox, EUR 5,11, sedmodnevni testni zapis) je radio, ali je kod uklonjen (`docs/handover/OBRISANO.md`). Ostale su samo već primijenjene migracije (`0022_dodo_test_checkout.sql`); ne mijenjati ih.
- U testu **povrat novca nije prošao** (Dodo je vratio 409, povrat nije potvrđen).
- `AGENTS.md` bilježi potvrđene uslove: 29/49/89 BAM mjesečno uz 12 mjeseci obaveze ili 290/490/890 BAM godišnje unaprijed. Nazivi Basic/Startup/Business tu nisu povezani s iznosima.

## Šta Ajdin mora potvrditi prije bilo kakve naplate

1. **Obuhvat Dodo odobrenja**: koje ponude Dodo dozvoljava (pretplate, jednokratni krediti, oboje), za koje zemlje i u kojoj valuti naplaćuje (BAM ili EUR/USD). Pisani dokaz iz Dodo naloga.
2. **Javne cijene i intervali**: koji iznos pripada Basic, Startup i Business (AI Pro), mjesečno i godišnje. Da li važi 12-mjesečna obaveza kod mjesečnog plaćanja. Cijene i količine paketa kredita.
3. **Uslovi**: uslovi korištenja i pretplate, ko je prodavač (Dodo kao merchant of record ili AhiBizz), porez i PDV.
4. **Povrat i otkazivanje**: kada i kako korisnik otkazuje, šta se dešava s ostatkom perioda i neiskorištenim kreditima, rok povrata. Povrat mora proći test prije uključivanja.
5. **Wise isplata**, odvojeno: da li je Wise račun za isplate od Dodo-a otvoren, potvrđen i povezan. Status Wise isplate ne potvrđuje da je naplata spremna, niti obrnuto.
6. **20% razvojnog izdvajanja** (`AGENTS.md`): računa se od potvrđenih primitaka umanjenih za stvarne poreze, naknade i ispravke. Ne prikazivati ga kao uplatu Fondaciji.

## Tehnički redoslijed kad odluke budu potvrđene (zaseban PR)

1. Dodo **test mode**: proizvodi i pretplate tačno prema potvrđenim cijenama; ključevi samo kao serverske varijable, nikad `NEXT_PUBLIC_`.
2. Checkout samo na webu. Nove rute dodati na Play listu zatvorenih ruta i u CI provjeru.
3. Webhook s provjerom potpisa, trajni inbox i provjera iznosa, valute i proizvoda prije dodjele prava.
4. Testirati kupovinu, obnovu, otkazivanje, neuspjelu naplatu i **povrat** u test modu na izoliranoj bazi.
5. Tek nakon odobrenja: živi ključevi, koje Ajdin sam upisuje u OctaDeploy, i prva prava uplata uz njegov pristanak.
