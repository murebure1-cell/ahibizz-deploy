export const workStatusLabels = {
  not_specified: "Nije odabrano",
  employed: "Zaposlen/a",
  self_employed: "Samostalni rad",
  business_owner: "Vlasnik/ca djelatnosti",
  student: "Student/ica",
  seeking_work: "Tražim posao",
  open_to_collaboration: "Otvoren/a za saradnju",
} as const;
export type WorkStatus = keyof typeof workStatusLabels;
export const profileCountries = [
  ["BA", "Bosna i Hercegovina"],
  ["HR", "Hrvatska"],
  ["RS", "Srbija"],
  ["ME", "Crna Gora"],
  ["SI", "Slovenija"],
  ["MK", "Sjeverna Makedonija"],
  ["AL", "Albanija"],
  ["AT", "Austrija"],
  ["DE", "Njemačka"],
  ["CH", "Švicarska"],
  ["TR", "Turska"],
  ["NL", "Nizozemska"],
  ["BE", "Belgija"],
  ["LU", "Luksemburg"],
  ["SE", "Švedska"],
  ["NO", "Norveška"],
  ["DK", "Danska"],
  ["FI", "Finska"],
  ["FR", "Francuska"],
  ["IT", "Italija"],
  ["ES", "Španija"],
  ["GB", "Ujedinjeno Kraljevstvo"],
  ["US", "Sjedinjene Američke Države"],
  ["CA", "Kanada"],
  ["AU", "Australija"],
  ["SA", "Saudijska Arabija"],
  ["AE", "Ujedinjeni Arapski Emirati"],
  ["QA", "Katar"],
  ["KW", "Kuvajt"],
  ["EG", "Egipat"],
] as const;
export type PersonalProfileFields = {
  name: string;
  birthDate: string | null;
  city: string | null;
  countryCode: string | null;
  bio: string | null;
  skills: string[];
  workStatus: WorkStatus;
};
export type PersonalProfile = PersonalProfileFields & {
  id: string;
  version: number;
  photoVersion: number | null;
  coverVersion: number | null;
  canCustomizeCover: boolean;
};
export type ProfileImageKind = "photo" | "cover";
export function profileImageUrl(profile: PersonalProfile, kind: ProfileImageKind): string | null {
  const version =
    kind === "photo"
      ? profile.photoVersion
      : profile.canCustomizeCover
        ? profile.coverVersion
        : null;
  return version === null ? null : `/api/people/me/media/${kind}?v=${version}`;
}

const countries = new Set(
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(
    " ",
  ),
);
export function isProfileCountryCode(value: unknown): value is string {
  return typeof value === "string" && countries.has(value);
}
