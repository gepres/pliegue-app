// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 04.6: «logs sin contenido sensible ni secretos». Las rutas de IA reciben textos de libros y
 * claves de proveedores; no escriben nada en la consola del servidor, donde Vercel lo guardaría.
 * Si algún día hace falta registrar algo, que sea con un módulo que no acepte texto libre.
 */
function routeFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

describe("rutas de IA sin registros", () => {
  it("ninguna ruta de /api/ai ni el código de IA del servidor escribe en la consola", () => {
    const files = [...routeFiles(join(__dirname)), join(__dirname, "../../ai/hosted-json.ts"), join(__dirname, "../../ai/provider-error.ts")];
    expect(files.length).toBeGreaterThan(3);
    const offenders = files.filter((file) => /\bconsole\.(log|info|warn|error|debug|trace)\s*\(/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
