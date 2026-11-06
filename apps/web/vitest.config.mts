import { defineConfig } from "vitest/config";

export default defineConfig({
  // Next conserva JSX para compilarlo después; las pruebas de componentes lo ejecutan aquí.
  oxc: { jsx: { runtime: "automatic" } },
});
