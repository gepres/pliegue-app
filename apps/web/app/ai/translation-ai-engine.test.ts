import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultAiSettings, type AiSettings } from "./ai-settings";
import { createAiTranslationEngine, translateInBatches } from "./translation-ai-engine";
import { TranslationCountError } from "./translation-prompt";

const pair = { source: "en", target: "es" };
/** Ajustes con el traductor elegido; se cataloga con el predeterminado. */
const settings = (translationProvider: AiSettings["translationProvider"]): AiSettings => ({ ...defaultAiSettings, translationProvider });

afterEach(() => vi.unstubAllGlobals());

describe("el motor «Tu IA»", () => {
  it("sin traductor elegido en Ajustes —el del navegador, por defecto— está sin configurar", async () => {
    const unset = createAiTranslationEngine(defaultAiSettings, "sk-test-000000000000000000000000");
    expect(defaultAiSettings.translationProvider).toBe("browser");
    expect(await unset.availability(pair)).toBe("needs-provider");
    await expect(unset.create(pair)).rejects.toThrow("Elige en Ajustes");
  });

  it("con Azure manda su región y ningún modelo, y guarda lo suyo aparte", async () => {
    const route = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { passages: string[] };
      return Response.json({ translations: body.passages.map((passage) => passage.toUpperCase()) });
    });
    vi.stubGlobal("fetch", route);
    const azure = createAiTranslationEngine({ ...settings("azure"), azureRegion: "westeurope" }, "a".repeat(32));
    expect(azure.id).toBe("ai:azure");
    expect(azure.label).toBe("Azure Translator");
    expect(await (await azure.create(pair)).translate("hello")).toBe("HELLO");
    const body = JSON.parse((route.mock.calls[0]![1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ provider: "azure", region: "westeurope", source: "en", target: "es" });
    expect(body.model).toBeUndefined();
  });

  it("pide la clave antes de traducir con un proveedor alojado, y Ollama no la necesita", async () => {
    const gemini = createAiTranslationEngine(settings("gemini"), "");
    expect(await gemini.availability(pair)).toBe("needs-key");
    await expect(gemini.create(pair)).rejects.toThrow("Falta la clave de Gemini");

    const ollama = createAiTranslationEngine(settings("ollama"), "");
    expect(await ollama.availability(pair)).toBe("available");
    expect(ollama.onDevice).toBe(true);
  });

  it("traduce con su propio proveedor aunque se catalogue con otro", async () => {
    const route = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { passages: string[] };
      return Response.json({ translations: body.passages, usage: {} });
    });
    vi.stubGlobal("fetch", route);
    const mixed: AiSettings = { ...settings("gemini"), provider: "anthropic" };
    const engine = createAiTranslationEngine(mixed, "AIza-000000000000000000000000");
    expect(engine.id).toBe("ai:gemini:gemini-3.5-flash-lite");
    await (await engine.create(pair)).translate("Hello.");
    expect(JSON.parse((route.mock.calls[0]![1] as RequestInit).body as string)).toMatchObject({
      model: "gemini-3.5-flash-lite",
      provider: "gemini",
    });
  });

  it("guarda lo traducido por proveedor y modelo, y lo dice en su nombre", () => {
    const engine = createAiTranslationEngine(settings("gemini"), "AIza-000000000000000000000000");
    expect(engine.id).toBe("ai:gemini:gemini-3.5-flash-lite");
    expect(engine.label).toBe("Gemini · gemini-3.5-flash-lite");
    expect(engine.onDevice).toBe(false);
  });

  it("manda la página de una vez a la ruta, con la clave en la cabecera", async () => {
    const route = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { passages: string[] };
      return Response.json({ translations: body.passages.map((passage) => `«${passage}»`), usage: {} });
    });
    vi.stubGlobal("fetch", route);

    const engine = createAiTranslationEngine(settings("openai"), "sk-test-000000000000000000000000");
    const translator = await engine.create(pair);
    const out = await translator.translateMany?.(["One.", "Two.", "Three."]);

    expect(out).toEqual(["«One.»", "«Two.»", "«Three.»"]);
    expect(route).toHaveBeenCalledTimes(1);
    const [url, init] = route.mock.calls[0]!;
    expect(url).toBe("/api/ai/translate");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-test-000000000000000000000000");
    expect(JSON.parse(init.body as string)).toMatchObject({ model: "gpt-6-luna", provider: "openai", source: "en", target: "es" });
    expect(init.body).not.toContain("sk-test");
  });

  it("dice la causa que da la ruta cuando el proveedor rechaza", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Gemini no aceptó la API key." }, { status: 401 })));
    const translator = await createAiTranslationEngine(settings("gemini"), "AIza-000000000000000000000000").create(pair);
    await expect(translator.translate("Hello.")).rejects.toThrow("Gemini no aceptó la API key.");
  });
});

describe("lotes que el modelo no respeta", () => {
  it("parte el lote por la mitad hasta que cada parte casa", async () => {
    const seen: number[] = [];
    // Un modelo que junta los pasajes cuando le llegan más de dos.
    const request = async (passages: readonly string[]) => {
      seen.push(passages.length);
      if (passages.length > 2) throw new TranslationCountError(passages.length, passages.length - 1);
      return passages.map((passage) => passage.toUpperCase());
    };
    const out = await translateInBatches(request, ["a", "b", "c", "d", "e"]);
    expect(out).toEqual(["A", "B", "C", "D", "E"]);
    expect(seen).toEqual([5, 3, 2, 1, 2]);
  });

  it("con un solo pasaje que no casa ya no hay nada que partir: falla", async () => {
    const request = async () => {
      throw new TranslationCountError(1, 0);
    };
    await expect(translateInBatches(request, ["a"])).rejects.toThrow(TranslationCountError);
  });

  it("no parte cuando el fallo es de otra clase, como la clave", async () => {
    const request = vi.fn(async () => {
      throw new Error("OpenAI no aceptó la API key.");
    });
    await expect(translateInBatches(request, ["a", "b"])).rejects.toThrow("API key");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
