/**
 * El filtro de lectura: cómo se tiñe, se atenúa o se enfoca la página mientras se lee, encima de
 * lo que ya decide el tema. Como el ancho de línea, depende de esta pantalla y de la luz de este
 * momento —de noche en el móvil, de día en el escritorio—, así que se guarda en el equipo y no
 * viaja con la cuenta.
 *
 * - Tono: una capa de color que se multiplica con la página. El blanco toma el color y el negro
 *   sigue negro, así que vale para un PDF escaneado igual que para un EPUB.
 * - Atenuar: una capa negra translúcida.
 * - PDF en modo noche: invierte el dibujo de las páginas del PDF (no la app).
 * - Enfoque: oscurece todo menos una banda alrededor de lo que se lee.
 */
export const readingTones = ["none", "sepia", "warm", "gray"] as const;
export const pdfNightModes = ["never", "dark", "always"] as const;
export const focusSizes = ["off", "narrow", "medium", "wide"] as const;

export type ReadingTone = (typeof readingTones)[number];
export type PdfNightMode = (typeof pdfNightModes)[number];
export type FocusSize = (typeof focusSizes)[number];

export interface ReadingFilterState {
  /** 0 = sin atenuar; como mucho 60, para no dejar la página a oscuras. */
  dim: number;
  focus: FocusSize;
  /** 10–100: cuánto pesa el tono. */
  intensity: number;
  pdfNight: PdfNightMode;
  tone: ReadingTone;
  version: 1;
}

export const defaultReadingFilter: ReadingFilterState = {
  dim: 0,
  focus: "off",
  intensity: 50,
  pdfNight: "never",
  tone: "none",
  version: 1,
};

export const maxDim = 60;

function clamp(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

function oneOf<Value extends string>(options: readonly Value[], value: unknown, fallback: Value): Value {
  return options.includes(value as Value) ? (value as Value) : fallback;
}

export function parseReadingFilter(value: unknown): ReadingFilterState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaultReadingFilter;
  const candidate = value as Partial<ReadingFilterState>;
  if (candidate.version !== 1) return defaultReadingFilter;
  return {
    dim: clamp(candidate.dim, 0, maxDim, defaultReadingFilter.dim),
    focus: oneOf(focusSizes, candidate.focus, defaultReadingFilter.focus),
    intensity: clamp(candidate.intensity, 10, 100, defaultReadingFilter.intensity),
    pdfNight: oneOf(pdfNightModes, candidate.pdfNight, defaultReadingFilter.pdfNight),
    tone: oneOf(readingTones, candidate.tone, defaultReadingFilter.tone),
    version: 1,
  };
}

export interface ToneLayer {
  background: string;
  blend: "multiply" | "saturation";
  opacity: number;
}

/**
 * Las capas de cada tono, de abajo arriba. A más intensidad, más opacas.
 * - Sepia: papel envejecido. Cálido: menos azul, como la luz nocturna de los móviles. Un color
 *   que se multiplica: el blanco lo toma y el negro sigue negro.
 * - Gris: papel neutro, como la tinta electrónica. Primero se quita el color —un gris en modo
 *   «saturation» deja la luz de la página y le quita el tono, también el amarillo de un escaneo—
 *   y luego un gris claro multiplicado apaga el blanco.
 */
const toneLayers: Record<Exclude<ReadingTone, "none">, ReadonlyArray<Omit<ToneLayer, "opacity">>> = {
  gray: [
    { background: "rgb(128 128 128)", blend: "saturation" },
    { background: "rgb(226 226 224)", blend: "multiply" },
  ],
  sepia: [{ background: "rgb(240 222 186)", blend: "multiply" }],
  warm: [{ background: "rgb(255 190 120)", blend: "multiply" }],
};

export function toneLayersFor(state: Pick<ReadingFilterState, "intensity" | "tone">): ToneLayer[] {
  if (state.tone === "none") return [];
  const opacity = Math.round(state.intensity) / 100;
  return toneLayers[state.tone].map((layer) => ({ ...layer, opacity }));
}

export function dimLayer(state: Pick<ReadingFilterState, "dim">) {
  return state.dim > 0 ? { opacity: state.dim / 100 } : null;
}

/** Alto de la banda visible del enfoque, en píxeles CSS: un renglón, unos tres, unos cinco. */
export const focusBandHeights: Record<Exclude<FocusSize, "off">, number> = {
  medium: 112,
  narrow: 56,
  wide: 180,
};

/** Dónde queda la banda: centrada en el puntero, sin salirse de la pantalla. */
export function focusBand(pointerY: number, viewportHeight: number, size: Exclude<FocusSize, "off">) {
  const height = Math.min(focusBandHeights[size], viewportHeight);
  const top = Math.min(Math.max(0, pointerY - height / 2), Math.max(0, viewportHeight - height));
  return { bottom: top + height, height, top };
}

/** ¿Hay algo del filtro activo? Para decirlo en el botón «Aa». */
export function readingFilterActive(state: ReadingFilterState) {
  return state.tone !== "none" || state.dim > 0 || state.pdfNight !== "never" || state.focus !== "off";
}
