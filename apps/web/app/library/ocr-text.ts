/**
 * Del texto que devuelve el OCR al que se lee y se traduce: los renglones de un párrafo, unidos;
 * las palabras cortadas a final de renglón («pala-/bra»), enteras; los párrafos, separados.
 *
 * Va aparte de `ocr.ts`, que carga tesseract.js, para que lo use también la maquetación de una
 * página leída (`ocr-layout.ts`), que no lo necesita.
 */
export function cleanOcrText(text: string) {
  return text
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((paragraph) =>
      paragraph
        .replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2")
        .replace(/\s*\n\s*/g, " ")
        .replace(/[ \t]+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join("\n\n");
}
