import eslint from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import typeScriptEslint from "typescript-eslint";

export default defineConfig([
  eslint.configs.recommended,
  ...typeScriptEslint.configs.recommended,
  globalIgnores(["**/dist/**", "**/coverage/**"]),
]);
