export const adDevices = ["mobile", "desktop"] as const;
export const adPages = ["home", "search", "category", "listing"] as const;
export type AdDevice = (typeof adDevices)[number];
export type AdPage = (typeof adPages)[number];
export const adDeviceNames: Record<AdDevice, string> = { mobile: "Telefon", desktop: "Računar" };
export const adPageNames: Record<AdPage, string> = {
  home: "Početna",
  search: "Pretraga",
  category: "Kategorija",
  listing: "Djelatnost",
};
export const adFormatIds = [
  "megaboard",
  "doublebillboard",
  "billboard",
  "leaderboard",
  "leaderboard2",
  "rectangle",
  "mobile_leaderboard",
  "branded_icon",
  "converger",
  "takeover",
  "roller",
  "sitebar",
  "slider",
  "catfisher",
  "slash",
  "reveal",
  "rotator",
  "carousel",
  "cube",
  "parallaxer",
  "loan_calculator",
  "lead_form",
] as const;
export type AdFormatId = (typeof adFormatIds)[number];
export type AdPosition = "top" | "inline" | "side" | "bottom" | "overlay" | "icon";
export type AdFormatPlacement = {
  page: AdPage;
  device: AdDevice;
  width: number;
  height: number;
  defaultCpmMinor: number | null;
  position: AdPosition;
};
export type AdFormat = {
  id: AdFormatId;
  title: string;
  description: string;
  family: "standard" | "creative" | "custom";
  placements: AdFormatPlacement[];
};

function place(
  page: AdPage,
  device: AdDevice,
  width: number,
  height: number,
  position: AdPosition,
  cpmBam: number | null,
): AdFormatPlacement {
  return {
    page,
    device,
    width,
    height,
    position,
    defaultCpmMinor: cpmBam === null ? null : cpmBam * 100,
  };
}

function desktopStandard(
  id: AdFormatId,
  title: string,
  description: string,
  width: number,
  height: number,
  homeCpm: number,
  searchCpm: number,
): AdFormat {
  return {
    id,
    title,
    description,
    family: "standard",
    placements: [
      place("home", "desktop", width, height, "top", homeCpm),
      place("search", "desktop", width, height, "top", searchCpm),
    ],
  };
}

function creative(
  id: AdFormatId,
  title: string,
  description: string,
  placements: AdFormatPlacement[],
): AdFormat {
  return { id, title, description, family: "creative", placements };
}

function belowCategories(cpm: number) {
  return [
    place("home", "desktop", 980, 250, "inline", cpm),
    place("home", "mobile", 300, 250, "inline", cpm),
  ];
}

export const adFormats: AdFormat[] = [
  desktopStandard("megaboard", "Megaboard", "Velika fotografija iznad sadržaja.", 980, 500, 28, 20),
  desktopStandard(
    "doublebillboard",
    "Doublebillboard",
    "Široki baner s prostorom za fotografiju i ponudu.",
    980,
    250,
    14,
    12,
  ),
  desktopStandard(
    "billboard",
    "Billboard",
    "Uski vodoravni baner iznad rezultata ili djelatnosti.",
    980,
    100,
    12,
    10,
  ),
  desktopStandard(
    "leaderboard",
    "Leaderboard",
    "Kompaktni baner na vrhu stranice.",
    728,
    90,
    10,
    8,
  ),
  {
    id: "leaderboard2",
    title: "Leaderboard 2",
    description: "Prošireni baner na poslovnom profilu.",
    family: "standard",
    placements: [place("listing", "desktop", 830, 200, "inline", null)],
  },
  {
    id: "rectangle",
    title: "Rectangle",
    description: "Pravougaoni oglas unutar sadržaja.",
    family: "standard",
    placements: [
      place("home", "mobile", 300, 250, "inline", 8),
      place("search", "mobile", 300, 250, "inline", null),
      place("category", "mobile", 300, 250, "inline", null),
      place("category", "desktop", 300, 250, "side", null),
      place("listing", "desktop", 300, 250, "side", null),
      place("listing", "mobile", 300, 250, "inline", null),
    ],
  },
  {
    id: "mobile_leaderboard",
    title: "Mobilni baner",
    description: "Vodoravni baner na telefonu, iznad liste djelatnosti.",
    family: "standard",
    placements: [
      place("home", "mobile", 320, 100, "top", 6),
      place("category", "mobile", 320, 100, "top", null),
      place("search", "mobile", 320, 100, "top", null),
    ],
  },
  {
    id: "branded_icon",
    title: "Ikonica brenda",
    description: "Logo oglašivača u redu kategorija na početnoj.",
    family: "custom",
    placements: [
      place("home", "mobile", 96, 96, "icon", null),
      place("home", "desktop", 96, 96, "icon", null),
    ],
  },
  creative("converger", "Converger", "Dva panela s lijeve i desne strane spajaju se u sredini.", [
    place("home", "desktop", 1200, 800, "overlay", 120),
  ]),
  creative("takeover", "Takeover", "Veliki oglas preko sadržaja, s dugmetom za zatvaranje.", [
    place("home", "desktop", 600, 600, "overlay", 100),
  ]),
  creative("roller", "Roller", "Vodoravna traka uz donju ivicu prozora.", [
    place("home", "desktop", 728, 90, "bottom", 45),
  ]),
  creative("sitebar", "Sitebar", "Visoki baner uz rezultate, kategoriju ili poslovni profil.", [
    place("search", "desktop", 300, 600, "side", 40),
    place("category", "desktop", 300, 600, "side", 40),
    place("listing", "desktop", 300, 600, "side", 40),
  ]),
  creative("slider", "Slider", "Bočni baner koji prati pomjeranje stranice.", [
    place("listing", "desktop", 300, 600, "side", 40),
  ]),
  creative("catfisher", "Catfisher", "Središnja traka pri dnu ekrana s opcijom zatvaranja.", [
    place("home", "desktop", 728, 90, "bottom", 40),
  ]),
  creative("slash", "Slash", "Dijagonalni prijelaz između dvije slike.", belowCategories(15)),
  creative("reveal", "Reveal", "Prvi kadar otkriva drugi kadar.", belowCategories(15)),
  creative(
    "rotator",
    "Rotator",
    "Slike kampanje smjenjuju se u istom prostoru.",
    belowCategories(15),
  ),
  creative("carousel", "Carousel", "Kartice kampanje listaju se vodoravno.", [
    place("home", "desktop", 980, 250, "inline", 15),
  ]),
  creative("cube", "Cube", "Sadržaj se prikazuje na različitim stranama kocke.", [
    place("listing", "desktop", 300, 250, "side", 12),
    place("home", "mobile", 300, 250, "inline", 12),
  ]),
  creative(
    "parallaxer",
    "Parallaxer",
    "Slika se pomjera dok posjetilac prolazi kroz poslovni profil.",
    [place("listing", "desktop", 830, 800, "inline", 12)],
  ),
  {
    id: "loan_calculator",
    title: "Kreditni kalkulator",
    description: "Posjetilac bira iznos i rok otplate te vidi procjenu mjesečne rate.",
    family: "custom",
    placements: [
      place("listing", "desktop", 600, 400, "inline", null),
      place("listing", "mobile", 320, 400, "inline", null),
    ],
  },
  {
    id: "lead_form",
    title: "Obrazac za upit",
    description: "Posjetilac može zatražiti ponudu direktno od oglašivača.",
    family: "custom",
    placements: [
      place("listing", "desktop", 600, 400, "inline", null),
      place("listing", "mobile", 320, 400, "inline", null),
    ],
  },
];

export function adFormatById(id: string): AdFormat | undefined {
  return adFormats.find((format) => format.id === id);
}

export function getAdPlacement(
  formatId: string,
  page: string,
  device: string,
): AdFormatPlacement | undefined {
  return adFormatById(formatId)?.placements.find(
    (placement) => placement.page === page && placement.device === device,
  );
}
