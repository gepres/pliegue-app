export const navigationItems = [
  { code: "IN", href: "/app", label: "Inicio" },
  { code: "BI", href: "/app/biblioteca", label: "Biblioteca" },
  { code: "LE", href: "/app/lector", label: "Lector" },
  { code: "IA", href: "/app/ia", label: "IA" },
  { code: "AJ", href: "/app/ajustes", label: "Ajustes" },
] as const;

export function isNavigationItemActive(pathname: string, href: string) {
  return href === "/app" ? pathname === href : pathname.startsWith(href);
}
