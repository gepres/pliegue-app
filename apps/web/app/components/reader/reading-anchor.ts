/**
 * Un bloque de texto que sirve de punto de lectura: el mismo `data-reading-anchor` en todas las
 * vistas —su sección o su página y su posición en ella—. Ver `useReadingPlace`.
 */
export const readingAnchorAttribute = "data-reading-anchor";

export function readingAnchorProps(id: string | undefined) {
  return id ? { [readingAnchorAttribute]: id } : {};
}
