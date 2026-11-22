import { contentSearchKey, searchInput } from "./content-hub";

export const reportHelpPath = "/pomoc?tema=sigurnost";

export const helpTopics = {
  nalog: {
    label: "Pristup nalogu",
    icon: "user",
    question: "Kako da vratim pristup nalogu?",
    keywords: ["prijav", "lozink", "sifr", "nalog", "registr", "potvrd", "email", "suspend"],
    answer:
      "Ako si zaboravio lozinku, zatraži novu na prijavi. Ako poruka za potvrdu ne stiže, provjeri neželjenu poštu i da li je adresa tačno unesena. Ako se prijavljuješ, a nalog čeka odobrenje, javi nam se i navedi adresu naloga.",
    links: [
      { label: "Zaboravljena lozinka", href: "/zaboravljena-lozinka" },
      { label: "Idi na prijavu", href: "/prijava" },
    ],
  },
  djelatnost: {
    label: "Djelatnost i oglasi",
    icon: "shop",
    question: "Kako da objavim ili istaknem djelatnost?",
    keywords: ["djelat", "oglas", "istak", "kampanj", "marketing", "promoc", "preduz", "biznis"],
    answer:
      "U nalogu otvori Djelatnosti i odaberi dodavanje. Unesi grad, opis, kontakt i fotografije. Za promociju postojećeg profila pregledaj dostupne pozicije i pošalji zahtjev za ponudu.",
    links: [
      { label: "Moje djelatnosti", href: "/nalog?odjeljak=djelatnosti" },
      { label: "Pozicije za oglašavanje", href: "/oglasavanje" },
    ],
  },
  rezervacije: {
    label: "Booking i termini",
    icon: "calendar",
    question: "Gdje mogu provjeriti ili promijeniti termin?",
    keywords: ["booking", "rezerv", "termin", "otkaz", "dolazak", "najam", "nocenj", "zakaz"],
    answer:
      "U Mojim terminima možeš provjeriti status zahtjeva ili otkazati termin. Za drugi termin pošalji novi zahtjev na profilu djelatnosti. Ako ti nijedan termin ne odgovara, javi se djelatnosti kroz poruke.",
    links: [
      { label: "Moji termini", href: "/nalog?odjeljak=termini" },
      { label: "Otvori poruke", href: "/nalog?odjeljak=poruke" },
    ],
  },
  naplata: {
    label: "Naplata i paketi",
    icon: "card",
    question: "Kako da provjerim uplatu ili svoj paket?",
    keywords: [
      "kredit",
      "paket",
      "naplat",
      "uplat",
      "racun",
      "kartic",
      "paypal",
      "plac",
      "pretplat",
    ],
    answer:
      "U nalogu provjeri trenutno članstvo i stanje Ahi kredita. Ako se uplata ne vidi, u zahtjevu podršci navedi iznos, približno vrijeme uplate i oznaku narudžbe ako je imaš.",
    links: [
      { label: "Pregled paketa", href: "/paketi" },
      { label: "Moj nalog", href: "/nalog" },
    ],
  },
  sigurnost: {
    label: "Sigurnost i privatnost",
    icon: "shield",
    question: "Kako da prijavim sumnjiv sadržaj ili zaštitim nalog?",
    keywords: ["sigurn", "privat", "prevar", "sumnj", "sadrzaj", "blok", "bris", "nezelj", "krad"],
    answer:
      "Za prijavu sadržaja otvori opciju Prijavi na profilu, recenziji, Reelu ili razgovoru. Ako misliš da neko ima pristup tvom nalogu, promijeni lozinku i javi nam se. Za brisanje naloga otvori zaseban zahtjev.",
    links: [
      { label: "Zahtjev za brisanje naloga", href: "/brisanje-naloga" },
      { label: "Privatnost", href: "/privatnost" },
    ],
  },
  reels: {
    label: "Reels",
    icon: "play",
    question: "Kako da objavim kratki video za svoju djelatnost?",
    keywords: ["reels", "reel", "video", "story", "snim", "klip"],
    answer:
      "Otvori Moji reels, odaberi djelatnost i dodaj snimak s naslovom koji objašnjava šta je na videu. Prikaži vlastiti rad ili uslugu koja je dostupna na profilu. Reel se prikazuje nakon odobrenja.",
    links: [
      { label: "Moji reels", href: "/nalog/reels" },
      { label: "Pogledaj Reels", href: "/reels" },
    ],
  },
} as const;

export type HelpTopicId = keyof typeof helpTopics;
export type HelpTicketTopic = HelpTopicId | "ostalo";
export const helpTopicIds = Object.keys(helpTopics) as HelpTopicId[];

export function helpTopic(value: unknown): HelpTopicId | null {
  return typeof value === "string" && Object.hasOwn(helpTopics, value)
    ? (value as HelpTopicId)
    : null;
}

export function matchHelpTopic(query: string): HelpTopicId | null {
  const words = contentSearchKey(searchInput(query))
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const matches = helpTopicIds
    .map((id) => ({
      id,
      count: helpTopics[id].keywords.filter((key) => words.some((word) => word.startsWith(key)))
        .length,
    }))
    .sort((a, b) => b.count - a.count);
  const best = matches[0];
  return best && best.count > (matches[1]?.count ?? 0) ? best.id : null;
}

export function helpTicketTopic(reference: string): HelpTicketTopic | null {
  if (packageSupportContractId(reference)) return "naplata";
  const parts = /^([a-z]+)--[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.exec(reference);
  return parts?.[1] === "ostalo" ? "ostalo" : helpTopic(parts?.[1]);
}

export function packageSupportContractId(reference: unknown) {
  if (typeof reference !== "string") return null;
  return (
    /^ugovor--([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i
      .exec(reference)?.[1]
      ?.toLowerCase() ?? null
  );
}

export function helpTicketLabel(reference: string) {
  const topic = helpTicketTopic(reference);
  return topic && topic !== "ostalo" ? helpTopics[topic].label : "Ostalo";
}
