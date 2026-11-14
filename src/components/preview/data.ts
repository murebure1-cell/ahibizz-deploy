// Isolated design fixtures. Never seed these into the business database.
export type PreviewBusiness = {
  id: string;
  name: string;
  category: string;
  location: string;
  image: string;
  imageAlt: string;
  monogram: string;
  line: string;
};

export const previewBusinesses: PreviewBusiness[] = [
  {
    id: "forma",
    name: "Studio Forma",
    category: "Ljepota i zdravlje",
    location: "Tuzla",
    image: "/preview/studio.webp",
    imageAlt: "Svijetao prostor za odmor s prirodnim materijalima",
    monogram: "f.",
    line: "Masaže · Njega · Opuštanje",
  },
  {
    id: "dom",
    name: "Dom & detalj",
    category: "Dom i uređenje",
    location: "Sarajevo",
    image: "/preview/home.webp",
    imageAlt: "Topao dnevni boravak s drvenim namještajem",
    monogram: "d.",
    line: "Namještaj · Uređenje prostora",
  },
  {
    id: "kafa",
    name: "Kafa u komšiluku",
    category: "Hrana i piće",
    location: "Tuzla",
    image: "/preview/cafe.webp",
    imageAlt: "Ugodan restoran s drvenim stolovima",
    monogram: "k.",
    line: "Kafa · Doručak · Dobra pauza",
  },
  {
    id: "selidbe",
    name: "Selidbe Polako",
    category: "Servisi i usluge",
    location: "Zenica",
    image: "/preview/service.webp",
    imageAlt: "Priprema kutija za selidbu",
    monogram: "p.",
    line: "Selidbe · Prijevoz · Pomoć",
  },
];
