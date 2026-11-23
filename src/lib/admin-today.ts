export const adminQueues = [
  {
    id: "accounts",
    title: "Nalozi za odobrenje",
    href: "/administracija?odjeljak=odobrenja",
    icon: "user",
  },
  {
    id: "businesses",
    title: "Djelatnosti i izmjene",
    href: "/administracija?odjeljak=pregled",
    icon: "shop",
  },
  { id: "reports", title: "Zahtjevi i prijave", href: "/administracija/zahtjevi", icon: "shield" },
  {
    id: "promotions",
    title: "Isticanja na ?ekanju",
    href: "/administracija/isticanja",
    icon: "star",
  },
] as const;

export type AdminQueueId = (typeof adminQueues)[number]["id"];
export type AdminTodayRow = { id: AdminQueueId; count: number; oldestAt: string | null };
export function readAdminToday(value: unknown): AdminTodayRow[] {
  if (!Array.isArray(value) || value.length !== adminQueues.length)
    throw new Error("Invalid admin summary");
  return adminQueues.map(({ id }) => {
    const row = value.find((item) => item?.id === id);
    if (
      !row ||
      !Number.isSafeInteger(row.count) ||
      row.count < 0 ||
      (row.count === 0
        ? row.oldestAt !== null
        : typeof row.oldestAt !== "string" || !Number.isFinite(Date.parse(row.oldestAt)))
    )
      throw new Error("Invalid admin queue");
    return { id, count: row.count, oldestAt: row.oldestAt };
  });
}
