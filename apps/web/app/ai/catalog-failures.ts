import type { AiProvider, DocumentCatalogRecord } from "./document-catalog";

/**
 * Por qué falló el catálogo IA. El panel decía solo «3 con error» y el motivo quedaba guardado
 * en cada ficha sin que nadie lo viera: había que abrir la consola para saber si era el límite
 * de uso, la clave o el modelo. Se agrupan los documentos por motivo, porque un límite de uso
 * tumba muchos a la vez con el mismo mensaje, y repetirlo en cada uno esconde lo que importa.
 */
export interface CatalogFailureGroup {
  /** El intento más reciente con este motivo, para poner primero lo último que pasó. */
  lastAt: string;
  message: string;
  model: string;
  provider: AiProvider;
  titles: string[];
}

export const unexplainedCatalogFailure = "El proveedor no explicó el motivo.";

/**
 * Las fichas en error, agrupadas por proveedor, modelo y mensaje. `titleOf` da el título del
 * documento; si ya no está en la biblioteca, su ficha no se cuenta: no hay nada que reintentar.
 */
export function groupCatalogFailures(
  records: readonly DocumentCatalogRecord[],
  titleOf: (documentId: string) => string | undefined,
): CatalogFailureGroup[] {
  const groups = new Map<string, CatalogFailureGroup>();

  for (const record of records) {
    if (record.status !== "error") continue;
    const title = titleOf(record.documentId);
    if (!title) continue;
    const message = record.error?.trim() || unexplainedCatalogFailure;
    const key = JSON.stringify([record.provider, record.model, message]);
    const group = groups.get(key);
    if (group) {
      group.titles.push(title);
      if (record.analyzedAt > group.lastAt) group.lastAt = record.analyzedAt;
    } else {
      groups.set(key, {
        lastAt: record.analyzedAt,
        message,
        model: record.model,
        provider: record.provider,
        titles: [title],
      });
    }
  }

  return [...groups.values()]
    .map((group) => ({ ...group, titles: [...group.titles].sort((left, right) => left.localeCompare(right, "es")) }))
    .sort((left, right) => right.lastAt.localeCompare(left.lastAt) || right.titles.length - left.titles.length);
}
