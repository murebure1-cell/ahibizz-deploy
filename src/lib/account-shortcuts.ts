import { accountNotificationsPath, accountSectionPath } from "./account-return";
import { deviceNotificationSettingsPath } from "./activity";
export const accountShortcuts = {
  newBusiness: "/nalog?odjeljak=djelatnosti&novo=1",
  appointmentHistory: "/nalog?odjeljak=termini&prikaz=historija",
  savedSearches: "/sacuvane-pretrage",
  blocked: "/blokirani-korisnici",
  manageReels: "/nalog/reels",
  profile: accountSectionPath("profile"),
  businesses: accountSectionPath("businesses"),
  appointments: accountSectionPath("appointments"),
  saved: accountSectionPath("saved"),
  settings: accountSectionPath("settings"),
  notifications: accountNotificationsPath,
  notificationSettings: deviceNotificationSettingsPath,
} as const;
