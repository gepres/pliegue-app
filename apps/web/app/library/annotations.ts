/**
 * Resaltados y notas de un documento.
 *
 * Una marca guarda la cita tal cual y, además, dónde estaba: la página, la vista en la que se
 * hizo y la posición del texto dentro de ella, con unas palabras de antes y de después. La
 * posición basta para volver a pintarla en la misma vista. La cita y su contexto sirven para
 * encontrarla en la otra —el texto recompuesto del modo Lectura no mide lo mismo que la capa
 * de texto del PDF— o cuando la extracción cambie. Es el modelo de anotaciones web del W3C
 * (selector de posición más selector de cita), en pequeño.
 */

export const highlightColors = ["amber", "green", "blue", "rose"] as const;
export type HighlightColor = (typeof highlightColors)[number];

export const highlightColorLabels: Record<HighlightColor, string> = {
  amber: "Ámbar",
  blue: "Azul",
  green: "Verde",
  rose: "Rosa",
};

/** Rectángulo relativo a la página, de 0 a 1 en cada eje: vale a cualquier zoom. */
export interface NormalizedRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface TextSelector {
  end: number;
  prefix: string;
  quote: string;
  start: number;
  suffix: string;
}

export type AnnotationTarget =
  | (TextSelector & {
      /**
       * La cita tal como se lee. El texto del DOM, del que sale `quote`, junta el final de un
       * renglón de la capa de texto del PDF con el principio del siguiente —los separa un
       * `<br>`—; la selección del navegador sí los separa. `quote` sigue siendo el trozo
       * exacto, que es lo que sirve para anclarla.
       */
      display?: string;
      kind: "text";
      /** Página en un PDF; `null` en los formatos que no se paginan. */
      page: number | null;
      /** Vista en la que se hizo, p. ej. `pdf-layer:12`. La posición solo vale dentro de ella. */
      scope: string;
    })
  | {
      kind: "region";
      page: number;
      rect: NormalizedRect;
      /** Texto que caía dentro de la zona, si la página lo tiene: sirve de cita. */
      quote: string;
    };

export interface ReaderAnnotation {
  color: HighlightColor;
  createdAt: string;
  documentId: string;
  /** Título del documento al crearla: la procedencia sobrevive aunque el archivo se vaya. */
  documentTitle: string;
  id: string;
  note: string;
  target: AnnotationTarget;
  updatedAt: string;
}

/** Palabras de contexto que se guardan a cada lado de la cita para desambiguarla. */
export const contextLength = 32;

/** La cita y su contexto a partir de una posición dentro de un texto. */
export function describeTextRange(text: string, start: number, end: number): TextSelector {
  return {
    end,
    prefix: text.slice(Math.max(0, start - contextLength), start),
    quote: text.slice(start, end),
    start,
    suffix: text.slice(end, end + contextLength),
  };
}

/**
 * Texto preparado para comparar citas entre vistas: sin guiones blandos, en minúsculas y con
 * los espacios colapsados o, con `spaces: "drop"`, sin ninguno. `positions[i]` es la posición
 * en el texto original del carácter `i` del texto plegado, para poder volver a él.
 */
export function foldForMatch(text: string, spaces: "collapse" | "drop" = "collapse") {
  let folded = "";
  const positions: number[] = [];
  let pendingSpace = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? "";
    if (character === "­") continue;
    if (/\s/.test(character)) {
      pendingSpace = spaces === "collapse" && folded.length > 0;
      continue;
    }
    if (pendingSpace) {
      folded += " ";
      positions.push(index - 1);
      pendingSpace = false;
    }
    // Una letra puede plegarse en dos («İ» → «i̇»): cada una apunta al mismo original.
    for (const lower of character.toLocaleLowerCase("es")) {
      folded += lower;
      positions.push(index);
    }
  }

  return { folded, positions };
}

function commonSuffixLength(left: string, right: string) {
  let length = 0;
  while (
    length < left.length &&
    length < right.length &&
    left[left.length - 1 - length] === right[right.length - 1 - length]
  ) {
    length += 1;
  }
  return length;
}

function commonPrefixLength(left: string, right: string) {
  let length = 0;
  while (length < left.length && length < right.length && left[length] === right[length]) {
    length += 1;
  }
  return length;
}

/**
 * Dónde está hoy una cita dentro de `text`, o `null` si ya no está.
 *
 * Primero se prueba la posición guardada: si sigue diciendo lo mismo, vale. Si no, se busca
 * la cita; entre varias apariciones gana la que conserva más contexto a los lados y, a
 * igualdad, la más cercana a donde estaba. Se compara con los espacios colapsados y, si así
 * no aparece, sin espacios: la capa de texto del PDF junta los renglones que el modo Lectura
 * separa, y una cita de varios renglones no mediría lo mismo en las dos vistas.
 */
export function anchorText(text: string, selector: TextSelector): { end: number; start: number } | null {
  return anchorFolded(text, selector, "collapse") ?? anchorFolded(text, selector, "drop");
}

function anchorFolded(text: string, selector: TextSelector, spaces: "collapse" | "drop") {
  const quote = foldForMatch(selector.quote, spaces).folded;
  if (!quote) return null;

  if (
    selector.start >= 0 &&
    selector.end <= text.length &&
    selector.start < selector.end &&
    foldForMatch(text.slice(selector.start, selector.end), spaces).folded === quote
  ) {
    return { end: selector.end, start: selector.start };
  }

  const { folded, positions } = foldForMatch(text, spaces);
  const prefix = foldForMatch(selector.prefix, spaces).folded;
  const suffix = foldForMatch(selector.suffix, spaces).folded;
  let best: { at: number; score: number } | null = null;

  for (let at = folded.indexOf(quote); at >= 0; at = folded.indexOf(quote, at + 1)) {
    const before = folded.slice(Math.max(0, at - prefix.length - 1), at).trimEnd();
    const after = folded.slice(at + quote.length, at + quote.length + suffix.length + 1).trimStart();
    const distance = Math.abs((positions[at] ?? 0) - selector.start);
    const score =
      commonSuffixLength(before, prefix.trimEnd()) +
      commonPrefixLength(after, suffix.trimStart()) -
      distance / 1_000_000;
    if (!best || score > best.score) best = { at, score };
  }

  if (!best) return null;
  const start = positions[best.at];
  const last = positions[best.at + quote.length - 1];
  if (start === undefined || last === undefined) return null;
  return { end: last + 1, start };
}

export function annotationPage(annotation: ReaderAnnotation) {
  return annotation.target.page;
}

/** La cita para mostrarla, exportarla o llevarla a una postal. */
export function annotationQuote(annotation: ReaderAnnotation) {
  const target = annotation.target;
  const quote = target.kind === "text" ? (target.display ?? target.quote) : target.quote;
  return quote.replaceAll(/\s+/g, " ").trim();
}

/** En orden de lectura: por página y, dentro de ella, por posición o por altura. */
export function sortAnnotations(annotations: readonly ReaderAnnotation[]) {
  const position = (annotation: ReaderAnnotation) =>
    annotation.target.kind === "text" ? annotation.target.start : annotation.target.rect.y * 1e6;
  return [...annotations].sort(
    (left, right) =>
      (left.target.page ?? 0) - (right.target.page ?? 0) ||
      position(left) - position(right) ||
      left.createdAt.localeCompare(right.createdAt),
  );
}

/**
 * Tope por cita al exportar. Las notas son de quien las escribe y van enteras; de la obra se
 * exportan fragmentos breves y con su referencia, que es lo que permite citar sin copiarla.
 */
export const exportQuoteLimit = 280;

function truncate(text: string, limit: number) {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function annotationsToMarkdown(
  annotations: readonly ReaderAnnotation[],
  document: { author: string | null; title: string },
  exportedAt = new Date(),
) {
  const date = exportedAt.toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" });
  const lines = [
    `# Notas de «${document.title}»`,
    "",
    `${document.author ? `${document.author} · ` : ""}Exportadas desde Pliegue el ${date}. Citas breves, de ${exportQuoteLimit} caracteres como máximo, con su página.`,
  ];

  for (const annotation of sortAnnotations(annotations)) {
    const page = annotation.target.page;
    const quote = annotationQuote(annotation);
    lines.push("");
    if (quote) {
      lines.push(`> ${truncate(quote, exportQuoteLimit)}`);
    } else {
      lines.push(`> [Zona marcada${page ? ` en la página ${page}` : ""}]`);
    }
    lines.push(`> — ${page ? `página ${page}` : document.title}`);
    if (annotation.note.trim()) {
      lines.push("", annotation.note.trim());
    }
  }

  return `${lines.join("\n")}\n`;
}
