// Generates the AhiBizz Trusted Web Activity project outside the app repository.
import { ConsoleLog, TwaGenerator, TwaManifest } from "@bubblewrap/core";

const [target] = process.argv.slice(2);
// Icons are identical on every host; app.ahibizz.com is not live yet, so they are read from the web host.
const iconHost = "https://ahibizz-deploy.octadeploy.com";
const manifest = new TwaManifest({
  packageId: "com.ahibizz.app",
  host: "app.ahibizz.com",
  name: "AhiBizz",
  launcherName: "AhiBizz",
  display: "standalone",
  orientation: "portrait",
  themeColor: "#142C40",
  themeColorDark: "#142C40",
  navigationColor: "#142C40",
  navigationColorDark: "#142C40",
  navigationDividerColor: "#142C40",
  navigationDividerColorDark: "#142C40",
  backgroundColor: "#F8F9F6",
  splashScreenFadeOutDuration: 300,
  enableNotifications: true,
  startUrl: "/?source=pwa",
  iconUrl: `${iconHost}/app-icons/icon-512.png`,
  maskableIconUrl: `${iconHost}/app-icons/maskable-512.png`,
  // Switch to https://app.ahibizz.com/app.webmanifest once that host serves the Play build.
  webManifestUrl: `${iconHost}/app.webmanifest`,
  // The JSON field for versionName is appVersion.
  appVersion: "0.1.0",
  appVersionCode: 1,
  signingKey: { path: "../signing/ahibizz-upload.keystore", alias: "ahibizz-upload" },
  fallbackType: "customtabs",
  enableSiteSettingsShortcut: false,
  isChromeOSOnly: false,
  isMetaQuest: false,
  features: {},
  alphaDependencies: { enabled: false },
  shortcuts: [],
  generatorApp: "bubblewrap-core-1.24.1",
  fingerprints: [],
});
const problem = manifest.validate();
if (problem) throw new Error(problem);
await new TwaGenerator().createTwaProject(target, manifest, new ConsoleLog("twa"));
await manifest.saveToFile(`${target}/twa-manifest.json`);
console.log("generated", target);
