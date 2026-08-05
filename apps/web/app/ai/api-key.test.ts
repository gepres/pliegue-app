import { describe, expect, it } from "vitest";

import { checkApiKey } from "./api-key";

describe("comprobación de credenciales antes de enviarlas", () => {
  it("rechaza un texto pegado por error en lugar de la clave", () => {
    const pegado =
      "Catálogo inteligente del espacio Autor, título canónico, año, género, tipo de obra, idioma, temas y resumen se guardan como una capa derivada local.";

    expect(checkApiKey("openai", pegado).error).toMatch(/espacios o saltos/);
  });

  it("rechaza saltos de línea, valores vacíos y longitudes imposibles", () => {
    expect(checkApiKey("openai", "sk-abc\ndef").error).toMatch(/espacios o saltos/);
    expect(checkApiKey("openai", "   ").error).toMatch(/Añade la API key/);
    expect(checkApiKey("openai", "sk-corta").error).toMatch(/demasiado corta/);
    expect(checkApiKey("openai", `sk-${"a".repeat(600)}`).error).toMatch(/demasiado largo/);
  });

  it("acepta claves con el formato habitual de cada proveedor", () => {
    expect(checkApiKey("openai", `sk-${"a".repeat(48)}`)).toEqual({
      error: null,
      warning: null,
    });
    expect(checkApiKey("anthropic", `sk-ant-${"a".repeat(48)}`)).toEqual({
      error: null,
      warning: null,
    });
  });

  it("avisa del prefijo inesperado sin bloquear el envío", () => {
    const check = checkApiKey("anthropic", `sk-${"a".repeat(48)}`);

    expect(check.error).toBeNull();
    expect(check.warning).toMatch(/sk-ant-/);
  });
});
