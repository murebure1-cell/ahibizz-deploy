import type { ReactNode, SVGProps } from "react";

export type IconName =
  | "card"
  | "arrow"
  | "search"
  | "pin"
  | "calendar"
  | "message"
  | "shop"
  | "menu"
  | "close"
  | "heart"
  | "check"
  | "phone"
  | "chevron"
  | "clock"
  | "home"
  | "user"
  | "people"
  | "info"
  | "sliders"
  | "star"
  | "crown"
  | "shield"
  | "external"
  | "mail"
  | "pause"
  | "play"
  | "car"
  | "bed"
  | "coffee"
  | "bell"
  | "plus"
  | "more"
  | "refresh"
  | "volume"
  | "mute"
  | "share"
  | "eye"
  | "download"
  | "logout";

const paths: Record<IconName, ReactNode> = {
  people: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20v-1.5a6.5 6.5 0 0 1 13 0V20m.5-15a3.5 3.5 0 0 1 0 7m2 2.2a5.5 5.5 0 0 1 3.5 5.1v.7" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10.5v6m0-10v.5" />
    </>
  ),
  card: (
    <>
      <rect x="2.5" y="4.5" width="19" height="15" rx="3" />
      <path d="M3 9h18M6.5 15h3" />
    </>
  ),
  logout: <path d="M10 4H5v16h5M9 12h12m-4-4 4 4-4 4" />,
  download: (
    <>
      <path d="M12 3v12m-5-5 5 5 5-5M5 15v6h14v-6" />
    </>
  ),
  heart: (
    <path d="M20.8 4.9a5.4 5.4 0 0 0-7.6 0L12 6.1l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 21l8.8-8.5a5.4 5.4 0 0 0 0-7.6Z" />
  ),
  check: <path d="m5 12 4 4L19 6" />,
  phone: <path d="m7 3 3 5-2 2a15 15 0 0 0 6 6l2-2 5 3c0 3-2 4-4 4C9 20 4 15 3 7c0-2 1-4 4-4Z" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  bell: (
    <>
      <path d="M18 9a6 6 0 0 0-12 0c0 4-1 6-2 7h16c-1-1-2-3-2-7Z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </>
  ),
  plus: <path d="M5 12h14M12 5v14" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  refresh: <path d="M20 9a8 8 0 0 0-13.6-3L4 8m0-4v4h4m-4 7a8 8 0 0 0 13.6 3l2.4-2m0 4v-4h-4" />,
  volume: <path d="M4 9v6h4l5 4V5L8 9H4Zm12-.6a5 5 0 0 1 0 7.2m2.4-9.5a8 8 0 0 1 0 11.8" />,
  mute: <path d="M4 9v6h4l5 4V5L8 9H4Zm12 1 4 4m0-4-4 4" />,
  share: (
    <>
      <circle cx="5" cy="12" r="2.6" />
      <circle cx="18" cy="5" r="2.6" />
      <circle cx="18" cy="19" r="2.6" />
      <path d="m7.5 10.7 8-4.3m-8 6.9 8 4.3" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  home: (
    <>
      <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="7" r="4" />
      <path d="M4 21v-3a8 8 0 0 1 16 0v3" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h7m4 0h5M4 17h3m4 0h9" />
      <circle cx="13" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z" />,
  crown: <path d="m3 7 4.5 3.5L12 4l4.5 6.5L21 7l-2 10H5ZM6 20h12" />,
  shield: (
    <path d="M12 3 4.5 6v5.5c0 4.2 2.8 7.5 7.5 9.5 4.7-2 7.5-5.3 7.5-9.5V6Zm-3.2 8.8 2.3 2.4 4.2-4.6" />
  ),
  external: (
    <>
      <path d="M13 4h7v7m0-7L10 14M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 6 9 7 9-7" />
    </>
  ),
  pause: (
    <>
      <path d="M8 5v14M16 5v14" />
    </>
  ),
  play: <path d="m8 4 12 8-12 8Z" />,
  bed: <path d="M3 18v3m18-3v3M3 18v-6h18v6ZM5 12V5h14v7M8 12V9h3v3m2 0V9h3v3" />,
  car: (
    <>
      <path d="m5 7 2-4h10l2 4 2 3v8H3v-8Zm0 0h14M3 13h18M5 18v3m14-3v3M6 10h2m8 0h2" />
    </>
  ),
  coffee: (
    <>
      <path d="M4 9h12v5a6 6 0 0 1-12 0Zm12 0h2a3 3 0 0 1 0 6h-2M3 22h15M7 3v3m5-3v3" />
    </>
  ),
  arrow: (
    <>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </>
  ),
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.8" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  pin: (
    <>
      <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" />
      <circle cx="12" cy="10" r="2.4" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="16" rx="3" />
      <path d="M8 3v4m8-4v4M4 11h16m-11 4h2m3 0h1m-6 3h2" />
    </>
  ),
  message: (
    <>
      <path d="M20 11.5a8 8 0 0 1-8 8H5l-3 2v-10a9 9 0 0 1 18 0Z" />
      <path d="M7 10h8m-8 4h5" />
    </>
  ),
  shop: (
    <>
      <path d="M4 10v10h16V10M3 10l2-6h14l2 6M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M9 20v-6h6v6" />
    </>
  ),
  menu: (
    <>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </>
  ),
  close: (
    <>
      <path d="m6 6 12 12M18 6 6 18" />
    </>
  ),
};

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-icon={name}
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
