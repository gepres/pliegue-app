import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const openAiKey = "sk-test-000000000000000000000000";
const geminiKey = "AIzaTest000000000000000000000000000000";

function request(body: Record<string, unknown>, apiKey = openAiKey) {
  return new Request("http://localhost/api/ai/translate", {
    body: JSON.stringify({ model: "test-model", passages: ["One.", "Two."], source: "en", target: "es", ...body }),
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    method: "POST",
  });
}

const translations = JSON.stringify({ translations: ["Uno.", "Dos."] });

afterEach(() => vi.unstubAllGlobals());

describe("ruta de traducción «Tu IA»", () => {
  it("no reenvía al proveedor una credencial que no lo parece ni un lote fuera de límites", async () => {
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);

    expect((await POST(request({ provider: "openai" }, "un texto pegado por error, no una clave"))).status).toBe(400);
    expect((await POST(request({ passages: ["x".repeat(5_000)], provider: "openai" }))).status).toBe(400);
    expect((await POST(request({ provider: "openai", target: "español" }))).status).toBe(400);
    expect((await POST(request({ provider: "ollama" }))).status).toBe(400);
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("pide a Gemini un JSON por esquema, con la clave en su cabecera y sin ella en el cuerpo", async () => {
    const providerFetch = vi.fn().mockResolvedValue(
      Response.json({
        candidates: [{ content: { parts: [{ text: "pensando…", thought: true }, { text: translations }] } }],
        usageMetadata: { candidatesTokenCount: 12, promptTokenCount: 40, thoughtsTokenCount: 3 },
      }),
    );
    vi.stubGlobal("fetch", providerFetch);

    const response = await POST(request({ model: "gemini-3.5-flash-lite", provider: "gemini" }, geminiKey));
    const [url, options] = providerFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ translations: ["Uno.", "Dos."], usage: { inputTokens: 40, outputTokens: 15 } });
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent");
    expect((options.headers as Record<string, string>)["x-goog-api-key"]).toBe(geminiKey);
    expect(options.body).not.toContain(geminiKey);
    expect(body).toMatchObject({
      generationConfig: { responseMimeType: "application/json", responseJsonSchema: { required: ["translations"] } },
      systemInstruction: { parts: [{ text: expect.stringContaining("del inglés (en) al español (es)") }] },
    });
    expect(JSON.stringify(body.contents)).toContain("One.");
  });

  it("usa la salida estructurada de OpenAI y de Anthropic", async () => {
    const openAi = vi.fn().mockResolvedValue(Response.json({ output_text: translations }));
    vi.stubGlobal("fetch", openAi);
    expect((await POST(request({ provider: "openai" }))).status).toBe(200);
    expect(JSON.parse((openAi.mock.calls[0] as [string, RequestInit])[1].body as string)).toMatchObject({
      store: false,
      text: { format: { name: "pliegue_translation", strict: true, type: "json_schema" } },
    });

    const anthropic = vi.fn().mockResolvedValue(Response.json({ content: [{ text: translations, type: "text" }] }));
    vi.stubGlobal("fetch", anthropic);
    expect((await POST(request({ provider: "anthropic" }))).status).toBe(200);
    expect(JSON.parse((anthropic.mock.calls[0] as [string, RequestInit])[1].body as string)).toMatchObject({
      output_config: { format: { type: "json_schema" } },
    });
  });

  it("avisa con 422 cuando el modelo junta pasajes, para que el navegador parta el lote", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ output_text: JSON.stringify({ translations: ["Uno y dos."] }) })));
    const response = await POST(request({ provider: "openai" }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ mismatch: true });
  });

  it("traduce con Azure: sus cabeceras, su región, un texto por pasaje y el chino por su escritura", async () => {
    const azureKey = "0123456789abcdef0123456789abcdef";
    const providerFetch = vi.fn().mockResolvedValue(
      Response.json([{ translations: [{ text: "Uno.", to: "es" }] }, { translations: [{ text: "Dos.", to: "es" }] }]),
    );
    vi.stubGlobal("fetch", providerFetch);

    const response = await POST(request({ model: undefined, provider: "azure", region: "WestEurope" }, azureKey));
    const [url, options] = providerFetch.mock.calls[0] as [URL, RequestInit];
    const headers = options.headers as Record<string, string>;

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ translations: ["Uno.", "Dos."], usage: { characters: 8 } });
    expect(String(url)).toBe("https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=en&to=es");
    expect(headers["ocp-apim-subscription-key"]).toBe(azureKey);
    expect(headers["ocp-apim-subscription-region"]).toBe("westeurope");
    expect(JSON.parse(options.body as string)).toEqual([{ text: "One." }, { text: "Two." }]);

    await POST(request({ passages: ["你好"], provider: "azure", source: "zh" }, azureKey));
    expect(String((providerFetch.mock.calls[1] as [URL])[0])).toContain("from=zh-Hans");
    // Sin región, sin cabecera: un recurso global no la necesita.
    await POST(request({ provider: "azure" }, azureKey));
    expect((providerFetch.mock.calls[2] as [URL, RequestInit])[1].headers).not.toHaveProperty("ocp-apim-subscription-region");
  });

  it("con Azure, el cupo gratuito agotado (403) se dice como cupo y la clave rechazada menciona la región", async () => {
    const azureKey = "0123456789abcdef0123456789abcdef";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { code: 403001, message: "Out of call volume quota" } }, { status: 403 })));
    const quota = await POST(request({ provider: "azure" }, azureKey));
    expect(quota.status).toBe(429);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { code: 401000, message: "Access denied" } }, { status: 401 })));
    const credential = await POST(request({ provider: "azure" }, azureKey));
    expect(credential.status).toBe(401);
    expect(((await credential.json()) as { error: string }).error).toContain("región");
  });

  it("nombra la causa cuando Gemini rechaza la clave o se queda sin cupo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          { error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } },
          { status: 400 },
        ),
      ),
    );
    const credential = await POST(request({ provider: "gemini" }, geminiKey));
    expect(credential.status).toBe(401);
    expect(((await credential.json()) as { error: string }).error).toContain("Gemini no aceptó la API key");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({ error: { code: 429, message: "Quota exceeded", status: "RESOURCE_EXHAUSTED" } }, { status: 429 }),
      ),
    );
    const quota = await POST(request({ provider: "gemini" }, geminiKey));
    expect(quota.status).toBe(429);
  });
});
