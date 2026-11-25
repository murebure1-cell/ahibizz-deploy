import { logoLetters, logoSymbol, logoViewBox } from "./logo-paths";

/**
 * The full logo in the colours of the place it stands in: the symbol and "bizz" take the text
 * colour, "ahi" and the full stop the accent. `tone="one"` draws everything in the text colour,
 * for small sizes and for a logo on the accent or over a photograph. A parent may set
 * `--logo-accent` when the surface is not the theme's own, as in the dark footer.
 */
export function AhiLogo({
  className,
  title = "AhiBizz",
  tone = "two",
  decorative = false,
}: {
  className?: string;
  title?: string;
  tone?: "two" | "one";
  /** Hidden from assistive technology, for repeats and for links that carry their own name. */
  decorative?: boolean;
}) {
  const accent = tone === "two" ? "var(--logo-accent, var(--ui-accent))" : "currentColor";
  return (
    <svg
      className={className}
      viewBox={logoViewBox}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : title}
      aria-hidden={decorative || undefined}
    >
      {logoSymbol.map((path) => (
        <path key={path.transform} transform={path.transform} d={path.d} fill="currentColor" />
      ))}
      {logoLetters.map((path, index) => (
        <path
          key={path.transform}
          transform={path.transform}
          d={path.d}
          fill={index < 3 || index === 7 ? accent : "currentColor"}
        />
      ))}
    </svg>
  );
}
