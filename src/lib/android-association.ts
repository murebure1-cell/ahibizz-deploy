export const ANDROID_PACKAGE = "com.ahibizz.app";
export const ANDROID_LINK_RELATION = "delegate_permission/common.handle_all_urls";

// The browser reports the launching Android app through its document referrer.
// This hint controls installed-app presentation only.
export function isAhiBizzAndroidLaunch(referrer: string) {
  if (!referrer.startsWith("android-app://")) return false;
  try {
    const url = new URL(referrer);
    return (
      !url.username &&
      !url.password &&
      !url.port &&
      (url.hostname === ANDROID_PACKAGE || url.hostname === `${ANDROID_PACKAGE}.qa`)
    );
  } catch {
    return false;
  }
}

export function playSigningFingerprints(value: string | undefined): string[] {
  if (!value) return [];
  const fingerprints = value.split(",").map((item) => item.trim().toUpperCase());
  if (!fingerprints.every((item) => /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(item))) return [];
  return [...new Set(fingerprints)];
}

export function androidAssetStatements(value: string | undefined) {
  const fingerprints = playSigningFingerprints(value);
  if (!fingerprints.length) return [];
  return [
    {
      relation: [ANDROID_LINK_RELATION],
      target: {
        namespace: "android_app",
        package_name: ANDROID_PACKAGE,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
}
