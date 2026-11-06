// Corre las e2e de Pliegue una tras otra contra `BASE` (por defecto http://localhost:3300) y falla
// si alguna falla. `node e2e/run.mjs esqueletos accesibilidad` corre solo esas.
// Cada prueba es un script independiente: también se puede lanzar sola (`node e2e/duplicados.mjs`).
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const all = readdirSync(here)
  .filter((name) => name.endsWith(".mjs") && name !== "run.mjs")
  .map((name) => name.replace(/\.mjs$/, ""))
  .sort();
const wanted = process.argv.slice(2);
const specs = wanted.length ? all.filter((name) => wanted.includes(name)) : all;
const unknown = wanted.filter((name) => !all.includes(name));
if (unknown.length) {
  console.error(`No existen: ${unknown.join(", ")}. Hay: ${all.join(", ")}`);
  process.exit(2);
}

const results = [];
for (const spec of specs) {
  const started = Date.now();
  console.log(`\n━━ ${spec} ━━`);
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [join(here, `${spec}.mjs`)], { env: process.env, stdio: "inherit" });
    child.on("exit", (exitCode) => resolve(exitCode ?? 1));
  });
  results.push({ code, seconds: Math.round((Date.now() - started) / 1000), spec });
}

console.log("\n━━ Resumen ━━");
for (const { code, seconds, spec } of results) console.log(`${code === 0 ? "✓" : "✗"} ${spec} (${seconds} s)`);
const failed = results.filter((result) => result.code !== 0);
console.log(`\n${results.length - failed.length} de ${results.length} pruebas en verde`);
process.exit(failed.length ? 1 : 0);
