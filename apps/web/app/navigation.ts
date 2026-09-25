/**
 * `wide` marca las secciones cuyo contenido no es texto que leer sino una superficie que
 * ocupar. El resto se mantiene dentro de una medida cómoda; el Lector, en cambio, muestra
 * la página de un documento, y ahí cada píxel que se le quite se nota al leer.
 */
export const navigationItems = [
  { code: "IN", href: "/app", icon: "home", label: "Inicio" },
  { code: "BI", href: "/app/biblioteca", icon: "library", label: "Biblioteca" },
  { code: "LE", href: "/app/lector", icon: "book", label: "Lector", wide: true },
  { code: "IA", href: "/app/ia", icon: "sparkles", label: "IA" },
  { code: "AJ", href: "/app/ajustes", icon: "settings", label: "Ajustes" },
] as const;

export function isNavigationItemActive(pathname: string, href: string) {
  return href === "/app" ? pathname === href : pathname.startsWith(href);
}

/** Si la sección abierta debe extenderse a todo el ancho disponible. */
export function isWideSection(pathname: string) {
  return navigationItems.some(
    (item) => "wide" in item && item.wide && isNavigationItemActive(pathname, item.href),
  );
}
