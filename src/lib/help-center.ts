import { accountSectionPath } from "./account-return";
import { contentSearchKey, searchInput } from "./content-hub";
import { msg } from "./i18n/translate";

export const reportHelpPath = "/pomoc?tema=sigurnost";

export const helpTopics = {
  nalog: {
    label: msg("Pristup nalogu"),
    icon: "user",
    question: msg("Kako da vratim pristup nalogu?"),
    // Bosnian stems first; English, German and Turkish stems let other languages find the topic.
    keywords: [
      "prijav",
      "lozink",
      "sifr",
      "nalog",
      "registr",
      "potvrd",
      "email",
      "suspend",
      "password",
      "login",
      "account",
      "passwort",
      "anmeld",
      "konto",
      "sifre",
      "giris",
      "hesap",
    ],
    answer: msg(
      "Ako si zaboravio lozinku, zatraži novu na prijavi. Ako poruka za potvrdu ne stiže, provjeri neželjenu poštu i da li je adresa tačno unesena. Ako se prijavljuješ, a nalog čeka odobrenje, javi nam se i navedi adresu naloga.",
    ),
    links: [
      { label: msg("Zaboravljena lozinka"), href: "/zaboravljena-lozinka" },
      { label: msg("Idi na prijavu"), href: "/prijava" },
    ],
  },
  djelatnost: {
    label: msg("Moja djelatnost"),
    icon: "shop",
    question: msg("Kako da objavim djelatnost?"),
    keywords: ["djelat", "preduz", "biznis", "business", "betrieb", "firma", "isletme"],
    answer: msg(
      "U nalogu otvori Djelatnosti i odaberi dodavanje. Unesi grad, opis, kontakt i fotografije. Objava djelatnosti je besplatna.",
    ),
    links: [{ label: msg("Moje djelatnosti"), href: "/nalog?odjeljak=djelatnosti" }],
  },
  rezervacije: {
    label: msg("Booking i termini"),
    icon: "calendar",
    question: msg("Gdje mogu provjeriti ili promijeniti termin?"),
    keywords: [
      "booking",
      "rezerv",
      "termin",
      "otkaz",
      "dolazak",
      "najam",
      "nocenj",
      "zakaz",
      "appointment",
      "cancel",
      "reserv",
      "buchung",
      "storn",
      "randevu",
      "iptal",
    ],
    answer: msg(
      "U Mojim terminima možeš provjeriti status zahtjeva ili otkazati termin. Za drugi termin pošalji novi zahtjev na profilu djelatnosti. Ako ti nijedan termin ne odgovara, javi se djelatnosti kroz poruke.",
    ),
    links: [
      { label: msg("Moji termini"), href: "/nalog?odjeljak=termini" },
      { label: msg("Otvori poruke"), href: "/nalog?odjeljak=poruke" },
    ],
  },
  sigurnost: {
    label: msg("Sigurnost i privatnost"),
    icon: "shield",
    question: msg("Kako da prijavim sumnjiv sadržaj ili zaštitim nalog?"),
    keywords: [
      "sigurn",
      "privat",
      "prevar",
      "sumnj",
      "sadrzaj",
      "blok",
      "bris",
      "nezelj",
      "krad",
      "report",
      "delete",
      "scam",
      "block",
      "melden",
      "losch",
      "betrug",
      "guvenl",
      "sil",
      "engel",
    ],
    answer: msg(
      "Za prijavu sadržaja otvori opciju Prijavi na profilu, recenziji, Reelu ili razgovoru. Ako misliš da neko ima pristup tvom nalogu, promijeni lozinku i javi nam se. Za brisanje naloga otvori zaseban zahtjev.",
    ),
    links: [
      { label: msg("Zahtjev za brisanje naloga"), href: "/brisanje-naloga" },
      { label: msg("Privatnost"), href: "/privatnost" },
    ],
  },
  reels: {
    label: msg("Reels"),
    icon: "play",
    question: msg("Kako da objavim kratki video za svoju djelatnost?"),
    keywords: ["reels", "reel", "video", "story", "snim", "klip"],
    answer: msg(
      "Otvori Moji reels, odaberi djelatnost i dodaj snimak s naslovom koji objašnjava šta je na videu. Prikaži vlastiti rad ili uslugu koja je dostupna na profilu. Reel se prikazuje nakon odobrenja, najviše 24 sata; nakon toga se snimak i naslovnica brišu. Možeš ga povući i ranije.",
    ),
    links: [
      { label: msg("Moji reels"), href: "/nalog/reels" },
      { label: msg("Pogledaj Reels"), href: "/reels" },
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
        label: msg("Moje djelatnosti"),
        question: msg("Kako da dodam ili uredim djelatnost?"),
        answer: msg(
          "U nalogu otvori Djelatnosti i odaberi dodavanje. Unesi grad, opis, kontakt i fotografije. Objava djelatnosti je besplatna.",
        ),
        links: [{ label: msg("Moje djelatnosti"), href: accountSectionPath("businesses") }],
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
  return topic && topic !== "ostalo" ? helpTopics[topic].label : msg("Ostalo");
}
