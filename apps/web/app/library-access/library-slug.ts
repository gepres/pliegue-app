/**
 * Qué biblioteca es cuál. La general es `general`; una compartida, la dirección que eligió su
 * dueño: /biblioteca/<slug>. El formato y las reservadas son los mismos que en la base
 * (`shared_libraries_slug_format` y `shared_libraries_slug_reserved`).
 */
export const generalLibrary = "general";

/** Nombres que no puede tomar una biblioteca compartida: rutas de Pliegue o que podrían serlo. */
export const reservedLibrarySlugs: readonly string[] = [
  "admin",
  "ajustes",
  "api",
  "app",
  "biblioteca",
  "denuncia",
  "general",
  "leer",
  "moderacion",
  "nueva",
  "pliegue",
];

const slugPattern = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** ¿Puede ser la dirección de una biblioteca compartida? «luis-lara» sí; «general» o «Luis Lara», no. */
export function isSharedLibrarySlug(value: string) {
  return value.length >= 2 && value.length <= 40 && slugPattern.test(value) && !reservedLibrarySlugs.includes(value);
}

/**
 * Una dirección a partir de un nombre o de un correo: «Luis Lara» → «luis-lara»,
 * «luis.lara@…» → «luis-lara». Sin acentos ni signos; vacía si no queda nada que sirva.
 */
export function suggestLibrarySlug(value: string) {
  const slug = (value.split("@")[0] ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  if (!slug) return "";
  return reservedLibrarySlugs.includes(slug) ? `${slug}-lecturas` : slug.length < 2 ? `${slug}-biblioteca` : slug;
}

/** La dirección como llega en la URL, en su forma canónica: «Luis-Lara» → «luis-lara». `null` si no puede ser ninguna. */
export function sharedSlugFromParam(raw: string) {
  const slug = raw.toLowerCase();
  return isSharedLibrarySlug(slug) ? slug : null;
}
