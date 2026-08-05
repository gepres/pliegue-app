export const maxPdfInputBytes = 50 * 1024 * 1024;
export const maxPdfPages = 300;
export const maxPdfTextCharacters = 1_000_000;

export interface PdfTextPage {
  number: number;
  text: string;
}

export interface PdfTextExtraction {
  pageCount: number;
  pages: PdfTextPage[];
  truncated: boolean;
}

export interface PdfTextExtractionOptions {
  /** Corta la extracción al alcanzar este número de caracteres. */
  maxCharacters?: number;
  /** Deja de recorrer páginas al llegar a este número. */
  maxPages?: number;
}

interface PdfTextItem {
  hasEOL?: boolean;
  str?: string;
}

type PdfjsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfWorker = InstanceType<PdfjsModule["PDFWorker"]>;

/**
 * Un único worker para toda la sesión. Arrancarlo cuesta segundos, así que crearlo por
 * documento haría inviable indexar una carpeta entera; compartirlo mantiene ese coste en una
 * sola vez y, sobre todo, saca la extracción del hilo que dibuja la interfaz.
 */
let sharedWorker: PdfWorker | null = null;

async function resolveWorker(pdfjs: PdfjsModule) {
  // En Node —las pruebas— no hay `Worker`: pdf.js recurre a su modo en hilo principal, que
  // ahí no molesta a nadie.
  if (typeof Worker === "undefined") return undefined;
  if (sharedWorker && !sharedWorker.destroyed) return sharedWorker;

  try {
    const { createPdfWorkerPort } = await import("./pdf-worker");
    sharedWorker = pdfjs.PDFWorker.create({ port: createPdfWorkerPort(), verbosity: 0 });
    return sharedWorker;
  } catch {
    // Si el navegador o el empaquetado impiden crear el worker, seguir sin él es preferible
    // a no poder abrir un PDF.
    sharedWorker = null;
    return undefined;
  }
}

/** Libera el worker compartido. Pensado para pruebas y para cerrar la sesión de lectura. */
export function releasePdfWorker() {
  sharedWorker?.destroy();
  sharedWorker = null;
}

function normalizePageText(value: string) {
  return value
    .replaceAll(/\r/g, "")
    .replaceAll(/[\t\f\v ]+/g, " ")
    .replaceAll(/ *\n */g, "\n")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim();
}

function describeFailure(error: unknown) {
  const name = error instanceof Error ? error.name : "";

  if (name === "PasswordException") {
    return "El PDF está protegido con contraseña y no puede extraerse.";
  }
  if (name === "InvalidPDFException") {
    return "El archivo está dañado o no contiene un PDF válido.";
  }

  return "No fue posible extraer el contenido del PDF.";
}

/**
 * Extrae el texto de un PDF dentro del navegador, sin subirlo a ningún servidor.
 * pdf.js se carga bajo demanda igual que fflate en el extractor estructurado, para
 * que ningún otro formato pague su coste.
 */
export async function extractPdfText(
  blob: Blob,
  options: PdfTextExtractionOptions = {},
): Promise<PdfTextExtraction> {
  if (blob.size > maxPdfInputBytes) {
    throw new Error("El archivo supera el límite de 50 MB para extracción local.");
  }

  const characterLimit = Math.max(1, options.maxCharacters ?? maxPdfTextCharacters);
  const pageLimit = Math.max(1, options.maxPages ?? maxPdfPages);

  const [pdfjs, buffer] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    blob.arrayBuffer(),
  ]);

  // Extraer texto no necesita fuentes, WASM ni descargas auxiliares: desactivarlas evita
  // peticiones de red desde una función que promete trabajo estrictamente local.
  const worker = await resolveWorker(pdfjs);
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    useSystemFonts: false,
    useWasm: false,
    useWorkerFetch: false,
    verbosity: 0,
    ...(worker ? { worker } : {}),
  });

  let document: Awaited<typeof task.promise>;

  try {
    document = await task.promise;
  } catch (error) {
    await task.destroy().catch(() => undefined);
    throw new Error(describeFailure(error));
  }

  const pages: PdfTextPage[] = [];
  const pageCount = document.numPages;
  const readablePages = Math.min(pageCount, pageLimit);
  let truncated = readablePages < pageCount;
  let characters = 0;

  try {
    for (let number = 1; number <= readablePages; number += 1) {
      const page = await document.getPage(number);

      try {
        const content = await page.getTextContent();
        const text = normalizePageText(
          (content.items as PdfTextItem[])
            .map((item) => `${item.str ?? ""}${item.hasEOL ? "\n" : ""}`)
            .join(""),
        );

        if (text) {
          if (characters + text.length > characterLimit) {
            const remaining = characterLimit - characters;
            if (remaining > 0) pages.push({ number, text: text.slice(0, remaining) });
            truncated = true;
            break;
          }

          characters += text.length;
          pages.push({ number, text });
        }
      } finally {
        page.cleanup();
      }
    }
  } catch (error) {
    throw new Error(describeFailure(error));
  } finally {
    await task.destroy().catch(() => undefined);
  }

  return { pageCount, pages, truncated };
}

export function joinPdfPages(pages: readonly PdfTextPage[]) {
  return pages.map((page) => page.text).join("\n\n");
}
