"use client";

/**
 * Leer el texto de una imagen en el propio navegador (03.5), con tesseract.js: gratis y sin que
 * la imagen salga del equipo. Decisión del dueño (5-nov) frente a leerla con una IA.
 *
 * El worker, el núcleo y los datos de cada idioma se sirven desde el propio origen
 * (`public/tesseract/`, ver `scripts/copy-tesseract-assets.mjs`). La primera vez se descargan
 * los datos del idioma del libro —de 0,7 a 3 MB— y el navegador los guarda para la siguiente.
 */

/** Los idiomas del OCR, por el código corto con que Pliegue nombra el idioma de un libro. */
const tesseractCodes: Readonly<Record<string, string>> = {
  de: "deu",
  en: "eng",
  es: "spa",
  fr: "fra",
  it: "ita",
  pt: "por",
};

/** Con qué idiomas leer: el del libro si lo hay; si no, inglés y español a la vez. */
export function ocrLanguages(bookLanguage: string | null | undefined) {
  const code = bookLanguage ? tesseractCodes[bookLanguage.toLowerCase().split("-")[0] ?? ""] : undefined;
  return code ?? "eng+spa";
}

/**
 * Del texto que devuelve el OCR al que se lee y se traduce: los renglones de un párrafo, unidos;
 * las palabras cortadas a final de renglón («pala-/bra»), enteras; los párrafos, separados.
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

export interface OcrProgress {
  /** De 0 a 1 en cada etapa. */
  fraction: number;
  /** «loading»: preparar el lector y el idioma (la primera vez, descargarlo); «reading»: leer. */
  stage: "loading" | "reading";
}

export interface OcrResult {
  /** Confianza media de Tesseract, de 0 a 100: lo que se enseña para revisar. */
  confidence: number;
  text: string;
}

type OcrWorker = Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>>;

let current: { languages: string; worker: Promise<OcrWorker> } | null = null;
let listener: ((progress: OcrProgress) => void) | null = null;

async function createOcrWorker(languages: string) {
  const { createWorker, OEM } = await import("tesseract.js");
  return createWorker(languages, OEM.LSTM_ONLY, {
    corePath: "/tesseract/core",
    langPath: "/tesseract/lang",
    logger: (message) => {
      listener?.({
        fraction: Number.isFinite(message.progress) ? Math.min(1, Math.max(0, message.progress)) : 0,
        stage: message.status.startsWith("recognizing") ? "reading" : "loading",
      });
    },
    workerPath: "/tesseract/worker.min.js",
  });
}

/**
 * Lee el texto de una imagen. El lector se queda abierto para la siguiente zona del mismo libro;
 * si cambia el idioma, se abre otro.
 */
export async function recognizeText(image: Blob, bookLanguage: string | null, onProgress?: (progress: OcrProgress) => void): Promise<OcrResult> {
  const languages = ocrLanguages(bookLanguage);
  if (!current || current.languages !== languages) {
    const previous = current;
    current = { languages, worker: createOcrWorker(languages) };
    void previous?.worker.then((worker) => worker.terminate()).catch(() => undefined);
  }
  const opened = current;
  listener = onProgress ?? null;
  try {
    const worker = await opened.worker;
    const { data } = await worker.recognize(image);
    return { confidence: Math.round(data.confidence), text: cleanOcrText(data.text) };
  } catch (error) {
    // Un lector que no llegó a abrirse no se reutiliza: la siguiente vez se intenta de nuevo.
    if (current === opened) current = null;
    const reason = error instanceof Error && error.message ? ` (${error.message.slice(0, 120)})` : "";
    throw new Error(`No se pudo leer el texto de la imagen${reason}. Comprueba la conexión la primera vez: hay que descargar el idioma.`);
  } finally {
    listener = null;
  }
}
