import { describe, expect, it } from "vitest";

import { classifyProviderFailure, readRetryAfter } from "./provider-error";

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
    // Un 500 del proveedor es pasajero: se responde 503 y el navegador lo reintenta (04.2).
    expect(fallo.status).toBe(503);
    expect(fallo.retryable).toBe(true);
    // Uno que no se reconoce y no es pasajero, 502, sin reintento.
    expect(classifyProviderFailure("openai", 418, { error: { message: "teapot" } }, "m")).toMatchObject({ retryable: false, status: 502 });
  });
});

describe("límite por minuto frente a cupo agotado (04.2)", () => {
  const headers = (entries: Record<string, string>) => new Headers(entries);

  it("OpenAI: «rate_limit_exceeded» se reintenta, con su espera en milisegundos; «insufficient_quota», no", () => {
    const rate = classifyProviderFailure("openai", 429, { error: { code: "rate_limit_exceeded", message: "Rate limit reached" } }, "m", headers({ "retry-after-ms": "1500" }));
    expect(rate).toMatchObject({ kind: "rate", retryAfter: 2, retryable: true, status: 429 });
    expect(rate.message).toMatch(/por minuto/);
    const quota = classifyProviderFailure("openai", 429, { error: { code: "insufficient_quota", message: "You exceeded your current quota" } }, "m");
    expect(quota).toMatchObject({ kind: "quota", retryAfter: null, retryable: false, status: 429 });
    expect(quota.message).toMatch(/no lo arregla/);
  });

  it("Anthropic: límite por minuto, saturado (529) y sin saldo", () => {
    expect(classifyProviderFailure("anthropic", 429, { error: { type: "rate_limit_error" } }, "m", headers({ "retry-after": "12" }))).toMatchObject({ kind: "rate", retryAfter: 12, retryable: true });
    expect(classifyProviderFailure("anthropic", 529, { error: { message: "Overloaded", type: "overloaded_error" } }, "m")).toMatchObject({ kind: "provider", retryable: true, status: 503 });
    expect(classifyProviderFailure("anthropic", 402, { error: { type: "billing_error" } }, "m")).toMatchObject({ kind: "quota", retryable: false });
  });

  it("Gemini: el mismo RESOURCE_EXHAUSTED es límite por minuto (con su retryDelay) o cuota del día", () => {
    const perMinute = {
      error: {
        code: 429,
        details: [
          { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] },
          { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "16.4s" },
        ],
        status: "RESOURCE_EXHAUSTED",
      },
    };
    expect(classifyProviderFailure("gemini", 429, perMinute, "m")).toMatchObject({ kind: "rate", retryAfter: 17, retryable: true });
    const perDay = {
      error: {
        details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }],
        status: "RESOURCE_EXHAUSTED",
      },
    };
    expect(classifyProviderFailure("gemini", 429, perDay, "m")).toMatchObject({ kind: "quota", retryable: false });
  });

  it("Gemini sin cupo gratis para el modelo («limit: 0») o con el cupo del día agotado: no se reintenta y se dice por qué (6-nov)", () => {
    const zero = {
      error: {
        code: 429,
        message:
          "You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits.\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-3.5-flash-lite\nPlease retry in 41.2s.",
        status: "RESOURCE_EXHAUSTED",
      },
    };
    const failure = classifyProviderFailure("gemini", 429, zero, "gemini-3.5-flash-lite");
    expect(failure).toMatchObject({ kind: "quota", retryable: false });
    expect(failure.message).toMatch(/no tiene cupo gratis para el modelo «gemini-3\.5-flash-lite» \(límite 0\)/);
    // El detalle del proveedor, sin la dirección, para ver la causa en «Por qué fallaron».
    expect(failure.message).toMatch(/Detalle del proveedor: «generativelanguage\.googleapis\.com\/generate_content_free_tier_requests, limit: 0, model: gemini-3\.5-flash-lite»/);
    expect(failure.message).not.toMatch(/https?:/);

    const daily = {
      error: {
        details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }],
        message: "Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-3.5-flash-lite",
        status: "RESOURCE_EXHAUSTED",
      },
    };
    const dailyFailure = classifyProviderFailure("gemini", 429, daily, "gemini-3.5-flash-lite");
    expect(dailyFailure).toMatchObject({ kind: "quota", retryable: false });
    expect(dailyFailure.message).toMatch(/cupo diario de Gemini.*medianoche, hora del Pacífico/);
    expect(dailyFailure.message).toMatch(/limit: 20/);
  });

  it("Gemini por minuto, con la espera solo en el texto («Please retry in 17.37s»)", () => {
    const perMinute = {
      error: {
        message: "* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 15, model: gemini-3.5-flash-lite\nPlease retry in 17.37s.",
        status: "RESOURCE_EXHAUSTED",
      },
    };
    const failure = classifyProviderFailure("gemini", 429, perMinute, "m");
    expect(failure).toMatchObject({ kind: "rate", retryAfter: 18, retryable: true });
    expect(failure.message).toMatch(/límite de solicitudes por minuto\. Detalle del proveedor: «.*limit: 15/);
  });

  it("Azure, DeepL y LibreTranslate: 429 es límite por minuto; su cupo, no", () => {
    expect(classifyProviderFailure("azure", 429, {}, "")).toMatchObject({ kind: "rate", retryable: true });
    expect(classifyProviderFailure("azure", 403, {}, "")).toMatchObject({ kind: "quota", retryable: false });
    expect(classifyProviderFailure("deepl", 429, {}, "")).toMatchObject({ kind: "rate", retryable: true });
    expect(classifyProviderFailure("deepl", 456, {}, "")).toMatchObject({ kind: "quota", retryable: false });
    expect(classifyProviderFailure("libretranslate", 429, { error: "Slowdown: 20 per 1 minute" }, "", headers({ "retry-after": "Thu, 01 Jan 2099 00:00:00 GMT" }))).toMatchObject({ kind: "rate", retryable: true });
  });

  it("la clave, el modelo y el permiso no se reintentan", () => {
    expect(classifyProviderFailure("openai", 401, {}, "m").retryable).toBe(false);
    expect(classifyProviderFailure("openai", 404, {}, "m").retryable).toBe(false);
    expect(classifyProviderFailure("openai", 403, {}, "m").retryable).toBe(false);
  });
});

describe("cuánto pide esperar el proveedor", () => {
  it("lee los segundos, una fecha HTTP y el retryDelay de Gemini", () => {
    expect(readRetryAfter(new Headers({ "retry-after": "7" }), {})).toBe(7);
    expect(readRetryAfter(new Headers({ "retry-after": "Thu, 01 Jan 2026 00:00:30 GMT" }), {}, Date.parse("2026-01-01T00:00:00Z"))).toBe(30);
    expect(readRetryAfter(null, { error: { details: [{ retryDelay: "3s" }] } })).toBe(3);
    expect(readRetryAfter(new Headers(), {})).toBeNull();
  });
});
