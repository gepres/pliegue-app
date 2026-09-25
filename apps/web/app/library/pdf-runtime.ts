/**
 * Lo que comparten el extractor de texto y el visor: un único worker por sesión, la ruta de
 * los recursos auxiliares y la traducción de los fallos de pdf.js a algo que se pueda leer.
 *
 * Vive aparte porque las dos tareas le piden lo contrario al abrir el mismo archivo. Extraer
 * texto no necesita fuentes ni decodificadores de imagen, y desactivarlos evita descargas en
 * una función que promete trabajo estrictamente local. Dibujar sin ellos, en cambio, produce
 * páginas en blanco: un PDF puede declarar Helvetica sin incrustarla, y un escaneado suele
 * traer sus imágenes en JBIG2 o JPEG 2000.
 */

type PdfjsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfWorker = InstanceType<PdfjsModule["PDFWorker"]>;

/** Copia local de `standard_fonts`, `cmaps` y `wasm`; la produce `copy-pdfjs-assets.mjs`. */
const assetsBase = "/pdfjs/";

/**
 * Un único worker para toda la sesión. Arrancarlo cuesta segundos, así que crearlo por
 * documento haría inviable indexar una carpeta entera; compartirlo mantiene ese coste en una
 * sola vez y, sobre todo, saca el trabajo del hilo que dibuja la interfaz.
 */
let sharedWorker: PdfWorker | null = null;

export function loadPdfjs() {
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

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

export function describePdfFailure(error: unknown) {
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
 * `text` abre el documento para leerlo; `display` para dibujarlo. La diferencia no es un
 * matiz de rendimiento: con la configuración de `text` una página se dibuja vacía.
 */
export type PdfIntent = "display" | "text";

function documentParameters(intent: PdfIntent) {
  if (intent === "text") {
    return {
      disableFontFace: true,
      useSystemFonts: false,
      useWasm: false,
      useWorkerFetch: false,
    };
  }

  return {
    cMapPacked: true,
    cMapUrl: `${assetsBase}cmaps/`,
    standardFontDataUrl: `${assetsBase}standard_fonts/`,
    // Las tres rutas apuntan al propio origen, nunca a un CDN: el documento se dibuja sin
    // que la aplicación hable con nadie.
    useWasm: true,
    wasmUrl: `${assetsBase}wasm/`,
  };
}

export interface OpenedPdf {
  /** Cierra el documento y su tarea de carga. El worker compartido sigue vivo. */
  close: () => Promise<void>;
  document: Awaited<ReturnType<PdfjsModule["getDocument"]>["promise"]>;
}

/**
 * Abre un PDF ya cargado en memoria. El llamante se encarga de cerrarlo: mientras el
 * documento viva, pdf.js conserva sus páginas y sus fuentes en memoria.
 */
export async function openPdfDocument(
  data: Uint8Array,
  intent: PdfIntent,
): Promise<OpenedPdf> {
  const pdfjs = await loadPdfjs();
  const worker = await resolveWorker(pdfjs);
  const task = pdfjs.getDocument({
    data,
    verbosity: 0,
    ...documentParameters(intent),
    ...(worker ? { worker } : {}),
  });

  try {
    const document = await task.promise;
    return {
      close: () => task.destroy().catch(() => undefined),
      document,
    };
  } catch (error) {
    await task.destroy().catch(() => undefined);
    throw new Error(describePdfFailure(error));
  }
}
