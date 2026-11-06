import { applyImportedCatalogs, type ImportedCatalogRecord } from "./catalog-import";
import { documentDisplayTitle, type LibraryDocument } from "./documents";

/**
 * Qué cambia en la Biblioteca al importar un índice JSON (03.6, vista previa antes de un cambio
 * masivo): libro a libro, cada dato que pasa de una cosa a otra. Se calcula aplicando las fichas
 * en memoria, igual que hará la Biblioteca, sin escribir nada.
 */

export interface FieldChange {
  from: string;
  label: string;
  to: string;
}

export interface DocumentChangePreview {
  changes: FieldChange[];
  documentId: string;
  title: string;
}

export interface CatalogImportPreview {
  changed: DocumentChangePreview[];
  /** Libros con ficha en el archivo que ya estaban exactamente así. */
  unchanged: number;
}

/** Cómo se escribe «sin dato» en la vista previa. */
export const noValue = "—";

const fields: ReadonlyArray<{ label: string; read: (document: LibraryDocument) => string }> = [
  { label: "Título", read: documentDisplayTitle },
  // Solo la ficha: `document.author` de una copia importada es la etiqueta «Copia importada».
  { label: "Autoría", read: (document) => (document.catalog?.authors ?? []).join(", ") },
  {
    label: "Categoría",
    read: (document) => [document.organization?.category, document.organization?.subcategory].filter(Boolean).join(" › "),
  },
  {
    label: "Serie",
    read: (document) => {
      const series = document.bibliographic?.series;
      if (!series) return "";
      const volume = document.bibliographic?.volume;
      return volume === null || volume === undefined ? series : `${series}, ${volume}`;
    },
  },
  { label: "Año", read: (document) => (document.catalog?.publicationYear ? String(document.catalog.publicationYear) : "") },
  { label: "Copia de", read: (document) => document.organization?.duplicateOf ?? "" },
];

export function previewCatalogImport(
  documents: readonly LibraryDocument[],
  records: readonly ImportedCatalogRecord[],
): CatalogImportPreview {
  const after = applyImportedCatalogs(documents, records);
  const changed: DocumentChangePreview[] = [];
  let unchanged = 0;
  documents.forEach((before, index) => {
    const next = after[index]!;
    // `applyImportedCatalogs` devuelve el mismo objeto a quien no tiene ficha en el archivo.
    if (next === before) return;
    const changes = fields.flatMap(({ label, read }) => {
      const from = read(before);
      const to = read(next);
      return from === to ? [] : [{ from: from || noValue, label, to: to || noValue }];
    });
    if (next.cover?.src && next.cover.src !== before.cover?.src) {
      changes.push({ from: before.cover?.src ? "la que tiene" : noValue, label: "Portada", to: "la del archivo" });
    }
    if (changes.length) changed.push({ changes, documentId: before.id, title: documentDisplayTitle(before) });
    else unchanged += 1;
  });
  return { changed, unchanged };
}
