export type BusinessLogoSurface = "light" | "dark" | "empty";
const surfaces = new Map<string, BusinessLogoSurface>();
const cacheLimit = 128;

function remember(source: string, surface: BusinessLogoSurface) {
  surfaces.delete(source);
  surfaces.set(source, surface);
  if (surfaces.size > cacheLimit) {
    const oldest = surfaces.keys().next().value;
    if (oldest !== undefined) surfaces.delete(oldest);
  }
}

export function isCurrentBusinessLogoImage(image: HTMLImageElement, source: string) {
  try {
    const expected = new URL(source, image.ownerDocument.baseURI).href;
    return (image.currentSrc || image.src) === expected;
  } catch {
    return false;
  }
}

function luminance(red: number, green: number, blue: number) {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

/**
 * True when the loaded logo has transparent pixels, so it can be shown as a white silhouette on a
 * dark map pin; opaque logos (with their own background) are shown as they are. Null if unreadable.
 */
export function logoHasTransparency(image: HTMLImageElement): boolean | null {
  if (!image.complete || !image.naturalWidth) return null;
  try {
    const canvas = image.ownerDocument.createElement("canvas");
    canvas.width = canvas.height = 32;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, 32, 32);
    const { data } = context.getImageData(0, 0, 32, 32);
    for (let offset = 3; offset < data.length; offset += 4)
      if ((data[offset] ?? 255) < 250) return true;
    return false;
  } catch {
    return null;
  }
}

/** Inspect only the already loaded image; no second image request or pixel modification. */
export function readBusinessLogoSurface(
  image: HTMLImageElement,
  source: string,
): BusinessLogoSurface | null {
  if (!image.complete || !image.naturalWidth || !isCurrentBusinessLogoImage(image, source))
    return null;
  const cached = surfaces.get(source);
  if (cached) return cached;
  try {
    const canvas = image.ownerDocument.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, 32, 32);
    const { data } = context.getImageData(0, 0, 32, 32);
    let alpha = 0;
    let lightness = 0;
    let transparent = false;
    for (let offset = 0; offset < data.length; offset += 4) {
      const opacity = (data[offset + 3] ?? 0) / 255;
      if (opacity < 1) transparent = true;
      if (opacity === 0) continue;
      alpha += opacity;
      lightness +=
        opacity * luminance(data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0);
    }
    const foreground = alpha ? lightness / alpha : 0;
    const navy = luminance(23, 48, 71);
    const surface =
      alpha === 0
        ? "empty"
        : !transparent
          ? "light"
          : (foreground + 0.05) / (navy + 0.05) > 1.05 / (foreground + 0.05)
            ? "dark"
            : "light";
    remember(source, surface);
    return surface;
  } catch {
    // An unavailable/tainted canvas keeps a neutral surface and the original image.
    return null;
  }
}
