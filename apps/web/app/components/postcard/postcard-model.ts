/**
 * Postal: un fragmento del documento convertido en imagen para compartir.
 *
 * Aquí vive todo lo que no necesita un navegador —formatos, plantillas, el estado del
 * diseño, el control de derechos y la maquetación del texto— para poder probarlo. El dibujo
 * sobre el canvas está en `postcard-render.ts`.
 */

export const postcardFormats = {
  landscape: { height: 630, hint: "X, Facebook, LinkedIn", label: "Horizontal", width: 1200 },
  portrait: { height: 1350, hint: "Instagram", label: "Vertical", width: 1080 },
  square: { height: 1080, hint: "Instagram, WhatsApp", label: "Cuadrado", width: 1080 },
  story: { height: 1920, hint: "Historias y estados", label: "Historia", width: 1080 },
} as const;
export type PostcardFormat = keyof typeof postcardFormats;
export const postcardFormatOrder: PostcardFormat[] = ["square", "portrait", "story", "landscape"];

export interface PostcardTemplate {
  /** Uno o dos colores: dos dibujan un degradado diagonal. */
  background: readonly [string] | readonly [string, string];
  label: string;
  accent: string;
  muted: string;
  text: string;
  font: PostcardFont;
  texture: PostcardTexture;
}

export const postcardTemplates = {
  papel: {
    accent: "#c99232",
    background: ["#f6efe1"],
    font: "display",
    label: "Papel",
    muted: "#7a6d58",
    text: "#25231f",
    texture: "paper",
  },
  tinta: {
    accent: "#d9a441",
    background: ["#171614"],
    font: "display",
    label: "Tinta",
    muted: "#a89c86",
    text: "#fbf6ec",
    texture: "grain",
  },
  bosque: {
    accent: "#e2b766",
    background: ["#365b48"],
    font: "reading",
    label: "Bosque",
    muted: "#c2d3c7",
    text: "#fbf6ec",
    texture: "none",
  },
  terracota: {
    accent: "#fff3df",
    background: ["#e0995a", "#b9674f"],
    font: "display",
    label: "Terracota",
    muted: "#fbe3cf",
    text: "#fff8ee",
    texture: "grain",
  },
  minimal: {
    accent: "#c99232",
    background: ["#ffffff"],
    font: "sans",
    label: "Mínimo",
    muted: "#6b6b6b",
    text: "#111111",
    texture: "none",
  },
  noche: {
    accent: "#f0c46c",
    background: ["#22304f", "#121829"],
    font: "reading",
    label: "Noche",
    muted: "#9aa4c2",
    text: "#eef1fa",
    texture: "none",
  },
} as const satisfies Record<string, PostcardTemplate>;
export type PostcardTemplateId = keyof typeof postcardTemplates;
export const postcardTemplateOrder = Object.keys(postcardTemplates) as PostcardTemplateId[];

export type PostcardFont = "display" | "reading" | "sans";
export const postcardFontLabels: Record<PostcardFont, string> = {
  display: "Titular",
  reading: "Libro",
  sans: "Moderna",
};

export type PostcardTexture = "grain" | "none" | "paper";
export const postcardTextureLabels: Record<PostcardTexture, string> = {
  grain: "Grano",
  none: "Ninguna",
  paper: "Papel",
};

export const postcardFilters = {
  cool: { css: "saturate(0.9) hue-rotate(12deg) brightness(1.03)", label: "Frío" },
  contrast: { css: "contrast(1.25) saturate(1.1)", label: "Contraste" },
  mono: { css: "grayscale(1) contrast(1.08)", label: "Blanco y negro" },
  none: { css: "none", label: "Original" },
  sepia: { css: "sepia(0.75) contrast(1.05)", label: "Sepia" },
  warm: { css: "sepia(0.25) saturate(1.2) hue-rotate(-8deg)", label: "Cálido" },
} as const;
export type PostcardFilter = keyof typeof postcardFilters;
export const postcardFilterOrder: PostcardFilter[] = ["none", "mono", "sepia", "warm", "cool", "contrast"];

/** Cómo entra la imagen recortada: encima del texto, detrás de él o enmarcada. */
export type PostcardImageLayout = "background" | "framed" | "top";
export const postcardImageLayoutLabels: Record<PostcardImageLayout, string> = {
  background: "De fondo",
  framed: "Enmarcada",
  top: "Arriba",
};

export interface PostcardContent {
  author: string | null;
  /** Recorte de la página, si la postal nace de uno. */
  image: Blob | null;
  page: number | null;
  quote: string;
  title: string;
}

export interface PostcardDesign {
  align: "center" | "start";
  /** Fondo propio: un color o una imagen del dispositivo en lugar del de la plantilla. */
  backgroundColor: string | null;
  backgroundImage: Blob | null;
  blur: number;
  filter: PostcardFilter;
  /** Punto que se conserva al encajar la imagen: 0 a 1 en cada eje. */
  focalX: number;
  focalY: number;
  font: PostcardFont;
  format: PostcardFormat;
  imageLayout: PostcardImageLayout;
  /** Capa oscura entre la imagen y el texto, de 0 a 0,85: lo que hace legible la cita. */
  scrim: number;
  showAuthor: boolean;
  showBrand: boolean;
  showImage: boolean;
  showPage: boolean;
  showQuote: boolean;
  showTitle: boolean;
  template: PostcardTemplateId;
  textScale: number;
  texture: PostcardTexture;
}

export function defaultPostcardDesign(content: PostcardContent, remembered?: Partial<PostcardDesign>): PostcardDesign {
  const template = remembered?.template ?? "papel";
  const templateInfo = postcardTemplates[template];
  return {
    align: "center",
    backgroundColor: null,
    backgroundImage: null,
    blur: 0,
    filter: "none",
    focalX: 0.5,
    focalY: 0.5,
    font: remembered?.font ?? templateInfo.font,
    format: remembered?.format ?? "square",
    imageLayout: content.quote ? "top" : "framed",
    scrim: 0.45,
    showAuthor: true,
    showBrand: remembered?.showBrand ?? true,
    showImage: Boolean(content.image),
    showPage: content.page !== null,
    showQuote: Boolean(content.quote.trim()),
    showTitle: true,
    template,
    textScale: 1,
    texture: templateInfo.texture,
  };
}

// ---- Derechos ------------------------------------------------------------------------

/**
 * Límite de una cita breve. No es una cifra legal —el derecho de cita depende del país y del
 * uso—, sino la medida que se recomienda: un fragmento que ilustra, con su referencia, y no
 * un trozo que sustituya a la obra.
 */
export const shortQuoteWords = 60;

export function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function isLongQuote(text: string) {
  return countWords(text) > shortQuoteWords;
}

export function shortenQuote(text: string, words = shortQuoteWords) {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= words) return text.trim();
  return `${parts.slice(0, words).join(" ").replace(/[,;:.]+$/, "")}…`;
}

/** «— Autor, Título, p. 12», con lo que el diseño decida mostrar. */
export function attributionParts(content: PostcardContent, design: PostcardDesign) {
  const author = design.showAuthor && content.author ? content.author.trim() : null;
  const title = design.showTitle && content.title.trim() ? content.title.trim() : null;
  const page = design.showPage && content.page !== null ? `p. ${content.page}` : null;
  return { author, page, title };
}

/** Texto que acompaña a la postal al compartirla: la cita y su referencia. */
export function postcardShareText(content: PostcardContent, design: PostcardDesign, limit = 600) {
  const { author, page, title } = attributionParts(content, { ...design, showAuthor: true, showPage: true, showTitle: true });
  const reference = [author, title ? `«${title}»` : null, page].filter(Boolean).join(", ");
  const quote = design.showQuote ? content.quote.trim() : "";
  const body = quote ? `“${quote.length > limit ? `${quote.slice(0, limit).trimEnd()}…` : quote}”` : "";
  return [body, reference ? `— ${reference}` : ""].filter(Boolean).join("\n");
}

// ---- Maquetación del texto -----------------------------------------------------------

export type MeasureText = (text: string, fontSize: number) => number;

/** Reparte el texto en renglones de `maxWidth` como mucho; una palabra más larga se corta. */
export function wrapText(measure: MeasureText, text: string, fontSize: number, maxWidth: number) {
  const lines: string[] = [];

  for (const paragraph of text.split(/\n+/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    let line = "";

    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate, fontSize) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      if (measure(word, fontSize) <= maxWidth) {
        line = word;
        continue;
      }
      // Una palabra que no cabe sola se parte por caracteres.
      let piece = "";
      for (const character of word) {
        if (measure(piece + character, fontSize) > maxWidth && piece) {
          lines.push(piece);
          piece = character;
        } else {
          piece += character;
        }
      }
      line = piece;
    }

    if (line) lines.push(line);
  }

  return lines;
}

export interface FittedText {
  fontSize: number;
  lineHeight: number;
  lines: string[];
  truncated: boolean;
}

/**
 * El tamaño más grande con el que el texto cabe en la caja, entre `minSize` y `maxSize`.
 * Si ni al mínimo cabe, se queda en el mínimo y el último renglón termina en «…»: la persona
 * lo ve en la vista previa y puede acortar la cita.
 */
export function fitText(
  measure: MeasureText,
  text: string,
  box: { height: number; width: number },
  options: { lineHeight: number; maxSize: number; minSize: number },
): FittedText {
  const clean = text.trim();
  if (!clean) return { fontSize: options.maxSize, lineHeight: options.maxSize * options.lineHeight, lines: [], truncated: false };

  for (let size = options.maxSize; size >= options.minSize; size -= 2) {
    const lines = wrapText(measure, clean, size, box.width);
    if (lines.length * size * options.lineHeight <= box.height) {
      return { fontSize: size, lineHeight: size * options.lineHeight, lines, truncated: false };
    }
  }

  const size = options.minSize;
  const lineHeight = size * options.lineHeight;
  const fitting = Math.max(1, Math.floor(box.height / lineHeight));
  const lines = wrapText(measure, clean, size, box.width);
  const kept = lines.slice(0, fitting);
  let last = kept.at(-1) ?? "";
  while (last && measure(`${last}…`, size) > box.width) last = last.slice(0, -1).trimEnd();
  kept[kept.length - 1] = `${last}…`;
  return { fontSize: size, lineHeight, lines: kept, truncated: true };
}

/**
 * Encaje de una imagen en un hueco, cubriéndolo sin deformarla y conservando el punto focal:
 * devuelve qué parte de la imagen se toma (`sx`, `sy`, `sw`, `sh`).
 */
export function coverCrop(
  image: { height: number; width: number },
  box: { height: number; width: number },
  focal: { x: number; y: number },
) {
  const scale = Math.max(box.width / image.width, box.height / image.height);
  const sw = box.width / scale;
  const sh = box.height / scale;
  const sx = Math.min(image.width - sw, Math.max(0, focal.x * image.width - sw / 2));
  const sy = Math.min(image.height - sh, Math.max(0, focal.y * image.height - sh / 2));
  return { sh, sw, sx, sy };
}

export function postcardFileName(content: PostcardContent) {
  const slug = content.title
    .normalize("NFD")
    .replaceAll(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("es")
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 48);
  return `postal-${slug || "pliegue"}${content.page !== null ? `-p${content.page}` : ""}.png`;
}
