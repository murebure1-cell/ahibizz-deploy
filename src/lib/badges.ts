/**
 * Bedževi, as drawn: earned by what a person does on AhiBizz. They are never bought and never
 * come with a package. Each is counted from what the database already holds; two drawn badges
 * ("Brz odgovor", "Čuvar zajednice") are left out until there is an honest way to count them.
 */
export type BadgeCounts = {
  /** Place among all accounts by the day of joining, 1 for the first. */
  rank: number;
  joinedAt: string;
  /** A photo, a description and a town on the personal profile. */
  profileComplete: boolean;
  reviews: number;
  reviewedCategories: number;
  /** The most people who saved one of the person's own businesses. */
  saves: number;
  /** One of the person's businesses averages 4.7 or more over at least 20 reviews. */
  topRated: boolean;
  /** Appointments the person asked for through AhiBizz that were held. */
  visits: number;
};

export type Badge = {
  id: "early" | "profile" | "reviewer" | "guide" | "favourite" | "year" | "top" | "punctual";
  earned: boolean;
  /** How far along, for badges that are counted; absent for yes-or-no badges. */
  progress?: number;
  goal?: number;
};

const counted = (id: Badge["id"], progress: number, goal: number): Badge => ({
  id,
  earned: progress >= goal,
  progress: Math.min(progress, goal),
  goal,
});

export function badgesFrom(counts: BadgeCounts, now = new Date()): Badge[] {
  const year = new Date(counts.joinedAt);
  year.setUTCFullYear(year.getUTCFullYear() + 1);
  return [
    { id: "early", earned: counts.rank >= 1 && counts.rank <= 1000 },
    { id: "profile", earned: counts.profileComplete },
    counted("reviewer", counts.reviews, 10),
    counted("guide", counts.reviewedCategories, 5),
    counted("favourite", counts.saves, 50),
    { id: "year", earned: year.getTime() <= now.getTime() },
    { id: "top", earned: counts.topRated },
    counted("punctual", counts.visits, 20),
  ];
}
