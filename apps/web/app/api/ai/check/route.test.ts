import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const openAiKey = "sk-test-000000000000000000000000";
const anthropicKey = "sk-ant-test-0000000000000000000000";
const geminiKey = "AIzaTest000000000000000000000000000000";
const azureKey = "0123456789abcdef0123456789abcdef";

function request(body: Record<string, unknown>, apiKey = openAiKey) {
  return new Request("http://localhost/api/ai/check", {
    body: JSON.stringify(body),
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    method: "POST",
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("ruta «Probar conexión»", () => {
  it("no reenvía nada si falta la clave, si no lo parece o si el proveedor no es de esta ruta", async () => {
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);

    const sinClave = new Request("http://localhost/api/ai/check", {
      body: JSON.stringify({ model: "gpt-x", provider: "openai" }),
      method: "POST",
    });
    expect((await POST(sinClave)).status).toBe(401);
    expect((await POST(request({ model: "gpt-x", provider: "openai" }, "un texto pegado por error"))).status).toBe(400);
    expect((await POST(request({ model: "qwen3", provider: "ollama" }))).status).toBe(400);
    expect((await POST(request({ model: "", provider: "openai" }))).status).toBe(400);
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("con OpenAI pide la ficha del modelo con GET, sin cuerpo ni tokens", async () => {
    const providerFetch = vi.fn().mockResolvedValue(Response.json({ id: "gpt-x", object: "model" }));
    vi.stubGlobal("fetch", providerFetch);

    const response = await POST(request({ model: "gpt-x", provider: "openai" }));
    const [url, options] = providerFetch.mock.calls[0] as [string, RequestInit];

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ modelName: null, ok: true });
    expect(url).toBe("https://api.openai.com/v1/models/gpt-x");
    expect(options.method).toBe("GET");
    expect(options.body).toBeUndefined();
    expect((options.headers as Record<string, string>).authorization).toBe(`Bearer ${openAiKey}`);
  });

  it("con Anthropic usa la Models API con su cabecera y devuelve el nombre del modelo", async () => {
    const providerFetch = vi
      .fn()
      .mockResolvedValue(Response.json({ display_name: "Claude Haiku 4.5", id: "claude-haiku-4-5", type: "model" }));
    vi.stubGlobal("fetch", providerFetch);

    const response = await POST(request({ model: "claude-haiku-4-5", provider: "anthropic" }, anthropicKey));
    const [url, options] = providerFetch.mock.calls[0] as [string, RequestInit];
    const headers = options.headers as Record<string, string>;

    expect(await response.json()).toEqual({ modelName: "Claude Haiku 4.5", ok: true });
    expect(url).toBe("https://api.anthropic.com/v1/models/claude-haiku-4-5");
    expect(headers["x-api-key"]).toBe(anthropicKey);
    expect(headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("con Gemini acepta «models/…» y distingue el modelo inexistente de la clave mala", async () => {
    const noExiste = vi.fn().mockResolvedValue(
      Response.json({ error: { code: 404, message: "models/gemini-x is not found", status: "NOT_FOUND" } }, { status: 404 }),
    );
    vi.stubGlobal("fetch", noExiste);
    const modelo = await POST(request({ model: "models/gemini-x", provider: "gemini" }, geminiKey));
    const [url, options] = noExiste.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-x");
    expect((options.headers as Record<string, string>)["x-goog-api-key"]).toBe(geminiKey);
    expect(modelo.status).toBe(404);
    expect(((await modelo.json()) as { error: string }).error).toMatch(/«models\/gemini-x» no existe en Gemini/);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({ error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } }, { status: 400 }),
      ),
    );
    const credencial = await POST(request({ model: "gemini-3.5-flash-lite", provider: "gemini" }, geminiKey));
    expect(credencial.status).toBe(401);
    expect(((await credencial.json()) as { error: string }).error).toMatch(/no aceptó la API key/);
  });

  it("con Anthropic, una clave mala y la cuenta sin saldo se nombran por separado", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({ error: { message: "invalid x-api-key", type: "authentication_error" }, type: "error" }, { status: 401 }),
      ),
    );
    const credencial = await POST(request({ model: "claude-haiku-4-5", provider: "anthropic" }, anthropicKey));
    expect(credencial.status).toBe(401);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({ error: { message: "Your credit balance is too low", type: "billing_error" }, type: "error" }, { status: 402 }),
      ),
    );
    const saldo = await POST(request({ model: "claude-haiku-4-5", provider: "anthropic" }, anthropicKey));
    expect(saldo.status).toBe(429);
    expect(((await saldo.json()) as { error: string }).error).toMatch(/saldo agotado/);
  });

  it("con Azure traduce una palabra con la clave y la región del recurso", async () => {
    const providerFetch = vi.fn().mockResolvedValue(Response.json([{ translations: [{ text: "Hello", to: "en" }] }]));
    vi.stubGlobal("fetch", providerFetch);

    const response = await POST(request({ provider: "azure", region: " WestEurope " }, azureKey));
    const [url, options] = providerFetch.mock.calls[0] as [URL, RequestInit];
    const headers = options.headers as Record<string, string>;

    expect(response.status).toBe(200);
    expect(String(url)).toBe("https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=en");
    expect(options.body).toBe(JSON.stringify([{ text: "Hola" }]));
    expect(headers["ocp-apim-subscription-key"]).toBe(azureKey);
    expect(headers["ocp-apim-subscription-region"]).toBe("westeurope");
  });

  it("si el proveedor no responde a tiempo, lo dice con un 504", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("timeout", "TimeoutError")));
    const response = await POST(request({ model: "gpt-x", provider: "openai" }));
    expect(response.status).toBe(504);
  });
});

describe("«Probar conexión» con DeepL (05.5)", () => {
  it("pregunta lo gastado del mes, sin traducir nada, y devuelve el cupo", async () => {
    const deepl = vi.fn().mockResolvedValue(Response.json({ character_count: 1200, character_limit: 500000 }));
    vi.stubGlobal("fetch", deepl);
    const key = "12345678-1234-1234-1234-123456789abc:fx";

    const response = await POST(request({ provider: "deepl" }, key));
    const [url, options] = deepl.mock.calls[0] as [string, RequestInit];

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ characterCount: 1200, characterLimit: 500000, modelName: null, ok: true, plan: "Free" });
    expect(url).toBe("https://api-free.deepl.com/v2/usage");
    expect(options.method).toBe("GET");
    expect((options.headers as Record<string, string>).authorization).toBe(`DeepL-Auth-Key ${key}`);
  });
});
