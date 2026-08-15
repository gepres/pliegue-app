import type { LibraryDocument } from "./documents";
import { isCurrentContentIndex } from "./local-content-index";

/**
 * Qué hay que hacer para rehacer el índice. No hay una acción única porque cada origen se
 * releé de una forma: la carpeta vinculada se reescanea, la copia importada ya tiene el binario
 * en IndexedDB y el archivo suelto necesita que el navegador vuelva a conceder su permiso.
 */
export type StaleIndexAction = "reindex-copy" | "relink-file" | "rescan-folder";

export interface StaleIndexGroup {
  action: StaleIndexAction;
  count: number;
  /** Carpetas afectadas, para poder reescanear solo las que lo necesitan. */
  sourceIds: string[];
}

export interface StaleIndexReport {
  groups: StaleIndexGroup[];
  total: number;
}

const actionByReference: Record<LibraryDocument["reference"]["kind"], StaleIndexAction | null> = {
  "google-drive": null,
  "local-copy": "reindex-copy",
  "local-file": "relink-file",
  "local-folder": "rescan-folder",
};

/**
 * Un documento cuyo índice lo produjo una versión anterior del extractor. El caso que lo hizo
 * visible: al añadir la extracción de PDF, los documentos ya vinculados conservaron su índice
 * sin texto, y la aplicación los presentaba como escaneos a la espera de OCR.
 */
export function hasStaleIndex(document: LibraryDocument) {
  return (
    actionByReference[document.reference.kind] !== null &&
    !isCurrentContentIndex(document.indexVersion)
  );
}

/** Agrupa los documentos con índice viejo por la acción que los pondría al día. */
export function findStaleIndexes(documents: readonly LibraryDocument[]): StaleIndexReport {
  const groups = new Map<StaleIndexAction, StaleIndexGroup>();

  for (const document of documents) {
    if (!hasStaleIndex(document)) continue;
    const action = actionByReference[document.reference.kind];
    if (!action) continue;

    const group = groups.get(action) ?? { action, count: 0, sourceIds: [] };
    group.count += 1;
    if (document.reference.kind === "local-folder") {
      const { sourceId } = document.reference;
      if (!group.sourceIds.includes(sourceId)) group.sourceIds.push(sourceId);
    }
    groups.set(action, group);
  }

  const ordered = [...groups.values()].sort((left, right) => right.count - left.count);
  return { groups: ordered, total: ordered.reduce((sum, group) => sum + group.count, 0) };
}
