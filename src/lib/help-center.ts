import { accountSectionPath } from "./account-return";
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
    label: "Moja djelatnost",
    icon: "shop",
    question: "Kako da objavim djelatnost?",
    keywords: ["djelat", "preduz", "biznis"],
    answer:
      "U nalogu otvori Djelatnosti i odaberi dodavanje. Unesi grad, opis, kontakt i fotografije. Objava djelatnosti je besplatna.",
    links: [{ label: "Moje djelatnosti", href: "/nalog?odjeljak=djelatnosti" }],
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
      "Otvori Moji reels, odaberi djelatnost i dodaj snimak s naslovom koji objašnjava šta je na videu. Prikaži vlastiti rad ili uslugu koja je dostupna na profilu. Reel se prikazuje nakon odobrenja, najviše 24 sata; nakon toga se snimak i naslovnica brišu. Možeš ga povući i ranije.",
    links: [
      { label: "Moji reels", href: "/nalog/reels" },
      { label: "Pogledaj Reels", href: "/reels" },
    ],
  },
} as const;

export type HelpTopicId = keyof typeof helpTopics;
export type HelpTicketTopic = HelpTopicId | "ostalo";
export const helpTopicIds = Object.keys(helpTopics) as HelpTopicId[];

type HelpAnswer = {
  label: string;
  icon: (typeof helpTopics)[HelpTopicId]["icon"];
  question: string;
  answer: string;
  links: readonly { label: string; href: string }[];
};

export function helpTopicContent(id: HelpTopicId, playEdition = false): HelpAnswer {
  const topic = helpTopics[id];
  if (!playEdition) return topic;
  switch (id) {
    case "djelatnost":
      return {
        ...topic,
        label: "Moje djelatnosti",
        question: "Kako da dodam ili uredim djelatnost?",
        answer:
          "U nalogu otvori Djelatnosti i odaberi dodavanje. Unesi grad, opis, kontakt i fotografije. Objava djelatnosti je besplatna.",
        links: [{ label: "Moje djelatnosti", href: accountSectionPath("businesses") }],
      };
    default:
      return topic;
  }
}

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
  const parts = /^([a-z]+)--[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.exec(reference);
  return parts?.[1] === "ostalo" ? "ostalo" : helpTopic(parts?.[1]);
}

export function helpTicketLabel(reference: string) {
  const topic = helpTicketTopic(reference);
  return topic && topic !== "ostalo" ? helpTopics[topic].label : "Ostalo";
}
