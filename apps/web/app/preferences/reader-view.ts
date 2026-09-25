/**
 * Cómo se compone la columna de lectura en esta pantalla: de momento, su ancho.
 *
 * Va aparte de las preferencias de lectura con precedencia (documento → Área → cuenta →
 * dispositivo) por la misma razón que el marco plegado: el ancho de línea cómodo depende
 * del tamaño de esta pantalla, no de la persona ni del documento.
 */
export const readerMeasures = ["narrow", "normal", "wide"] as const;
export type ReaderMeasure = (typeof readerMeasures)[number];

export interface ReaderViewState {
  measure: ReaderMeasure;
  version: 1;
}

export const defaultReaderView: ReaderViewState = { measure: "normal", version: 1 };

/** Caracteres por línea de cada medida. 66 es el centro del intervalo cómodo de 45 a 75. */
export const readerMeasureCharacters: Record<ReaderMeasure, number> = {
  narrow: 56,
  normal: 66,
  wide: 80,
};

export function parseReaderView(value: unknown): ReaderViewState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaultReaderView;
  const candidate = value as Partial<ReaderViewState>;
  if (candidate.version !== 1) return defaultReaderView;
  return {
    measure: readerMeasures.includes(candidate.measure as ReaderMeasure)
      ? (candidate.measure as ReaderMeasure)
      : defaultReaderView.measure,
    version: 1,
  };
}
