/**
 * Copia a `public/tesseract/` lo que el OCR necesita para leer el texto de una imagen en el
 * navegador (03.5): el worker de tesseract.js, su núcleo en WebAssembly y los datos de cada
 * idioma.
 *
 * Por defecto tesseract.js los descargaría de un CDN. Servirlos desde el propio origen es lo que
 * mantiene la promesa del producto, como con pdf.js: leer una página escaneada no habla con
 * nadie y la imagen no sale del equipo.
 *
 * - `worker.min.js`: el worker que hace el reconocimiento fuera del hilo de la interfaz.
 * - `core/`: el núcleo, solo LSTM (el motor moderno) y en sus tres variantes; el worker elige la
 *   que admite el navegador (SIMD relajado, SIMD o ninguna).
 * - `lang/`: los datos `best_int` (LSTM, enteros: pequeños y rápidos) de los idiomas a los que
 *   Pliegue traduce, comprimidos. Se descargan solo cuando hacen falta y el navegador los guarda.
 *
 * Se ejecuta antes de `dev` y de `build`; el destino está en .gitignore porque es una copia
 * derivada de node_modules.
 */
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const tesseractRoot = dirname(require.resolve("tesseract.js/package.json"));
const coreRoot = dirname(createRequire(join(tesseractRoot, "package.json")).resolve("tesseract.js-core/package.json"));
const { version } = require("tesseract.js/package.json");
const destination = join(process.cwd(), "public", "tesseract");
const cores = ["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"];
/** Los idiomas de los libros que Pliegue traduce, con su código de Tesseract. */
const languages = ["eng", "spa", "por", "fra", "ita", "deu"];

await rm(destination, { force: true, recursive: true });
await mkdir(join(destination, "core"), { recursive: true });
await mkdir(join(destination, "lang"), { recursive: true });

await copyFile(join(tesseractRoot, "dist", "worker.min.js"), join(destination, "worker.min.js"));
for (const core of cores) await copyFile(join(coreRoot, core), join(destination, "core", core));
for (const language of languages) {
  const data = dirname(require.resolve(`@tesseract.js-data/${language}/package.json`));
  await copyFile(join(data, "4.0.0_best_int", `${language}.traineddata.gz`), join(destination, "lang", `${language}.traineddata.gz`));
}

await writeFile(join(destination, "VERSION"), `tesseract.js ${version}\n`, "utf8");
console.log(`tesseract.js ${version}: copiados el worker, ${cores.length} núcleos y ${languages.join(", ")} a public/tesseract/`);
