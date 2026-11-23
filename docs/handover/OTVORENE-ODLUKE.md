# Otvorene odluke vlasnika

Odluke o naplati vlasnik je zaključio 22. 11. 2026: objava djelatnosti je besplatna; novo isticanje plaća se bankovnom uplatom samo na webu; Play izdanje nema kupovine. Opis koda nije potvrda produkcijske konfiguracije. Nisu čitane vrijednosti tajni, živa baza, bankovni podaci ni statistika produkcije.

| Odluka | Dokaz i sadašnja granica | Opcije i šta treba potvrditi |
| --- | --- | --- |
| Google indeksiranje i javno lansiranje | `src/app/layout.tsx` postavlja `robots: { index: false, follow: false }`. Javne rute postoje, ali aplikacija trenutno traži zabranu indeksiranja. | Potvrditi indeksiranje cijelog javnog imenika ili zadržavanje zabrane do lansiranja, canonical domen i eventualnu sitemap politiku. Privatne i administrativne rute ostaju zaštićene bez obzira na robots pravila. |
| Vlasništvo 33 djelatnosti na administratorskom nalogu | Broj 33 je podatak iz zadatka vlasnika, nije provjeren živim upitom. Kod prenosa: `server/business-ownership/service.ts`; evidencija: `directory_ownership_transfer`. Administrator platforme i vlasnik djelatnosti su različite ovlasti. | Za svaku djelatnost potvrditi stvarnog vlasnika, email odobrenog naloga i ovlaštenje za prenos. Prenositi preko postojećeg toka koji bilježi historiju i verziju; ne masovnim prepisivanjem vlasnika u bazi. |
| Zadržavanje i obrada privatnih podataka | Brisanje naloga anonimizira korisnika i uklanja sadržaj preko `erase_account_content`; određene uplate i historija ostaju. Aktivna djelatnost, rezervacija ili uplata blokiraju automatski završetak brisanja. | Potvrditi odgovornu osobu, rok obrade zahtjeva, rokove čuvanja i objavljen tekst privatnosti prema stvarnoj praksi. Ne obećavati trenutno brisanje svih finansijskih zapisa. |
| Android identitet i objavljivač | Naziv paketa, domen, certifikat potpisivanja i Digital Asset Links moraju biti usklađeni s Play Console računom. Potpis aplikacije nije poznat iz izvornog koda. | Potvrditi package name, vlasnika Play Console naloga, kontakt podrške, sigurnu pohranu ključeva i ko je jedini objavljivač. Digital Asset Links koristi SHA-256 app-signing certifikata iz Play Consolea. |

Facebook integracija ostaje odložena. Ove odluke ne daju odobrenje za nove integracije, izmjenu cijena, finansijske transakcije ili objavu aplikacije.
