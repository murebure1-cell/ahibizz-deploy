import { accountSectionPath } from "../../lib/account-return";
import { adminSectionPath } from "../../lib/admin-navigation";
import { type CalendarKind, ownerCalendarPath } from "../../lib/business-today";
import { emailContent } from "../auth/mail";
import { renderAhiEmail } from "./layout";

type MailExample = Readonly<{
  id: string;
  label: string;
  group: string;
  active: boolean;
  render: (origin: string) => ReturnType<typeof renderAhiEmail>;
}>;

const demoId = "00000000-0000-4000-8000-000000000001";
const demoRecipient = "primjer@example.invalid";

function accountExample(
  id: "verification" | "account-approved" | "password-reset",
  label: string,
  path: string,
): MailExample {
  return {
    id,
    label,
    group: "Nalog",
    active: true,
    render(origin) {
      const url = new URL(path, origin).href;
      return id === "account-approved"
        ? emailContent({ kind: id, to: demoRecipient, url, decisionId: demoId })
        : emailContent({ kind: id, to: demoRecipient, url });
    },
  };
}

type Detail = { label: string; value: string };
type PreviewAction = { actionLabel: string; path: string; recipient?: string };

function preview(
  id: string,
  group: string,
  label: string,
  intro: string,
  action: PreviewAction,
  details?: Detail[],
): MailExample {
  return {
    id,
    group,
    label: action.recipient ? `${action.recipient} · ${label}` : label,
    active: false,
    render(origin) {
      return renderAhiEmail({
        subject: `${label} — AhiBizz`,
        title: label,
        intro,
        actionLabel: action.actionLabel,
        url: new URL(action.path, origin).href,
        details,
      });
    },
  };
}

type BookingSample = {
  kind: CalendarKind;
  group: string;
  request: string;
  confirmed: string;
  declined: string;
  cancelled: string;
  customerRole: string;
  details: Detail[];
};

const bookings: BookingSample[] = [
  {
    kind: "service",
    group: "Termini",
    request: "Novi zahtjev za termin",
    confirmed: "Termin je potvrđen",
    declined: "Zahtjev za termin je odbijen",
    cancelled: "Termin je otkazan",
    customerRole: "Korisnik",
    details: [
      { label: "Djelatnost", value: "Studio Primjer" },
      { label: "Usluga", value: "Klasična masaža" },
      { label: "Termin", value: "18. juna 2027. od 10:00 do 10:45" },
    ],
  },
  {
    kind: "rental",
    group: "Najam vozila",
    request: "Novi zahtjev za najam vozila",
    confirmed: "Najam je potvrđen",
    declined: "Zahtjev za najam je odbijen",
    cancelled: "Najam je otkazan",
    customerRole: "Korisnik",
    details: [
      { label: "Vozilo", value: "Gradski automobil" },
      { label: "Preuzimanje", value: "18. juna 2027. u 09:00" },
      { label: "Vraćanje", value: "20. juna 2027. u 15:00" },
    ],
  },
  {
    kind: "stay",
    group: "Smještaj",
    request: "Novi zahtjev za smještaj",
    confirmed: "Boravak je potvrđen",
    declined: "Zahtjev za smještaj je odbijen",
    cancelled: "Boravak je otkazan",
    customerRole: "Gost",
    details: [
      { label: "Smještaj", value: "Apartman Jutro" },
      { label: "Dolazak", value: "18. juna 2027." },
      { label: "Odlazak", value: "20. juna 2027." },
    ],
  },
];

function bookingExamples(sample: BookingSample): MailExample[] {
  const { kind, group, details } = sample;
  const appointments = {
    recipient: sample.customerRole,
    actionLabel: "Moji termini",
    path: accountSectionPath("appointments"),
  };
  const owner = {
    recipient: "Vlasnik",
    actionLabel: "Otvori kalendar",
    path: ownerCalendarPath({ kind, businessId: demoId }),
  };
  return [
    preview(
      `${kind}-owner-requested`,
      group,
      sample.request,
      "U kalendaru možeš pregledati zahtjev, potvrditi ga ili odbiti.",
      owner,
      details,
    ),
    preview(
      `${kind}-customer-requested`,
      group,
      "Zahtjev je poslan vlasniku",
      "Zahtjev je zaprimljen i čeka potvrdu vlasnika.",
      appointments,
      details,
    ),
    preview(
      `${kind}-customer-confirmed`,
      group,
      sample.confirmed,
      "Vlasnik je potvrdio tvoj zahtjev.",
      appointments,
      details,
    ),
    preview(
      `${kind}-customer-declined`,
      group,
      sample.declined,
      "Vlasnik je odbio tvoj zahtjev.",
      appointments,
      details,
    ),
    preview(
      `${kind}-customer-cancelled`,
      group,
      sample.cancelled,
      "Vlasnik je otkazao prethodno potvrđeni termin.",
      appointments,
      details,
    ),
    preview(
      `${kind}-owner-cancelled`,
      group,
      `${sample.customerRole} je otkazao termin`,
      "Otkazivanje je zabilježeno u tvom kalendaru.",
      owner,
      details,
    ),
    ...(kind === "service"
      ? [
          preview(
            "service-customer-completed",
            group,
            "Termin je održan",
            "Vlasnik je označio termin kao održan.",
            appointments,
            details,
          ),
        ]
      : []),
  ];
}

const businesses = {
  recipient: "Vlasnik",
  actionLabel: "Moje djelatnosti",
  path: accountSectionPath("businesses"),
};
const queue = {
  recipient: "Administrator",
  actionLabel: "Pregledaj djelatnosti",
  path: adminSectionPath("businessQueue"),
};
const packages = { actionLabel: "Moje pretplate", path: accountSectionPath("membership") };
const profile = { actionLabel: "Moj profil", path: accountSectionPath("profile") };
const advertising = { actionLabel: "Moji oglasi", path: accountSectionPath("advertising") };
const credits = { actionLabel: "Moji krediti", path: accountSectionPath("credits") };
const contacts = { actionLabel: "Moji prijatelji", path: accountSectionPath("connections") };
const supportQueue = {
  recipient: "Administrator",
  actionLabel: "Otvori zahtjeve",
  path: "/administracija/zahtjevi",
};
const rules = {
  recipient: "Korisnik",
  actionLabel: "Pravila zajednice",
  path: "/pravila-zajednice",
};
const order = { actionLabel: "Otvori narudžbu", path: `/naplata?narudzba=${demoId}` };
const businessDetails = [{ label: "Djelatnost", value: "Studio Primjer" }];
const correctionDetails = [
  ...businessDetails,
  { label: "Razlog", value: "Dopuni adresu djelatnosti." },
];
const promotion = [{ label: "Usluga", value: "Isticanje djelatnosti na 7 dana" }];
const businessPlan = [
  { label: "Paket", value: "Poslovni" },
  { label: "Način plaćanja", value: "Mjesečno" },
];

export const mailExamples: readonly MailExample[] = [
  accountExample(
    "verification",
    "Potvrda email adrese",
    "/api/auth/verify-email?token=primjer-nevazeci",
  ),
  accountExample("account-approved", "Odobrenje naloga", "/prijava"),
  accountExample(
    "password-reset",
    "Promjena lozinke",
    "/api/auth/reset-password/primjer-nevazeci?callbackURL=%2Fnova-lozinka",
  ),
  ...bookings.flatMap(bookingExamples),
  preview(
    "business-submitted",
    "Djelatnosti",
    "Djelatnost čeka pregled",
    "Vlasnik je poslao djelatnost na pregled.",
    queue,
    businessDetails,
  ),
  preview(
    "business-published",
    "Djelatnosti",
    "Djelatnost je objavljena",
    "Posjetioci sada mogu otvoriti tvoj poslovni profil.",
    businesses,
    businessDetails,
  ),
  preview(
    "business-changes-approved",
    "Djelatnosti",
    "Izmjene su objavljene",
    "Odobrene izmjene sada su vidljive na poslovnom profilu.",
    businesses,
    businessDetails,
  ),
  preview(
    "business-changes-declined",
    "Djelatnosti",
    "Izmjene su odbijene",
    "Pregledaj razlog i uredi djelatnost.",
    businesses,
    correctionDetails,
  ),
  preview(
    "business-draft",
    "Djelatnosti",
    "Djelatnost je vraćena u nacrt",
    "Dopuni podatke i pošalji djelatnost ponovo na pregled.",
    businesses,
    correctionDetails,
  ),
  preview(
    "business-inquiry",
    "Poruke",
    "Novi poslovni upit",
    "Primili ste novi upit za vaš oglas na AhiBizz platformi.",
    { recipient: "Vlasnik", actionLabel: "Vidi sve upite", path: accountSectionPath("messages") },
    businessDetails,
  ),
  preview(
    "business-assigned",
    "Djelatnosti",
    "Dodijeljena ti je djelatnost",
    "Sada možeš urediti poslovni profil u odjeljku Moje djelatnosti.",
    businesses,
    businessDetails,
  ),
  preview(
    "person-verified",
    "Verifikacija",
    "Tvoj lični profil je verificiran",
    "Administrator je provjerio profil i dodijelio oznaku verifikacije.",
    profile,
  ),
  preview(
    "person-badge-removed",
    "Verifikacija",
    "Oznaka ličnog profila je povučena",
    "Administrator je povukao oznaku verifikacije s tvog ličnog profila.",
    profile,
  ),
  preview(
    "business-verified",
    "Verifikacija",
    "Tvoja djelatnost je verificirana",
    "Administrator je provjerio djelatnost i dodijelio oznaku verifikacije.",
    businesses,
    businessDetails,
  ),
  preview(
    "business-badge-removed",
    "Verifikacija",
    "Oznaka djelatnosti je povučena",
    "Administrator je povukao oznaku verifikacije s poslovnog profila.",
    businesses,
    businessDetails,
  ),
  preview(
    "connection-requested",
    "Prijatelji",
    "Novi zahtjev za prijateljstvo",
    "Imaš zahtjev za prijateljstvo. Možeš ga pregledati u svom nalogu.",
    contacts,
  ),
  preview(
    "connection-accepted",
    "Prijatelji",
    "Zahtjev za prijateljstvo je prihvaćen",
    "Sada ste prijatelji.",
    contacts,
  ),
  preview("direct-message", "Poruke", "Nova privatna poruka", "U tvom razgovoru je nova poruka.", {
    actionLabel: "Otvori poruke",
    path: accountSectionPath("messages"),
  }),
  preview(
    "advertising-requested",
    "Oglasi i produkcija",
    "Novi zahtjev za ponudu",
    "Vlasnik djelatnosti zatražio je ponudu za prikaz oglasa.",
    { recipient: "Administrator", actionLabel: "Otvori zahtjeve", path: "/administracija/oglasi" },
    [...businessDetails, { label: "Mjesto prikaza", value: "Baner na početnoj" }],
  ),
  preview(
    "advertising-quoted",
    "Oglasi i produkcija",
    "Ponuda za oglas je spremna",
    "Cijenu i upute za uplatu možeš pregledati u svom nalogu.",
    advertising,
    [...businessDetails, { label: "Trajanje prikaza", value: "7 dana" }],
  ),
  preview(
    "advertising-scheduled",
    "Oglasi i produkcija",
    "Dogovoren je prikaz oglasa",
    "U svojim oglasima možeš pregledati period isticanja.",
    advertising,
    [...businessDetails, { label: "Period prikaza", value: "Od 18. do 25. juna 2027." }],
  ),
  preview(
    "production-quoted",
    "Oglasi i produkcija",
    "Ponuda za foto i video je spremna",
    "Pregledaj opis usluge, cijenu i upute za uplatu.",
    advertising,
    businessDetails,
  ),
  preview(
    "credits-quoted",
    "Ahi Credits",
    "Ponuda za dopunu kredita",
    "U svom nalogu možeš pregledati cijenu tražene dopune.",
    credits,
    [{ label: "Broj kredita", value: "50" }],
  ),
  preview(
    "credits-added",
    "Ahi Credits",
    "Krediti su dodani",
    "Dopuna je evidentirana. Novo stanje dostupno je u tvom nalogu.",
    credits,
    [{ label: "Dodano kredita", value: "50" }],
  ),
  preview(
    "support-reported",
    "Podrška",
    "Prijava sadržaja je zaprimljena",
    "Prijava je dostavljena administratoru.",
    rules,
    [{ label: "Predmet prijave", value: "Recenzija" }],
  ),
  preview(
    "support-admin-report",
    "Podrška",
    "Nova prijava sadržaja",
    "Prijava čeka pregled u administraciji.",
    supportQueue,
    [{ label: "Predmet prijave", value: "Recenzija" }],
  ),
  preview(
    "support-reviewed",
    "Podrška",
    "Prijava sadržaja je obrađena",
    "Administrator je označio tvoju prijavu kao obrađenu.",
    rules,
  ),
  preview(
    "deletion-requested",
    "Podrška",
    "Zahtjev za brisanje naloga je zaprimljen",
    "Zahtjev za brisanje je zaprimljen. Administrator će provjeriti vlasništvo nad nalogom.",
    { actionLabel: "Podaci o brisanju naloga", path: "/brisanje-naloga" },
  ),
  preview(
    "payment-captured",
    "Uplate",
    "Uplata je potvrđena",
    "Isticanje djelatnosti važi do 25. juna 2027.",
    order,
    [...promotion, { label: "Plaćeni iznos", value: "5,11 EUR" }],
  ),
  preview(
    "payment-review",
    "Uplate",
    "Uplata zahtijeva provjeru",
    "Ne plaćaj ponovo za ovu narudžbu. Njen status možeš provjeriti u aplikaciji.",
    order,
    promotion,
  ),
  preview(
    "payment-void",
    "Uplate",
    "Narudžba je stornirana",
    "Nije izvršena naplata.",
    order,
    promotion,
  ),
  preview(
    "payment-adjusted",
    "Uplate",
    "Uplata je korigovana",
    "Povrat je evidentiran u narudžbi.",
    order,
    [...promotion, { label: "Iznos povrata", value: "5,11 EUR" }],
  ),
  preview(
    "membership-active",
    "Pretplate",
    "Pretplata je aktivna",
    "Paket i podatke o ugovoru možeš pregledati u svom nalogu.",
    packages,
    businessPlan,
  ),
  preview(
    "membership-renewed",
    "Pretplate",
    "Mjesečna uplata je evidentirana",
    "U evidenciji pretplate zabilježena je nova mjesečna uplata.",
    packages,
    [...businessPlan, { label: "Ugovorena mjesečna rata", value: "49 KM" }],
  ),
  preview(
    "membership-annual-paid",
    "Pretplate",
    "Godišnja uplata je evidentirana",
    "Godišnja uplata je zabilježena. Period paketa možeš provjeriti u svom nalogu.",
    packages,
    [
      { label: "Paket", value: "Poslovni" },
      { label: "Način plaćanja", value: "Godišnje · jedna uplata" },
      { label: "Ugovoreni godišnji iznos", value: "490 KM" },
    ],
  ),
  preview(
    "membership-paused",
    "Pretplate",
    "Pretplata je pauzirana",
    "Trenutni status i podatke o naplati možeš pregledati u svojim pretplatama.",
    packages,
    businessPlan,
  ),
  preview(
    "membership-cancelled",
    "Pretplate",
    "Automatska naplata je otkazana",
    "U svom nalogu možeš pregledati stanje ugovora i dosadašnje uplate.",
    packages,
    businessPlan,
  ),
  preview(
    "membership-completed",
    "Pretplate",
    "Raspored naplate je završen",
    "Pregled uplata i podatke o ugovoru možeš pronaći u svojim pretplatama.",
    packages,
    businessPlan,
  ),
];
