import type { SVGProps } from "react";

/**
 * Iconografía de la aplicación.
 *
 * Trazos de 1,75 px sobre una rejilla de 24, dibujados aquí en lugar de traer una librería:
 * son una veintena y así la marca decide su grosor y sus remates. Los códigos de dos letras
 * que había antes en la navegación funcionaban como etiqueta, pero no como icono —en una
 * barra de pestañas el ojo busca formas, no siglas—.
 */
const paths = {
  home: (
    <>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 9v10h12V9" />
      <path d="M10 19v-5h4v5" />
    </>
  ),
  library: (
    <>
      <path d="M5 4h3v16H5z" />
      <path d="M10 4h3v16h-3z" />
      <path d="m15.5 5.2 2.9-.8 3.6 14.9-2.9.8z" />
    </>
  ),
  book: (
    <>
      <path d="M12 6.5C10.3 5 7.8 4.5 4 4.8v13.5c3.8-.3 6.3.2 8 1.7" />
      <path d="M12 6.5c1.7-1.5 4.2-2 8-1.7v13.5c-3.8-.3-6.3.2-8 1.7z" />
    </>
  ),
  sparkles: (
    <>
      <path d="M11 4.5 12.6 9l4.4 1.6-4.4 1.6L11 16.7l-1.6-4.5L5 10.6 9.4 9z" />
      <path d="M18 15v4M16 17h4" />
      <path d="M17.5 3.5v3M16 5h3" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13.5a7.7 7.7 0 0 0 0-3l2-1.5-2-3.4-2.3.9a7.5 7.5 0 0 0-2.6-1.5L14 2.6h-4l-.5 2.4A7.5 7.5 0 0 0 6.9 6.5l-2.3-.9-2 3.4 2 1.5a7.7 7.7 0 0 0 0 3l-2 1.5 2 3.4 2.3-.9a7.5 7.5 0 0 0 2.6 1.5l.5 2.4h4l.5-2.4a7.5 7.5 0 0 0 2.6-1.5l2.3.9 2-3.4z" />
    </>
  ),
  back: <path d="M15 5 8 12l7 7" />,
  chevronLeft: <path d="m14.5 6-6 6 6 6" />,
  chevronRight: <path d="m9.5 6 6 6-6 6" />,
  chevronDown: <path d="m6 9.5 6 6 6-6" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.2" fill="currentColor" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.2" fill="currentColor" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 5 5" />
    </>
  ),
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  grid: (
    <>
      <rect height="6.5" rx="1.5" width="6.5" x="4" y="4" />
      <rect height="6.5" rx="1.5" width="6.5" x="13.5" y="4" />
      <rect height="6.5" rx="1.5" width="6.5" x="4" y="13.5" />
      <rect height="6.5" rx="1.5" width="6.5" x="13.5" y="13.5" />
    </>
  ),
  list: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
  star: (
    <path d="m12 3.8 2.5 5.1 5.6.8-4 4 .9 5.6-5-2.7-5 2.7.9-5.6-4-4 5.6-.8z" />
  ),
  panel: (
    <>
      <rect height="16" rx="2.5" width="18" x="3" y="4" />
      <path d="M15 4v16" />
    </>
  ),
  sidebar: (
    <>
      <rect height="16" rx="2.5" width="18" x="3" y="4" />
      <path d="M9 4v16" />
    </>
  ),
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  shrink: <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />,
  typography: (
    <>
      <path d="m3 18 5-12 5 12M4.7 14h6.6" />
      <path d="M15.5 11.5c.5-1 1.4-1.5 2.6-1.5 1.7 0 2.4 1 2.4 2.5V18M20.5 14.5c-3.5 0-5.3.6-5.3 2 0 1 .8 1.6 1.9 1.6 1.7 0 3.4-1.1 3.4-3.6" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  ),
  moon: <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" />,
  monitor: (
    <>
      <rect height="12" rx="2" width="18" x="3" y="4" />
      <path d="M9 20h6M12 16v4" />
    </>
  ),
  folder: <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
  file: (
    <>
      <path d="M6 3.5h8l4 4v13H6z" />
      <path d="M14 3.5v4h4" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  refresh: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.5 4.5v4h-4" />
    </>
  ),
  download: <path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14" />,
  trash: (
    <>
      <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="2.5" />
      <path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" />
    </>
  ),
  cloud: <path d="M7 18.5a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.5 1.6A3.8 3.8 0 0 1 17.5 18.5z" />,
  lineHeight: <path d="M10 6h10M10 12h10M10 18h10M5 5v14M3 7l2-2 2 2M3 17l2 2 2-2" />,
  measure: <path d="M3 12h18M6.5 8.5 3 12l3.5 3.5M17.5 8.5 21 12l-3.5 3.5M3 5v2M21 5v2M3 17v2M21 17v2" />,
  restart: (
    <>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
      <path d="M4.5 4.5v4h4" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.8v.01" />
    </>
  ),
  toc: <path d="M4 6h11M4 12h16M4 18h8M18 6h2M16 18h4" />,
  keyboard: (
    <>
      <rect height="12" rx="2" width="19" x="2.5" y="6" />
      <path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7.5 14h9" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
} as const;

export type IconName = keyof typeof paths;

export function Icon({
  name,
  size = 20,
  ...props
}: SVGProps<SVGSVGElement> & { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      focusable="false"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.75}
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
