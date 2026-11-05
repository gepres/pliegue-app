import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([
    "**/.next/**",
    "**/dist/**",
    "**/coverage/**",
    "**/.turbo/**",
    "**/next-env.d.ts",
    // Copia literal de pdfjs-dist que produce scripts/copy-pdfjs-assets.mjs: es código de
    // terceros ya empaquetado, y revisarlo aquí solo genera avisos que nadie puede atender.
    "apps/web/public/pdfjs/**",
    // Lo mismo con tesseract.js (scripts/copy-tesseract-assets.mjs): sin esto, `pnpm lint`
    // falla en local después de compilar.
    "apps/web/public/tesseract/**",
  ]),
]);
