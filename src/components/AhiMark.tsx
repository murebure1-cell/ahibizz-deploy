import Image from "next/image";

export function AhiMark({
  size,
  className,
  alt = "",
}: {
  size: number;
  className?: string;
  alt?: string;
}) {
  return (
    <Image
      src="/app-icons/source-mark.svg"
      alt={alt}
      width={size}
      height={size}
      className={className}
      unoptimized
    />
  );
}
