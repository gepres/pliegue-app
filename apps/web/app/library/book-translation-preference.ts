/**
 * El par de idiomas elegido para traducir cada libro. Lo escribe y lee el lector
 * (`components/reader/use-book-translation.ts`) y lo sincroniza `cloud/sync/collections.ts`;
 * aquí solo se traslada de una copia del libro a otra (ver `book-copies.ts`).
 */
const preferenceKey = "pliegue-book-translation";

/** Si el destino ya tenía su par de idiomas, se conserva el suyo. */
export function transferTranslationPreference(fromId: string, toId: string) {
  if (fromId === toId) return false;
  try {
    const saved = JSON.parse(window.localStorage.getItem(preferenceKey) ?? "{}") as Record<string, unknown>;
    if (!(fromId in saved)) return false;
    if (!(toId in saved)) saved[toId] = saved[fromId];
    delete saved[fromId];
    window.localStorage.setItem(preferenceKey, JSON.stringify(saved));
    return true;
  } catch {
    return false;
  }
}
