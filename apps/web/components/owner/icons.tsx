import type { ReactNode, SVGProps } from "react";

// One small, consistent stroke-icon set for the owner dashboard (24px grid, 1.8 stroke, rounded).
// Decorative by default (aria-hidden); a control that shows ONLY an icon must carry its own
// accessible name on the surrounding button/link - never rely on the icon for meaning.
const PATHS: Record<string, ReactNode> = {
  home: <path d="M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10M10 19.5v-5h4v5" />,
  queue: (
    <>
      <circle cx="8" cy="8" r="3" />
      <path d="M3 19c0-3 2.2-5 5-5s5 2 5 5M16 5.5a3 3 0 0 1 0 5.5M17.5 14c2 .6 3.5 2.4 3.5 5" />
    </>
  ),
  scissors: (
    <>
      <circle cx="6" cy="6.5" r="2.5" />
      <circle cx="6" cy="17.5" r="2.5" />
      <path d="M8 8 20 18M8 16 20 6" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  calendarGrid: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4M9 10v10M15 10v10M3.5 15h17" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16.5 5a3.2 3.2 0 0 1 0 6M18 14.8c1.8.7 3 2.4 3 5.2" />
    </>
  ),
  team: (
    <>
      <circle cx="12" cy="7.5" r="3" />
      <circle cx="5" cy="10" r="2.2" />
      <circle cx="19" cy="10" r="2.2" />
      <path d="M7 20c0-3 2.2-5 5-5s5 2 5 5M1.5 19c0-2.2 1.4-3.8 3.5-4M22.5 19c0-2.2-1.4-3.8-3.5-4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  rupee: <path d="M7 5h10M7 9h10M7 5c4.5 0 6.5 1.5 6.5 4S11 13 7 13h.5l7 6.5" />,
  card: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <path d="M3 10h18M7 15h4" />
    </>
  ),
  receipt: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9.5 8h5M9.5 12h5" />,
  star: <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z" />,
  tag: (
    <>
      <path d="M3.5 12.2V4.5h7.7l9 9a2 2 0 0 1 0 2.8l-4.9 4.9a2 2 0 0 1-2.8 0z" />
      <circle cx="8" cy="9" r="1.2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" />
    </>
  ),
  chair: <path d="M7 4h10v8H7zM5 12h14v3H5zM8 15v5M16 15v5" />,
  qr: (
    <>
      <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1" />
      <rect x="14" y="3.5" width="6.5" height="6.5" rx="1" />
      <rect x="3.5" y="14" width="6.5" height="6.5" rx="1" />
      <path d="M14 14h2.5v2.5H14zM19 14v2.5M14 19.5h6.5" />
    </>
  ),
  bell: <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0" />,
  help: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1 1-1.1 1.8M12 16.8v.1" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" />
    </>
  ),
  logout: <path d="M10 4.5H5.5v15H10M14 8l4 4-4 4M18 12H9" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4-4" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  phone: <path d="M6.5 4h3l1.5 4-2 1.5a11 11 0 0 0 5.5 5.5L16 13l4 1.5v3a2 2 0 0 1-2 2A14.5 14.5 0 0 1 4.5 6a2 2 0 0 1 2-2z" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  download: <path d="M12 4v11M7.5 11 12 15.5 16.5 11M5 20h14" />,
  alert: (
    <>
      <path d="M12 4 2.8 19.5h18.4z" />
      <path d="M12 10v4.5M12 17.2v.1" />
    </>
  ),
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  store: <path d="M4 9.5 5.5 4h13L20 9.5M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M5.5 12.5V20h13v-7.5M10 20v-4.5h4V20" />,
  trend: <path d="m4 16 5-5 4 4 7-8M15 7h5v5" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.8v.1" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  refresh: <path d="M20 8a8 8 0 0 0-14-2.5L4 8M4 4v4h4M4 16a8 8 0 0 0 14 2.5L20 16M20 20v-4h-4" />,
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, ...rest }: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
