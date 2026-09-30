/**
 * Una entrada del índice del documento abierto, venga de donde venga: los marcadores de un
 * PDF, las secciones que extrae Pliegue de un DOCX o EPUB, o las páginas de una hoja.
 */
export interface OutlineItem {
  id: string;
  label: string;
  /** 0 para el primer nivel; el panel sangra a partir de ahí. */
  level: number;
  /** Texto breve a la derecha: el número de página o el tipo de sección. */
  meta?: string;
  target: { id: string; kind: "anchor" } | { kind: "page"; page: number };
}
