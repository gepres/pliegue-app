import { describe, expect, it } from "vitest";

import { checkApiKey, normalizeApiKey } from "./api-key";

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

describe("limpieza de lo que se pega junto con la clave", () => {
  const key = `sk-proj-${"a1B2_c3-".repeat(6)}`;

  it("quita la cabecera, la variable, las comillas y los caracteres invisibles", () => {
    expect(normalizeApiKey(`Bearer ${key}`)).toEqual({ key, removed: ["«Bearer»"] });
    expect(normalizeApiKey(`Authorization: Bearer ${key}`).key).toBe(key);
    expect(normalizeApiKey(`x-api-key: ${key}`).key).toBe(key);
    expect(normalizeApiKey(`OPENAI_API_KEY="${key}"`)).toEqual({
      key,
      removed: ["el nombre de la variable", "las comillas"],
    });
    expect(normalizeApiKey(`export ANTHROPIC_API_KEY='${key}'`).key).toBe(key);
    expect(normalizeApiKey(`"Bearer ${key}"`).key).toBe(key);
    expect(normalizeApiKey(`​${key}﻿`)).toEqual({ key, removed: ["caracteres invisibles"] });
  });

  it("deja igual una clave limpia y no toca los espacios de en medio", () => {
    expect(normalizeApiKey(`  ${key}\n`)).toEqual({ key, removed: [] });
    // Un texto pegado por error sigue siendo texto: la comprobación lo rechaza igual.
    const pegado = "Catálogo inteligente del espacio Autor, título canónico, año, género.";
    expect(checkApiKey("openai", normalizeApiKey(pegado).key).error).toMatch(/espacios o saltos/);
    expect(checkApiKey("openai", normalizeApiKey(`${key} Copiar`).key).error).toMatch(/espacios o saltos/);
  });
});
