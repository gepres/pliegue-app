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
