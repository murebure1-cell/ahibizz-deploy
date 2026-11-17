"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type BusinessLogoSurface,
  isCurrentBusinessLogoImage,
  readBusinessLogoSurface,
} from "../../lib/business-logo";
import styles from "./business-logo.module.css";

type LogoResult = { source: string; surface: BusinessLogoSurface };

export function BusinessLogo({
  src,
  alt,
  monogram,
  sizes = "72px",
}: {
  src: string;
  alt: string;
  monogram: string;
  sizes?: string;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  // Identical server/client initial output prevents a cached logo causing hydration mismatch.
  const [result, setResult] = useState<LogoResult | null>(null);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const surface = result?.source === src ? result.surface : null;
  const fallback = failedSource === src || surface === "empty";

  const inspect = useCallback(
    (image: HTMLImageElement) => {
      if (imageRef.current !== image || !image.complete || !image.naturalWidth) return;
      const sampled = readBusinessLogoSurface(image, src);
      if (sampled === null) return;
      setResult({ source: src, surface: sampled });
    },
    [src],
  );

  useEffect(() => {
    const image = imageRef.current;
    if (image) inspect(image);
  }, [inspect]);

  return (
    <span
      className={styles.surface}
      data-logo-surface={fallback ? "dark" : (surface ?? "neutral")}
      data-logo-state={failedSource === src ? "error" : (surface ?? "pending")}
    >
      {fallback ? (
        alt ? (
          <span className={styles.monogram} role="img" aria-label={alt}>
            {monogram}
          </span>
        ) : (
          <span className={styles.monogram} aria-hidden="true">
            {monogram}
          </span>
        )
      ) : (
        <Image
          key={src}
          ref={imageRef}
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          unoptimized
          onLoad={(event) => inspect(event.currentTarget)}
          onError={(event) => {
            if (
              imageRef.current === event.currentTarget &&
              isCurrentBusinessLogoImage(event.currentTarget, src)
            )
              setFailedSource(src);
          }}
        />
      )}
    </span>
  );
}
