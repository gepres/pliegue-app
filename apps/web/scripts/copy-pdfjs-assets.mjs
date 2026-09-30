/**
 * Copia a `public/pdfjs/` los recursos que pdf.js pide por red al dibujar una página.
 *
 * Son tres y ninguno es opcional para un lector serio:
 *
 * - `standard_fonts/`: las catorce fuentes base de PostScript. Un PDF puede declarar
 *   Helvetica sin incrustarla, y entonces pdf.js necesita este archivo o la página sale
 *   sin texto.
 * - `cmaps/`: las tablas que traducen los códigos de carácter de los PDF con escritura
 *   china, japonesa o coreana.
 * - `wasm/`: los decodificadores de JBIG2 y JPEG 2000, que son justamente los formatos
 *   en que suelen venir las imágenes de un documento escaneado.
 *
 * pdf.js los descargaría de un CDN si se le dejara. Servirlos desde el propio origen es lo
 * que mantiene en pie la promesa del producto: abrir un documento no habla con nadie.
 *
 * Se ejecuta antes de `dev` y de `build`; el destino está en .gitignore porque es una copia
 * derivada de node_modules y debe seguir la versión del paquete, no la del repositorio.
 */
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const packageRoot = dirname(require.resolve("pdfjs-dist/package.json"));
const { version } = require("pdfjs-dist/package.json");
const destination = join(process.cwd(), "public", "pdfjs");
const directories = ["standard_fonts", "cmaps", "wasm"];

await rm(destination, { force: true, recursive: true });
await mkdir(destination, { recursive: true });

for (const directory of directories) {
  await cp(join(packageRoot, directory), join(destination, directory), {
    recursive: true,
  });
}

// Deja constancia de qué versión produjo la copia: si el paquete sube y el directorio no,
// el desajuste se ve aquí antes que en una página que no dibuja.
await writeFile(
  join(destination, "VERSION"),
  `pdfjs-dist ${version}\n`,
  "utf8",
);

console.log(`pdf.js ${version}: copiados ${directories.join(", ")} a public/pdfjs/`);
