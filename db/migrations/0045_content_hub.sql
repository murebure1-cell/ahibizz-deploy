CREATE TABLE blog_article (
  slug text PRIMARY KEY CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 80),
  category text NOT NULL CHECK (category IN ('vodici','poslovanje','sigurnost','novosti')),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 125),
  excerpt text NOT NULL CHECK (length(trim(excerpt)) BETWEEN 10 AND 300),
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 30 AND 20000),
  featured boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  CHECK (NOT featured OR published_at IS NOT NULL)
);

CREATE INDEX blog_article_published ON blog_article (published_at DESC, slug) WHERE published_at IS NOT NULL;
CREATE UNIQUE INDEX blog_article_featured ON blog_article (featured) WHERE featured;

CREATE TABLE blog_bookmark (
  account_id text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  article_slug text NOT NULL REFERENCES blog_article(slug) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, article_slug)
);

ALTER TABLE support_request
  DROP CONSTRAINT support_request_subject_check,
  ADD CONSTRAINT support_request_subject_check
    CHECK (subject IN ('deletion','person','business','review','conversation','help'));
CREATE UNIQUE INDEX support_request_help_once ON support_request(actor_id,reference) WHERE subject='help';

INSERT INTO blog_article(slug,category,title,excerpt,body,featured,published_at) VALUES
('uredi-poslovni-profil','poslovanje','Da te ljudi lakše pronađu',
 'Tri stvari koje vrijedi provjeriti prije nego što objaviš svoju djelatnost na AhiBizzu.',
 $profile$Kreni od onoga što bi kupac ukucao u pretragu. Pored naziva djelatnosti upiši kome pomažeš, šta tačno nudiš i na kojem području radiš. Ako radiš i na terenu, navedi koji gradovi ili naselja dolaze u obzir.

Fotografije neka pokažu prostor, tim ili rezultat usluge. Uz svaku cijenu navedi šta je uključeno. Ako iznos zavisi od obima posla, objasni koje podatke trebaš za preciznu ponudu.

Prije objave otvori profil onako kako ga vidi posjetilac. Provjeri da radno vrijeme odgovara stvarnom, da kontakt radi i da je jasno kako naručiti uslugu ili rezervisati termin.$profile$,true,now()),
('prvi-dogovor-termina','vodici','Dogovori termin bez čekanja',
 'Provjeri kada je djelatnost slobodna i pripremi sve što treba za prvi dolazak.',
 $booking$Otvori profil djelatnosti i pogledaj nudi li rezervaciju. Odaberi uslugu i slobodan termin koji ti odgovara. U potvrdi provjeri datum, vrijeme i mjesto dolaska.

Kada usluga traži posebnu pripremu, pitaj djelatnost kroz AhiBizz poruke. Ako trebaš promijeniti plan, provjeri detalje rezervacije i javi se što ranije.

Ako slobodni termini nisu prikazani, pošalji upit direktno djelatnosti. Predloži dva vremena koja ti odgovaraju i napiši šta želiš rezervisati.$booking$,false,now() - interval '1 second'),
('siguran-razgovor','sigurnost','Prepoznaj sumnjivu poruku',
 'Zastani prije nego što klikneš na link ili podijeliš podatke u razgovoru.',
 $safe$Ako ti neko traži lozinku, kod za prijavu ili podatke kartice u poruci, prekini razgovor. Za prijavu i naplatu otvori AhiBizz direktno iz preglednika ili instalirane aplikacije.

Prije dogovora provjeri profil djelatnosti i uporedi kontakt s podacima na njenim javnim kanalima. Zatraži da cijena, rok i uslovi budu jasno napisani u razgovoru.

Sumnjivu poruku prijavi iz razgovora ili u centru za pomoć. U prijavi navedi šta se desilo i kada, uz što manje ličnih podataka.$safe$,false,now() - interval '2 seconds'),
('planiraj-kampanju','novosti','Pronađi pravu poziciju za oglas',
 'Odredi cilj kampanje, provjeri formate i isprobaj svoju sliku prije slanja zahtjeva.',
 $campaign$Prvo odredi šta kupac treba uraditi kada vidi oglas. Ako želiš više rezervacija, vodi ga do profila s terminima. Ako želiš razgovor o skupljoj usluzi, ostavi mu jasan način za upit.

Na stranici za oglašavanje uporedi pozicije na telefonu i računaru. Isprobaj sliku u odabranom formatu i provjeri čitljivost na telefonu. U ponudi ćeš dobiti uslove i iznos prije naplate.

Nakon objave prati prikaze i klikove u svom nalogu. Uporedi rezultate dvije kampanje pod sličnim uslovima prije nego što povećaš budžet.$campaign$,false,now() - interval '3 seconds');
