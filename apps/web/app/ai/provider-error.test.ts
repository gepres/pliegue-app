import { describe, expect, it } from "vitest";

import { classifyProviderFailure } from "./provider-error";

describe("clasificación del fallo del proveedor", () => {
  it("distingue el modelo inexistente de la credencial inválida", () => {
    const modelo = classifyProviderFailure(
      "openai",
      404,
      { error: { code: "model_not_found", message: "The model 'gpt-x' does not exist" } },
      "gpt-x",
    );
    const credencial = classifyProviderFailure(
      "openai",
      401,
      { error: { code: "invalid_api_key", message: "Incorrect API key provided" } },
      "gpt-x",
    );

    expect(modelo.kind).toBe("model");
    expect(modelo.message).toContain("no existe");
    expect(modelo.message).toContain("gpt-x");
    expect(credencial.kind).toBe("credential");
    expect(credencial.message).toContain("API key");
    // El motivo de la tarjeta: los dos fallan en la primera llamada y antes se leían igual.
    expect(modelo.message).not.toBe(credencial.message);
  });

  it("nombra ambas causas descartando la otra, que es lo que costaba diagnosticar", () => {
    const modelo = classifyProviderFailure("openai", 404, {}, "gpt-x");
    const credencial = classifyProviderFailure("openai", 401, {}, "gpt-x");

    expect(modelo.message).toMatch(/no es un problema de la credencial/i);
    expect(credencial.message).toMatch(/no es un problema del modelo/i);
  });

  it("lee los tipos de error de Anthropic", () => {
    const modelo = classifyProviderFailure(
      "anthropic",
      404,
      { error: { message: "model: claude-x", type: "not_found_error" }, type: "error" },
      "claude-x",
    );
    const credencial = classifyProviderFailure(
      "anthropic",
      401,
      { error: { message: "invalid x-api-key", type: "authentication_error" }, type: "error" },
      "claude-x",
    );

    expect(modelo.kind).toBe("model");
    expect(credencial.kind).toBe("credential");
  });

  it("reconoce el modelo sin descargar de Ollama, que responde con texto plano", () => {
    const fallo = classifyProviderFailure(
      "ollama",
      404,
      { error: 'model "qwen3:8b" not found, try pulling it first' },
      "qwen3:8b",
    );

    expect(fallo.kind).toBe("model");
    expect(fallo.message).toContain("ollama pull qwen3:8b");
  });

  it("responde con el código de la causa en lugar de aplanarlo todo en 502", () => {
    expect(classifyProviderFailure("openai", 404, {}, "m").status).toBe(404);
    expect(classifyProviderFailure("openai", 401, {}, "m").status).toBe(401);
    expect(classifyProviderFailure("openai", 403, {}, "m").status).toBe(403);
    expect(classifyProviderFailure("openai", 429, {}, "m").status).toBe(429);
  });

  it("conserva el texto del proveedor cuando la causa no se reconoce", () => {
    const fallo = classifyProviderFailure(
      "openai",
      500,
      { error: { message: "The server had an error" } },
      "m",
    );

    expect(fallo.kind).toBe("provider");
    expect(fallo.message).toBe("The server had an error");
    expect(fallo.status).toBe(502);
  });
});
