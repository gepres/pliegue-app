/**
 * Crea el hilo donde pdf.js hace la extracción.
 *
 * Vive en su propio módulo por dos razones: `new URL(..., import.meta.url)` es una señal que
 * el empaquetador resuelve en tiempo de compilación —emitiendo el worker como un recurso
 * propio— y así el entorno de pruebas, que corre en Node y no tiene `Worker`, nunca importa
 * este archivo.
 *
 * La versión del worker debe coincidir con la del API, de ahí que ambos salgan de `legacy/`.
 */
export function createPdfWorkerPort() {
  return new Worker(new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url), {
    name: "pliegue-pdf",
    type: "module",
  });
}
