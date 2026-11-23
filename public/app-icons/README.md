# AhiBizz application icons

These icons use the existing three-path AhiBizz symbol from
`public/brand/ahi-logo-white.svg`. The paths and their transforms are unchanged;
the wordmark is omitted so the symbol remains legible at launcher sizes.

- Background: existing brand navy `#172e50`.
- Symbol: existing white logo variant, centered without distortion.
- `icon-192.png` and `icon-512.png`: ordinary application icons (`purpose: any`).
- `maskable-512.png`: opaque, full-bleed icon; the symbol stays inside the central
  80%-diameter safe circle (`purpose: maskable`).
- `apple-touch-icon.png`: 180 × 180 opaque icon; iOS applies its own corner mask.

Rendered locally with the project's existing Sharp 0.35.5. No new dependency,
external artwork, font, or replacement brand was used. The original logos remain
unchanged. The production manifest, service worker, launcher mark and install
page use this set. `public/app.webmanifest` declares the launcher icons.
