import { accountNotificationsPath, accountSectionPath } from "./account-return";
import { deviceNotificationSettingsPath } from "./activity";
export const accountShortcuts = {
  newBusiness: "/nalog?odjeljak=djelatnosti&novo=1",
  appointmentHistory: "/nalog?odjeljak=termini&prikaz=historija",
  savedSearches: "/sacuvane-pretrage",
  blocked: "/blokirani-korisnici",
  activeAds: "/nalog?odjeljak=oglasi&prikaz=aktivne",
  scheduledAds: "/nalog?odjeljak=oglasi&prikaz=zakazane",
  manageReels: "/nalog/reels",
  profile: accountSectionPath("profile"),
  businesses: accountSectionPath("businesses"),
  appointments: accountSectionPath("appointments"),
  saved: accountSectionPath("saved"),
  ads: accountSectionPath("advertising"),
  credits: accountSectionPath("credits"),
  membership: accountSectionPath("membership"),
  settings: accountSectionPath("settings"),
  notifications: accountNotificationsPath,
  notificationSettings: deviceNotificationSettingsPath,
} as const;
