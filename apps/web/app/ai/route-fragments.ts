import type { ChunkLocation } from "../library/chunking";

/**
 * Lo que las rutas de la IA aceptan de un fragmento de libro (04.5): solo lo que hace falta para
 * citar. Una ruta de Next no puede exportar más que sus métodos, así que vive aquí.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Página, o sección con su título; nada de rectángulos ni ids. */
export function validLocation(value: unknown): ChunkLocation | null {
  if (!isRecord(value)) return null;
  if (value.kind === "page" && Number.isInteger(value.page) && (value.page as number) > 0) {
    return { end: 0, kind: "page", page: value.page as number, rects: [], start: 0 };
  }
  if (value.kind === "section" && Number.isInteger(value.section) && (value.section as number) >= 0) {
    const title = typeof value.title === "string" ? value.title.slice(0, 200) : "";
    return { blockEnd: 0, blockStart: 0, kind: "section", section: value.section as number, sectionId: "", title };
  }
  return null;
}
