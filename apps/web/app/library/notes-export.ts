import type { ReaderAnnotation } from "./annotations";

/**
 * Las notas y resaltados en Markdown: un archivo que se lee y se lleva a cualquier sitio sin
 * Pliegue (Obsidian, un editor, otro programa de notas). Por libro, en orden de página.
 */

function quoteOf(annotation: ReaderAnnotation) {
  const target = annotation.target;
  const text = (target.kind === "text" ? (target.display ?? target.quote) : target.quote).replace(/\s+/g, " ").trim();
  if (text) return text;
  return target.kind === "region" ? `(zona de la página ${target.page})` : "";
}

function pageOf(annotation: ReaderAnnotation) {
  const page = annotation.target.page;
  return typeof page === "number" ? page : null;
}

/** Markdown con un apartado por libro. `generatedAt` en ISO; las fechas se escriben en español. */
export function notesToMarkdown(annotations: readonly ReaderAnnotation[], generatedAt: string) {
  const byBook = new Map<string, ReaderAnnotation[]>();
  for (const annotation of annotations) {
    const title = annotation.documentTitle.trim() || "Sin título";
    byBook.set(title, [...(byBook.get(title) ?? []), annotation]);
  }
  const date = new Date(generatedAt).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" });
  const books = [...byBook].sort(([left], [right]) => left.localeCompare(right, "es"));
  const lines = [
    "# Notas y resaltados de Pliegue",
    "",
    `Exportado el ${date} · ${annotations.length} ${annotations.length === 1 ? "marca" : "marcas"} en ${books.length} ${books.length === 1 ? "libro" : "libros"}.`,
  ];
  for (const [title, items] of books) {
    lines.push("", `## ${title}`);
    const sorted = [...items].sort(
      (left, right) => (pageOf(left) ?? 0) - (pageOf(right) ?? 0) || left.createdAt.localeCompare(right.createdAt),
    );
    for (const annotation of sorted) {
      const quote = quoteOf(annotation);
      const page = pageOf(annotation);
      lines.push("");
      if (quote) lines.push(`> ${quote}`);
      if (page !== null) lines.push(quote ? `>` : "", `${quote ? "> " : ""}— p. ${page}`);
      const note = annotation.note.trim();
      if (note) lines.push("", ...note.split(/\r?\n/));
    }
  }
  return `${lines.filter((line, index, all) => !(line === "" && all[index - 1] === "")).join("\n")}\n`;
}

/** «pliegue-notas-2026-10-02.md». */
export function notesFileName(iso: string) {
  return `pliegue-notas-${iso.slice(0, 10)}.md`;
}
